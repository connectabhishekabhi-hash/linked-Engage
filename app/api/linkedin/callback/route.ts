/**
 * GET /api/linkedin/callback
 * LinkedIn redirects here after the user authorises the app.
 * Exchanges the code for tokens, stores them, redirects to settings.
 */
import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { prisma } from "@/lib/prisma";
import { getLinkedInMemberId } from "@/lib/linkedin-api";

export const runtime = "nodejs";

function verifyState(state: string): string | null {
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    const parts = decoded.split(":");
    if (parts.length < 3) return null;

    const hmac = parts.pop()!;
    const payload = parts.join(":");
    const expected = createHmac("sha256", process.env.NEXTAUTH_SECRET!)
      .update(payload)
      .digest("hex");

    if (hmac !== expected) return null;
    return parts[0]; // userId is the first segment
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code  = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const settingsUrl = `${process.env.NEXTAUTH_URL}/settings`;

  if (error || !code || !state) {
    return NextResponse.redirect(`${settingsUrl}?linkedin=error&reason=${error ?? "missing_code"}`);
  }

  // Verify state to prevent CSRF
  const userId = verifyState(state);
  if (!userId) {
    return NextResponse.redirect(`${settingsUrl}?linkedin=error&reason=invalid_state`);
  }

  // Exchange code for access token
  const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "authorization_code",
      code,
      redirect_uri:  `${process.env.NEXTAUTH_URL}/api/linkedin/callback`,
      client_id:     process.env.LINKEDIN_CLIENT_ID!,
      client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    console.error("[linkedin/callback] token exchange failed:", err);
    return NextResponse.redirect(`${settingsUrl}?linkedin=error&reason=token_exchange`);
  }

  const tokenData = await tokenRes.json();
  const accessToken: string = tokenData.access_token;
  const expiresIn: number   = tokenData.expires_in ?? 5183999; // ~60 days default
  const tokenExpiry = new Date(Date.now() + expiresIn * 1000);

  // Get the member ID (sub) from the userinfo endpoint
  let linkedinMemberId = "";
  try {
    linkedinMemberId = await getLinkedInMemberId(accessToken);
  } catch (e) {
    console.warn("[linkedin/callback] getLinkedInMemberId failed:", e);
    // Non-fatal — we can still store the token and try without actor
  }

  // Upsert the LinkedInAccount with OAuth token
  await prisma.linkedInAccount.upsert({
    where:  { userId },
    create: {
      userId,
      encryptedCookie: "",    // empty — will be filled if user also sets session cookie
      cookieIv:        "",
      isActive:        true,
      accessToken,
      tokenExpiry,
      linkedinMemberId,
    },
    update: {
      accessToken,
      tokenExpiry,
      linkedinMemberId,
      isActive: true,
    },
  });

  return NextResponse.redirect(`${settingsUrl}?linkedin=connected`);
}
