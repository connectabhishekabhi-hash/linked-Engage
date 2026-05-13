export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchPostStats } from "@/lib/linkedin-api";

/**
 * POST /api/analytics/fetch
 * Body: { postUrl: string }
 * Fetches stats for a given LinkedIn post URL using the stored OAuth token,
 * then upserts a PostAnalytics record.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { postUrl } = await req.json();
  if (!postUrl?.trim()) return NextResponse.json({ error: "postUrl required" }, { status: 400 });

  // Extract post URN from URL
  // Handles: linkedin.com/feed/update/urn:li:ugcPost:XXX  or  /urn%3Ali%3AugcPost%3AXXX
  let postUrn = "";
  try {
    const decoded = decodeURIComponent(postUrl);
    const match = decoded.match(/urn:li:(ugcPost|activity|share):(\d+)/);
    if (match) postUrn = `urn:li:${match[1]}:${match[2]}`;
  } catch {
    postUrn = "";
  }

  if (!postUrn) {
    return NextResponse.json(
      { error: "Could not extract a valid post URN from the URL. Paste the direct post link." },
      { status: 400 }
    );
  }

  // Get OAuth token
  const account = await (prisma.linkedInAccount.findUnique as any)({
    where: { userId: session.user.id },
    select: { accessToken: true, tokenExpiry: true },
  });

  if (!account?.accessToken) {
    return NextResponse.json(
      { error: "LinkedIn API not connected. Go to Settings to connect." },
      { status: 422 }
    );
  }

  if (account.tokenExpiry && new Date(account.tokenExpiry) < new Date()) {
    return NextResponse.json({ error: "LinkedIn token expired. Re-connect in Settings." }, { status: 422 });
  }

  // Fetch stats from LinkedIn
  const stats = await fetchPostStats(account.accessToken, postUrn);

  // Build viewer data payload (extendable when LinkedIn grants demographic scopes)
  const viewerData = {
    totalViews:   stats.impressions,
    reactions:    stats.reactions,
    comments:     stats.comments,
    shares:       stats.shares,
    clicks:       stats.clicks,
    topCompanies: [] as { name: string; count: number }[],
    topTitles:    [] as { name: string; count: number }[],
  };

  // Upsert analytics record
  const analytics = await prisma.postAnalytics.upsert({
    where: { userId_postUrn: { userId: session.user.id, postUrn } },
    create: {
      userId:      session.user.id,
      postUrn,
      postUrl:     postUrl.trim(),
      postPreview: "",
      viewerData,
      fetchedAt:   new Date(),
    },
    update: {
      viewerData,
      fetchedAt: new Date(),
    },
  });

  return NextResponse.json({ analytics });
}
