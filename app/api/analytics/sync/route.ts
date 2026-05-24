export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPostSocialStats } from "@/lib/linkedin-api";

/**
 * POST /api/analytics/sync
 *
 * Syncs stats for posts published through this tool's scheduler.
 * LinkedIn does not grant post-listing scopes to standard OAuth apps,
 * so we read post URNs from our own ScheduledPost table (status=PUBLISHED).
 * For each URN, we call the socialActions + socialMetadata APIs (which
 * work fine with w_member_social) and upsert PostAnalytics records.
 */
export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const userId = session.user.id;

    // ── OAuth token ───────────────────────────────────────────────────────────
    const account = await (prisma.linkedInAccount.findUnique as any)({
      where:  { userId },
      select: { accessToken: true, tokenExpiry: true },
    });

    if (!account?.accessToken) {
      return NextResponse.json(
        { error: "LinkedIn not connected. Go to Settings to connect." },
        { status: 422 }
      );
    }

    if (account.tokenExpiry && new Date(account.tokenExpiry) < new Date()) {
      return NextResponse.json(
        { error: "LinkedIn token expired. Re-connect in Settings." },
        { status: 422 }
      );
    }

    // ── Pull published scheduled posts from local DB ──────────────────────────
    let scheduledPosts: { linkedinPostUrn: string; content: string; publishedAt: Date | null }[] = [];
    try {
      scheduledPosts = await (prisma.scheduledPost as any).findMany({
        where:   { userId, status: "PUBLISHED", linkedinPostUrn: { not: null } },
        orderBy: { publishedAt: "desc" },
        take:    30,
        select:  { linkedinPostUrn: true, content: true, publishedAt: true },
      });
    } catch {
      // ScheduledPost table may not exist yet (migration pending)
      scheduledPosts = [];
    }

    if (!scheduledPosts.length) {
      return NextResponse.json({
        synced:    0,
        analytics: [],
        message:   "No published scheduled posts found. Use the scheduler to publish a post first.",
      });
    }

    // ── Fetch stats + upsert for each post ────────────────────────────────────
    const results = await Promise.allSettled(
      scheduledPosts.map(async (sp) => {
        const postUrn = sp.linkedinPostUrn;
        const stats   = await getPostSocialStats(account.accessToken, postUrn);

        const viewerData = {
          totalViews:   stats.impressions,
          reactions:    stats.reactions,
          comments:     stats.comments,
          shares:       stats.shares,
          clicks:       stats.clicks,
          topCompanies: [] as { name: string; count: number }[],
          topTitles:    [] as { name: string; count: number }[],
        };

        return (prisma.postAnalytics as any).upsert({
          where:  { userId_postUrn: { userId, postUrn } },
          create: {
            userId,
            postUrn,
            postUrl:     `https://www.linkedin.com/feed/update/${postUrn}/`,
            postPreview: sp.content.slice(0, 280),
            viewerData,
            fetchedAt:   new Date(),
          },
          update: {
            viewerData,
            postPreview: sp.content.slice(0, 280),
            fetchedAt:   new Date(),
          },
        });
      })
    );

    const succeeded = results.filter((r) => r.status === "fulfilled");
    const analytics = succeeded.map((r) => (r as PromiseFulfilledResult<any>).value);

    return NextResponse.json({ synced: succeeded.length, analytics });
  } catch (err: any) {
    console.error("[analytics/sync] Unhandled error:", err);
    return NextResponse.json(
      { error: `Sync failed: ${err?.message ?? "Unknown error"}` },
      { status: 500 }
    );
  }
}
