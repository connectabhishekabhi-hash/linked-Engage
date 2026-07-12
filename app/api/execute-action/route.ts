export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { postCommentOfficial } from "@/lib/linkedin-api";

/**
 * POST /api/execute-action
 * Instead of running Playwright, we now create an ExtensionJob.
 * The Chrome extension picks it up within ~30s and executes it
 * via the Voyager API from the user's real browser.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { draftId, leadId, content, type, targetUrl } = await req.json();

  // content is allowed to be "" for connection requests sent without a note
  if (!draftId || !leadId || !type) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const draft = await prisma.draft.findFirst({
    where: {
      id: draftId,
      leadId,
      lead: { userId: session.user.id },
      status: { in: ["AWAITING_APPROVAL", "FAILED"] },
    },
  });
  if (!draft) {
    return NextResponse.json({ error: "Draft not found or already executed" }, { status: 404 });
  }

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  // Build job payload depending on action type
  let payload: Record<string, string> = {};

  if (type === "CONNECTION_REQUEST") {
    if (!lead.profileUrn) {
      return NextResponse.json(
        { error: "Profile URN not found — please re-scrape this lead." },
        { status: 422 }
      );
    }
    payload = { profileUrn: lead.profileUrn, note: content, draftId };
  }

  if (type === "COMMENT") {
    const scrapedPosts = Array.isArray(lead.scrapedPosts) ? lead.scrapedPosts as any[] : [];
    const resolvedUrn = (draft as any).postUrn ?? lead.activityUrn;
    if (!resolvedUrn) {
      return NextResponse.json(
        { error: "No post found for this lead — delete and re-add the lead so the extension re-scrapes their posts." },
        { status: 422 }
      );
    }

    const matchedPost = scrapedPosts.find((post: any) =>
      post?.activityUrn === resolvedUrn ||
      post?.shareUrn === resolvedUrn ||
      post?.url === targetUrl
    );
    const activityUrn = matchedPost?.activityUrn ||
      (resolvedUrn.includes("urn:li:activity:") ? resolvedUrn : lead.activityUrn ?? resolvedUrn);
    const objectUrn = matchedPost?.shareUrn || resolvedUrn;
    const postUrl = matchedPost?.url ||
      targetUrl ||
      (activityUrn ? `https://www.linkedin.com/feed/update/${activityUrn}` : "");

    // ── Try official LinkedIn API first (no extension needed) ──────────────
    // Use `as any` so this works even before `prisma generate` is re-run
    // after adding the new LinkedInAccount OAuth columns.
    let account: any = null;
    try {
      account = await (prisma.linkedInAccount.findUnique as any)({
        where: { userId: session.user.id },
        select: { accessToken: true, tokenExpiry: true, linkedinMemberId: true },
      });
    } catch {
      // Columns not yet migrated — fall through to extension job
    }

    const hasValidToken =
      account?.accessToken &&
      account?.linkedinMemberId &&
      (!account.tokenExpiry || new Date(account.tokenExpiry) > new Date());

    // Official API requires ugcPost URN (not activity URN).
    // If we only have an activity URN, fall through to the extension job instead.
    const isUgcUrn = resolvedUrn.includes("ugcPost") || resolvedUrn.includes("urn:li:share:");
    if (hasValidToken && isUgcUrn) {
      // Post directly via official API — no extension job needed
      await prisma.draft.update({
        where: { id: draftId },
        data: { status: "EXECUTING", errorMessage: null },
      });

      try {
        await postCommentOfficial(
          account!.accessToken!,
          account!.linkedinMemberId!,
          resolvedUrn,
          content,
        );

        await prisma.draft.update({
          where: { id: draftId },
          data: { status: "EXECUTED", executedAt: new Date() },
        });
        await prisma.lead.update({
          where: { id: leadId },
          data: { status: "ENGAGED" },
        });

        return NextResponse.json({ ok: true, message: "Comment posted via LinkedIn API." });
      } catch (apiErr: any) {
        console.error("[execute-action] Official API comment failed:", apiErr.message);
        // Mark draft failed with the real error
        await prisma.draft.update({
          where: { id: draftId },
          data: { status: "FAILED", errorMessage: apiErr.message },
        });
        return NextResponse.json(
          { error: apiErr.message, detail: apiErr.message },
          { status: 502 }
        );
      }
    }

    // Fallback: queue extension job (official token not connected)
    payload = { activityUrn, objectUrn, targetUrl: postUrl, commentText: content, draftId };
  }

  // Mark draft as EXECUTING
  await prisma.draft.update({
    where: { id: draftId },
    data: { status: "EXECUTING", errorMessage: null },
  });

  // Queue the job for the extension
  await prisma.extensionJob.create({
    data: {
      userId:  session.user.id,
      leadId,
      type:    type as "COMMENT" | "CONNECTION_REQUEST",
      status:  "PENDING",
      payload,
    },
  });

  return NextResponse.json({
    ok: true,
    message: "Job queued — the extension will execute it within 30 seconds.",
  });
}
