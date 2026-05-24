import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST /api/extension/campaigns/:id/triggered
// Called by the extension when a commenter matched the trigger keyword
// and a connection request was sent.
// Body: { commenterName, commenterProfileUrl, commentText }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });

  const user = await prisma.user.findFirst({
    where: { extensionToken: token },
    select: { id: true },
  });
  if (!user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const { id } = await params;

  const campaign = await prisma.campaign.findFirst({
    where: { id, userId: user.id },
  });
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  // Increment leads triggered count
  const updated = await prisma.campaign.update({
    where: { id },
    data: { leadsTriggered: { increment: 1 } },
  });

  const body = await req.json().catch(() => ({}));
  console.log(
    `[campaign-triggered] Campaign "${campaign.name}" — lead: ${body.commenterName ?? "unknown"} (${body.commenterProfileUrl ?? ""})`
  );

  return NextResponse.json({
    ok: true,
    leadsTriggered: updated.leadsTriggered,
  });
}
