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

  const { name, targetPostUrl, triggerKeyword, messageTemplate } = await req.json();

  if (!name?.trim())            return NextResponse.json({ error: "Campaign name required" }, { status: 400 });
  if (!targetPostUrl?.trim())   return NextResponse.json({ error: "Target post URL required" }, { status: 400 });
  if (!triggerKeyword?.trim())  return NextResponse.json({ error: "Trigger keyword required" }, { status: 400 });
  if (!messageTemplate?.trim()) return NextResponse.json({ error: "Message template required" }, { status: 400 });

  const campaign = await prisma.campaign.create({
    data: {
      userId:          session.user.id,
      name:            name.trim(),
      targetPostUrl:   targetPostUrl.trim(),
      triggerKeyword:  triggerKeyword.trim().toUpperCase(),
      messageTemplate: messageTemplate.trim(),
    },
  });

  return NextResponse.json({ campaign }, { status: 201 });
}
