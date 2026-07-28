export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateSearchQueries } from "@/lib/ai-research";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
      include: { contacts: true },
      orderBy: [{ qualificationScore: "desc" }, { createdAt: "asc" }],
    });

    const jobs = await (prisma as any).researchJob.findMany({
      where: { campaignId: id },
      select: { id: true, type: true, status: true, companyId: true, error: true },
    });

    const jobStats = {
      total: jobs.length,
      pending: jobs.filter((j: any) => j.status === "PENDING").length,
      running: jobs.filter((j: any) => j.status === "CLAIMED" || j.status === "RUNNING").length,
      completed: jobs.filter((j: any) => j.status === "COMPLETED").length,
      failed: jobs.filter((j: any) => j.status === "FAILED").length,
    };

    return NextResponse.json({ campaign, companies, jobStats });
  } catch (err: any) {
    console.error("[research/id] GET error:", err);
    return NextResponse.json({ error: err?.message ?? "Failed to fetch campaign" }, { status: 500 });
  }
}

// POST /api/research/[id] — Start or resume research
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    if (campaign.status !== "DRAFT" && campaign.status !== "PAUSED")
      return NextResponse.json({ error: "Campaign already running or completed" }, { status: 400 });

    // Generate search queries using AI
    const queries = await generateSearchQueries({
      industry: campaign.industry,
      location: campaign.location,
      companySize: campaign.companySize,
      services: campaign.services,
      exclusions: campaign.exclusions,
      targetCount: campaign.targetCount,
      additionalInstructions: campaign.additionalInstructions,
    });

    // Create DISCOVER_COMPANIES jobs for each query
    const jobData = queries.map((query: string) => ({
      campaignId: id,
      type: "DISCOVER_COMPANIES",
      status: "PENDING",
      payload: { query, maxResults: 15 },
    }));

    await (prisma as any).researchJob.createMany({ data: jobData });

    await (prisma as any).researchCampaign.update({
      where: { id },
      data: { status: "DISCOVERING" },
    });

    return NextResponse.json({ started: true, queriesGenerated: queries.length, queries });
  } catch (err: any) {
    console.error("[research/id] POST error:", err);
    return NextResponse.json({ error: err?.message ?? "Failed to start campaign" }, { status: 500 });
  }
}

// PATCH /api/research/[id] — Pause/resume/cancel
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const { action } = await req.json();

    const campaign = await (prisma as any).researchCampaign.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!campaign)
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    if (action === "pause") {
      await (prisma as any).researchCampaign.update({
        where: { id },
        data: { status: "PAUSED" },
      });
    } else if (action === "resume") {
      // Determine what stage we're in based on existing jobs/companies
      const pendingJobs = await (prisma as any).researchJob.count({
        where: { campaignId: id, status: "PENDING" },
      });
      const status = pendingJobs > 0 ? campaign.status : "DISCOVERING";
      await (prisma as any).researchCampaign.update({
        where: { id },
        data: { status: status === "PAUSED" ? "DISCOVERING" : status },
      });
    } else if (action === "cancel") {
      // Cancel all pending jobs
      await (prisma as any).researchJob.updateMany({
        where: { campaignId: id, status: { in: ["PENDING", "CLAIMED"] } },
        data: { status: "FAILED", error: "Campaign cancelled" },
      });
      await (prisma as any).researchCampaign.update({
        where: { id },
        data: { status: "FAILED" },
      });
    } else if (action === "retry_failed") {
      await (prisma as any).researchJob.updateMany({
        where: { campaignId: id, status: "FAILED" },
        data: { status: "PENDING", error: null },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[research/id] PATCH error:", err);
    return NextResponse.json({ error: err?.message ?? "Failed to update campaign" }, { status: 500 });
  }
}

// DELETE /api/research/[id]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    await (prisma as any).researchCampaign.deleteMany({
      where: { id, userId: session.user.id },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[research/id] DELETE error:", err);
    return NextResponse.json({ error: err?.message ?? "Failed to delete campaign" }, { status: 500 });
  }
}
