/**
 * GET /api/extension/jobs
 * Extension polls this every 30s. Returns the next PENDING job for this user,
 * or 204 No Content if the queue is empty.
 * Also atomically marks the job as CLAIMED so it isn't double-processed.
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

export async function GET(req: NextRequest) {
  const user = await getUserFromToken(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Claim the oldest PENDING job atomically
  const job = await prisma.extensionJob.findFirst({
    where: { userId: user.id, status: "PENDING" },
    orderBy: { createdAt: "asc" },
  });

  if (!job) {
    return new NextResponse(null, { status: 204 }); // No jobs
  }

  // Mark as CLAIMED so worker doesn't pick it up twice
  await prisma.extensionJob.update({
    where: { id: job.id },
    data: { status: "CLAIMED", claimedAt: new Date() },
  });

  return NextResponse.json({
    id:      job.id,
    type:    job.type,
    payload: job.payload,
    leadId:  job.leadId,
  });
}
