export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const user = await prisma.user.findFirst({ where: { extensionToken: token } });
    if (!user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const { jobId } = await params;
    const { error } = await req.json();

    const job = await (prisma as any).researchJob.findFirst({
      where: { id: jobId, campaign: { userId: user.id } },
    });
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    // Check if we can retry
    if (job.retryCount < job.maxRetries) {
      await (prisma as any).researchJob.update({
        where: { id: jobId },
        data: {
          status: "PENDING",
          retryCount: job.retryCount + 1,
          error: error || "Unknown error",
        },
      });
    } else {
      await (prisma as any).researchJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          error: error || "Unknown error",
          completedAt: new Date(),
        },
      });

      // Mark company as failed if applicable
      if (job.companyId) {
        await (prisma as any).researchCompany.update({
          where: { id: job.companyId },
          data: { researchStatus: "FAILED", errorMessage: error },
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[research-jobs/fail] error:", err);
    return NextResponse.json({ error: err?.message ?? "Failed" }, { status: 500 });
  }
}
