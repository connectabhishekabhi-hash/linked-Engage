export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });

  const user = await prisma.user.findFirst({ where: { extensionToken: token } });
  if (!user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  // Find the oldest pending research job for any of this user's campaigns
  const job = await (prisma as any).researchJob.findFirst({
    where: {
      status: "PENDING",
      campaign: { userId: user.id, status: { notIn: ["PAUSED", "FAILED", "DRAFT"] } },
    },
    orderBy: { createdAt: "asc" },
    include: { campaign: { select: { userId: true } } },
  });

  if (!job) return new NextResponse(null, { status: 204 });

  // Atomically claim it
  await (prisma as any).researchJob.update({
    where: { id: job.id },
    data: { status: "CLAIMED", claimedAt: new Date() },
  });

  return NextResponse.json({
    id: job.id,
    type: job.type,
    payload: job.payload,
    campaignId: job.campaignId,
    companyId: job.companyId,
  });
}
