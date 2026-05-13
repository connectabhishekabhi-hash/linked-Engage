/**
 * GET /api/linkedin/connect
 * Kick off the LinkedIn OAuth flow to get w_member_social access.
 * Requires the user to be signed in — redirects to LinkedIn auth page.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createHmac, randomBytes } from "crypto";

export const runtime = "nodejs";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", process.env.NEXTAUTH_URL!));
  }

  // Build a signed state so the callback can verify the request came from us
  // state = userId:nonce:hmac(userId:nonce, NEXTAUTH_SECRET)
  const nonce = randomBytes(16).toString("hex");
  const payload = `${session.user.id}:${nonce}`;
  const hmac = createHmac("sha256", process.env.NEXTAUTH_SECRET!)
    .update(payload)
    .digest("hex");
  const state = Buffer.from(`${payload}:${hmac}`).toString("base64url");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.LINKEDIN_CLIENT_ID!,
    redirect_uri: `${process.env.NEXTAUTH_URL}/api/linkedin/callback`,
    // r_member_social: read the user's own posts/shares (needed for analytics).
    // LinkedIn will silently drop scopes not approved for your app — requesting
    // them does not break the flow, it just means analytics falls back to
    // scheduler-published posts if the scope isn't granted.
    scope: "openid profile email w_member_social r_member_social",
    state,
  });

  const authUrl = `https://www.linkedin.com/oauth/v2/authorization?${params}`;
  return NextResponse.redirect(authUrl);
}
