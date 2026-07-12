/**
 * POST /api/extension/jobs/:jobId/complete
 * Extension calls this after successfully processing a job.
 * For SCRAPE jobs, saves profile data and triggers AI draft generation.
 * For COMMENT / CONNECTION_REQUEST jobs, marks the draft as EXECUTED.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateDrafts } from "@/lib/ai-drafter";

export const runtime = "nodejs";

async function getUserFromToken(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace("Bearer ", "").trim();
  if (!token) return null;
  return prisma.user.findFirst({
    where: { extensionToken: token },
    select: { id: true },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const user = await getUserFromToken(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { jobId } = await params;
  const { result } = await req.json();

  const job = await prisma.extensionJob.findFirst({
    where: { id: jobId, userId: user.id },
  });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  // Mark job complete
  await prisma.extensionJob.update({
    where: { id: jobId },
    data: { status: "COMPLETED", result, completedAt: new Date() },
  });

  // ── Handle each job type ──────────────────────────────────────────────────

  if (job.type === "SCRAPE") {
    const {
      fullName, headline, bio,
      latestPost, latestPostUrl, profileUrn, activityUrn,
      posts = [],
    } = result as {
      fullName: string; headline: string; bio: string;
      latestPost?: string; latestPostUrl?: string; profileUrn?: string; activityUrn?: string;
      posts?: { text: string; url: string; activityUrn: string }[];
    };

    // Normalise: prefer new posts[] array, fall back to legacy single-post fields
    const normalizedPosts = (posts && posts.length > 0)
      ? posts
      : (latestPost ? [{ text: latestPost, url: latestPostUrl ?? "", activityUrn: activityUrn ?? "" }] : []);

    // ── Save scraped data to Lead ─────────────────────────────────────────
    // Build the update data carefully — new columns only included if migration has run
    const leadUpdateData: Record<string, unknown> = {
      fullName:       fullName  ?? "",
      headline:       headline  ?? "",
      scrapedBio:     bio       ?? "",
      scrapedPost:    normalizedPosts[0]?.text        ?? latestPost    ?? "",
      scrapedPostUrl: normalizedPosts[0]?.url         ?? latestPostUrl ?? "",
      activityUrn:    normalizedPosts[0]?.activityUrn ?? activityUrn  ?? "",
      profileUrn:     profileUrn ?? "",
      status:         "AWAITING_APPROVAL",
    };

    // Try to include scrapedPosts (new column) — silently skip if column doesn't exist yet
    try {
      await (prisma.lead.update as any)({
        where: { id: job.leadId },
        data: { ...leadUpdateData, scrapedPosts: normalizedPosts },
      });
    } catch (dbErr: any) {
      if (dbErr?.message?.includes("scrapedPosts") || dbErr?.code === "P2009") {
        // Column not migrated yet — save without new field
        console.warn("[complete] scrapedPosts column missing, saving without it");
        await prisma.lead.update({
          where: { id: job.leadId },
          data: leadUpdateData as Parameters<typeof prisma.lead.update>[0]["data"],
        });
      } else {
        throw dbErr; // real error — rethrow
      }
    }

    // ── Fetch user's AI voice profile (best-effort) ───────────────────────
    let aiProfile = null;
    try {
      aiProfile = await (prisma.userAIProfile as any).findUnique({
        where: { userId: user.id },
      });
    } catch {
      // Table not yet migrated — proceed without profile
    }

    // ── Generate AI drafts ─────────────────────────────────────────────────
    try {
      const generated = await generateDrafts({
        fullName: fullName ?? "",
        headline: headline ?? "",
        bio:      bio ?? "",
        posts:    normalizedPosts,
        profile:  aiProfile,
      });

      // Comment draft for each post.
      // postUrn stores the ugcPost URN (shareUrn) when available — required for the
      // official LinkedIn API. Falls back to the activity URN (works for Voyager/extension).
      const commentDrafts = normalizedPosts.map((post: any, i: number) => ({
        leadId:  job.leadId,
        type:    "COMMENT" as const,
        content: generated.comments[i] ?? generated.comments[0] ?? "Interesting take — what's the story behind this?",
        status:  "AWAITING_APPROVAL" as const,
        postUrn: (post as any).shareUrn || post.activityUrn, // prefer ugcPost URN for official API
      }));

      // Connection request draft
      const connDraft = {
        leadId:  job.leadId,
        type:    "CONNECTION_REQUEST" as const,
        content: generated.connectionNote,
        status:  "AWAITING_APPROVAL" as const,
      };

      // Try with postUrn; if column not migrated yet, save without it
      try {
        await (prisma.draft.createMany as any)({
          data: [...commentDrafts, connDraft],
        });
      } catch (draftErr: any) {
        if (draftErr?.message?.includes("postUrn") || draftErr?.code === "P2009") {
          console.warn("[complete] postUrn column missing, saving drafts without it");
          const fallbackData = [
            ...commentDrafts.map(({ postUrn: _postUrn, ...rest }: any) => rest),
            connDraft,
          ];
          await (prisma.draft.createMany as any)({ data: fallbackData });
        } else {
          throw draftErr;
        }
      }
    } catch (e: any) {
      console.error("[complete] AI drafting failed:", e.message);
      // AI failed — create a minimal fallback connection request so the lead
      // always appears in the inbox with at least one actionable draft.
      try {
        const existing = await prisma.draft.count({ where: { leadId: job.leadId } });
        if (existing === 0) {
          await prisma.draft.create({
            data: {
              leadId:  job.leadId,
              type:    "CONNECTION_REQUEST",
              content: `Hi ${fullName ?? "there"}, I came across your profile and would love to connect.`,
              status:  "AWAITING_APPROVAL",
            },
          });
          console.log("[complete] Created fallback connection draft for lead", job.leadId);
        }
      } catch (fallbackErr: any) {
        console.error("[complete] Fallback draft creation also failed:", fallbackErr.message);
      }
    }
  }

  if (job.type === "SEARCH") {
    const { searchId, profiles = [], total = 0 } = result as {
      searchId?: string; profiles?: unknown[]; total?: number;
    };
    if (searchId) {
      try {
        const resultsJson = JSON.stringify(profiles);
        const now = new Date();
        await prisma.$executeRaw`
          UPDATE "LeadSearch"
          SET "status" = 'COMPLETED',
              "results" = ${resultsJson}::jsonb,
              "total" = ${total as number},
              "updatedAt" = ${now}
          WHERE "id" = ${searchId}
        `;
      } catch (e: any) {
        console.error("[complete] LeadSearch update failed:", e.message);
      }
    }
  }

  if (job.type === "COMMENT" || job.type === "CONNECTION_REQUEST") {
    const payload = job.payload as { draftId?: string };
    if (payload.draftId) {
      await prisma.draft.update({
        where: { id: payload.draftId },
        data: { status: "EXECUTED", executedAt: new Date() },
      });
      await prisma.lead.update({
        where: { id: job.leadId },
        data: { status: "ENGAGED" },
      });
    }
  }

  return NextResponse.json({ ok: true });
}
