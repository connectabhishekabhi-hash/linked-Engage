/**
 * POST /api/extension/jobs/:jobId/fail
 * Extension calls this when a job errors out.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

async function getUserFromToken(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace("Bearer ", "").trim();
  if (!token) return null;
  return prisma.user.findFirst({
    where: { extensionToken: token },
    select: { id: true },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const user = await getUserFromToken(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { jobId } = await params;
  const { error } = await req.json();

  const job = await prisma.extensionJob.findFirst({
    where: { id: jobId, userId: user.id },
  });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  await prisma.extensionJob.update({
    where: { id: jobId },
    data: { status: "FAILED", error, completedAt: new Date() },
  });

  const payload = job.payload as { draftId?: string; searchId?: string };

  if (payload.searchId) {
    try {
      const now = new Date();
      await prisma.$executeRaw`
        UPDATE "LeadSearch"
        SET "status" = 'FAILED', "error" = ${error as string}, "updatedAt" = ${now}
        WHERE "id" = ${payload.searchId as string}
      `;
    } catch { /* table may not exist yet */ }
  }

  if (payload.draftId) {
    await prisma.draft.update({
      where: { id: payload.draftId },
      data: { status: "FAILED", errorMessage: error },
    }).catch(() => {});
  }

  // Reflect failure on the Lead (skip for SEARCH — no leadId involved)
  if (job.type !== "SEARCH") {
    await prisma.lead.update({
      where: { id: job.leadId },
      data: { status: "FAILED", scrapedBio: `Extension error: ${error}` },
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
