import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/campaigns — list all campaigns for current user
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const campaigns = await prisma.campaign.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ campaigns });
}

// POST /api/campaigns — create a new campaign
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const {
    name,
    targetPostUrl,
    triggerKeyword,
    messageTemplate,
    monitorAllPosts = false,
    autoConnect = false,
  } = await req.json();

  if (!name?.trim()) return NextResponse.json({ error: "Campaign name required" }, { status: 400 });

  // Validation depends on campaign mode
  if (!monitorAllPosts && !targetPostUrl?.trim()) {
    return NextResponse.json({ error: "Target post URL required (or enable 'Monitor all posts')" }, { status: 400 });
  }
  if (!autoConnect && !triggerKeyword?.trim()) {
    return NextResponse.json({ error: "Trigger keyword required (or enable 'Auto-connect')" }, { status: 400 });
  }

  const campaign = await prisma.campaign.create({
    data: {
      userId:          session.user.id,
      name:            name.trim(),
      targetPostUrl:   targetPostUrl?.trim() || null,
      triggerKeyword:  triggerKeyword?.trim()?.toUpperCase() || null,
      messageTemplate: messageTemplate?.trim() || null,
      monitorAllPosts: Boolean(monitorAllPosts),
      autoConnect:     Boolean(autoConnect),
    },
  });

  return NextResponse.json({ campaign }, { status: 201 });
}
