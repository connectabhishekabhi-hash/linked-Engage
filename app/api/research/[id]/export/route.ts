export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    const campaign = await (prisma as any).researchCampaign.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!campaign)
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const companies = await (prisma as any).researchCompany.findMany({
      where: { campaignId: id },
      include: {
        contacts: { where: { isPrimary: true }, take: 1 },
        evidence: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const escape = (val: string | null | undefined): string => {
      if (!val) return "";
      return `"${val.replace(/"/g, '""')}"`;
    };

    const getSocial = (evidence: any[], platform: string) =>
      evidence.find((e: any) => e.field === `social_${platform}`)?.value || "";

    const getField = (evidence: any[], field: string) =>
      evidence.filter((e: any) => e.field === field).map((e: any) => e.value).join("; ");

    const headers = [
      "Company Name", "Website", "Location",
      "LinkedIn", "Facebook", "Instagram", "Twitter",
      "Email", "Phone",
      "Founder Name", "Founder Title", "Founder LinkedIn",
      "Google Ads", "Meta Ads", "Status",
    ];

    const rows = companies.map((c: any) => {
      const contact = c.contacts[0];
      return [
        escape(c.name),
        escape(c.website),
        escape(c.location),
        escape(getSocial(c.evidence, "linkedin")),
        escape(getSocial(c.evidence, "facebook")),
        escape(getSocial(c.evidence, "instagram")),
        escape(getSocial(c.evidence, "twitter")),
        escape(getField(c.evidence, "email")),
        escape(getField(c.evidence, "phone")),
        escape(contact?.fullName),
        escape(contact?.title),
        escape(contact?.linkedinUrl),
        escape(c.googleAdsStatus),
        escape(c.metaAdsStatus),
        escape(c.researchStatus),
      ].join(",");
    });

    const csv = [headers.join(","), ...rows].join("\n");

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${campaign.name.replace(/[^a-zA-Z0-9]/g, "_")}_prospects.csv"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Failed" }, { status: 500 });
  }
}
