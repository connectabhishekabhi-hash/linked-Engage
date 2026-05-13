/**
 * POST /api/extension/register
 * Called by the Chrome extension popup when the user pastes their API token.
 * Validates the token, returns a long-lived extension session token.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { token } = await req.json();
  if (!token) {
    return NextResponse.json({ error: "Token required" }, { status: 400 });
  }

  // The user's API token is stored (hashed) on their User record
  const user = await prisma.user.findFirst({
    where: { apiToken: token },
    select: { id: true, email: true },
  });

  if (!user) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // Generate a long-lived extension token and store it
  const extensionToken = crypto.randomBytes(32).toString("hex");

  await prisma.user.update({
    where: { id: user.id },
    data: { extensionToken },
  });

  return NextResponse.json({
    extensionToken,
    userId: user.id,
    email: user.email,
  });
}
