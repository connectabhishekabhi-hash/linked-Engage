export const runtime = "nodejs";
export const maxDuration = 60; // Vercel Pro allows up to 60s on cron routes

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publishPost } from "@/lib/linkedin-api";

/**
 * GET /api/cron/process-scheduled-posts
 *
 * Triggered by Vercel Cron (vercel.json) or any external scheduler every 5-10 min.
 * Secured with a shared CRON_SECRET header so random callers cannot trigger it.
 *
 * Add to vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/cron/process-scheduled-posts",
 *     "schedule": "*/10 * * * *"
 *   }]
 * }
 *
 * Set env var:  CRON_SECRET=<long random string>
 * Vercel automatically sends Authorization: Bearer <CRON_SECRET> for cron invocations.
 */
export async function GET(req: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  // ── Find all due PENDING posts ────────────────────────────────────────────────
  const duePosts = await prisma.scheduledPost.findMany({
    where: {
      status:       "PENDING",
      scheduledFor: { lte: now },
    },
    orderBy: { scheduledFor: "asc" },
    take: 20, // process max 20 per invocation to stay within timeout
  });

  if (duePosts.length === 0) {
    return NextResponse.json({ processed: 0, message: "No posts due" });
  }

  const results: { id: string; status: string; urn?: string; error?: string }[] = [];

  for (const scheduledPost of duePosts) {
    // Mark as PUBLISHING immediately to prevent double-processing if cron overlaps
    await prisma.scheduledPost.update({
      where: { id: scheduledPost.id },
      data:  { status: "PUBLISHING", updatedAt: now },
    });

    try {
      // Get OAuth token for this user
      const account = await (prisma.linkedInAccount.findUnique as any)({
        where:  { userId: scheduledPost.userId },
        select: { accessToken: true, tokenExpiry: true, linkedinMemberId: true },
      });

      if (!account?.accessToken || !account?.linkedinMemberId) {
        throw new Error("LinkedIn API not connected for this account.");
      }

      if (account.tokenExpiry && new Date(account.tokenExpiry) < now) {
        throw new Error("LinkedIn access token has expired. Re-connect in Settings.");
      }

      // Publish to LinkedIn
      const postUrn = await publishPost(
        account.accessToken,
        account.linkedinMemberId,
        scheduledPost.content
      );

      // Mark as PUBLISHED
      await prisma.scheduledPost.update({
        where: { id: scheduledPost.id },
        data: {
          status:         "PUBLISHED",
          linkedinPostUrn: postUrn,
          publishedAt:    now,
          errorMessage:   null,
          updatedAt:      now,
        },
      });

      results.push({ id: scheduledPost.id, status: "PUBLISHED", urn: postUrn });
      console.log(`[cron] Published post ${scheduledPost.id} → ${postUrn}`);

    } catch (err: any) {
      const errorMessage = err?.message ?? "Unknown error";
      console.error(`[cron] Failed to publish post ${scheduledPost.id}:`, errorMessage);

      await prisma.scheduledPost.update({
        where: { id: scheduledPost.id },
        data: {
          status:       "FAILED",
          errorMessage,
          updatedAt:    now,
        },
      });

      results.push({ id: scheduledPost.id, status: "FAILED", error: errorMessage });
    }
  }

  const published = results.filter((r) => r.status === "PUBLISHED").length;
  const failed    = results.filter((r) => r.status === "FAILED").length;

  return NextResponse.json({
    processed: results.length,
    published,
    failed,
    results,
  });
}
