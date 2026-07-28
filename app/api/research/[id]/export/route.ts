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
      where: { campaignId: id, qualificationStatus: { in: ["QUALIFIED", "MAYBE"] } },
      include: { contacts: { where: { isPrimary: true }, take: 1 } },
      orderBy: { qualificationScore: "desc" },
    });

    const escape = (val: string | null | undefined): string => {
      if (!val) return "";
      const str = val.replace(/"/g, '""');
      return `"${str}"`;
    };

    const headers = [
      "Company Name", "Website", "City/Location", "Estimated Size",
      "Qualification Score", "Qualification Status",
      "Decision Maker", "Decision Maker Title", "Decision Maker LinkedIn",
      "Google Ads", "Meta Ads",
      "Services", "Marketing Opportunity",
      "Website Strengths", "Website Weaknesses",
    ];

    const rows = companies.map((c: any) => {
      const contact = c.contacts[0];
      return [
        escape(c.name),
        escape(c.website),
        escape(c.location),
        escape(c.estimatedSize),
        c.qualificationScore?.toString() ?? "",
        escape(c.qualificationStatus),
        escape(contact?.fullName),
        escape(contact?.title),
        escape(contact?.linkedinUrl),
        escape(c.googleAdsStatus),
        escape(c.metaAdsStatus),
        escape(c.servicesOffered?.join("; ")),
        escape(c.opportunity),
        escape(c.websiteStrengths?.join("; ")),
        escape(c.websiteWeaknesses?.join("; ")),
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
