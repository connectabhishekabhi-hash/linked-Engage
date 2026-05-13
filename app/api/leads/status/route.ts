import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Lightweight poll endpoint — returns only status counts + recent lead statuses
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const leads = await prisma.lead.findMany({
    where: { userId: session.user.id },
    select: {
      id: true,
      fullName: true,
      headline: true,
      profileUrl: true,
      status: true,
      updatedAt: true,
      scrapedBio: true,
      drafts: {
        select: { id: true, type: true, status: true },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  const counts = {
    PENDING: 0,
    SCRAPING: 0,
    AWAITING_APPROVAL: 0,
    ENGAGED: 0,
    FAILED: 0,
  };

  for (const lead of leads) {
    counts[lead.status as keyof typeof counts]++;
  }

  return NextResponse.json({ leads, counts });
}
