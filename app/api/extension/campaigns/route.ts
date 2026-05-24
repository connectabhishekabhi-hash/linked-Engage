import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/extension/campaigns — returns ACTIVE campaigns for the extension user
// Auth: Bearer extensionToken (same pattern as generate-comment)
export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });

  const user = await prisma.user.findFirst({
    where: { extensionToken: token },
    select: { id: true },
  });
  if (!user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const campaigns = await prisma.campaign.findMany({
    where: { userId: user.id, status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      targetPostUrl: true,
      triggerKeyword: true,
      messageTemplate: true,
      leadsTriggered: true,
      monitorAllPosts: true,
      autoConnect: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ campaigns });
}
