export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET — full company detail
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; companyId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id, companyId } = await params;

    const campaign = await (prisma as any).researchCampaign.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!campaign)
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const company = await (prisma as any).researchCompany.findFirst({
      where: { id: companyId, campaignId: id },
      include: {
        contacts: true,
        evidence: { orderBy: { checkedAt: "desc" } },
      },
    });
    if (!company)
      return NextResponse.json({ error: "Company not found" }, { status: 404 });

    return NextResponse.json({ company });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Failed" }, { status: 500 });
  }
}

// POST — Add contact to outreach (creates Lead + SCRAPE job)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; companyId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id, companyId } = await params;
    const { contactId } = await req.json();

    const campaign = await (prisma as any).researchCampaign.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!campaign)
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const contact = await (prisma as any).companyContact.findFirst({
      where: { id: contactId, companyId },
    });
    if (!contact || !contact.linkedinUrl)
      return NextResponse.json({ error: "Contact not found or no LinkedIn URL" }, { status: 422 });

    // Create Lead from research contact
    const lead = await prisma.lead.upsert({
      where: {
        userId_profileUrl: {
          userId: session.user.id,
          profileUrl: contact.linkedinUrl,
        },
      },
      create: {
        userId: session.user.id,
        profileUrl: contact.linkedinUrl,
        fullName: contact.fullName,
        headline: contact.title,
        researchCompanyId: companyId,
        status: "PENDING",
      },
      update: {
        researchCompanyId: companyId,
        status: "PENDING",
      },
    });

    // Link the contact to the lead
    await (prisma as any).companyContact.update({
      where: { id: contactId },
      data: { leadId: lead.id },
    });

    // Create SCRAPE job
    const vanityName = contact.linkedinUrl.split("/in/")[1]?.replace(/\/$/, "") || "";
    await prisma.extensionJob.create({
      data: {
        userId: session.user.id,
        leadId: lead.id,
        type: "SCRAPE",
        status: "PENDING",
        payload: { vanityName },
      },
    });

    return NextResponse.json({
      ok: true,
      leadId: lead.id,
      message: "Contact added to outreach — extension will scrape and generate drafts.",
    });
  } catch (err: any) {
    console.error("[research/company/outreach] error:", err);
    return NextResponse.json({ error: err?.message ?? "Failed" }, { status: 500 });
  }
}
