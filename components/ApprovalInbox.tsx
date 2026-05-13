"use client";

import { useState } from "react";

type DraftStatus = "AWAITING_APPROVAL" | "EXECUTING" | "EXECUTED" | "FAILED";

interface Draft {
  id: string;
  type: "COMMENT" | "CONNECTION_REQUEST" | "DIRECT_MESSAGE";
  content: string;
  status: DraftStatus;
  postUrn?: string | null;
  errorMessage?: string;
}

interface ScrapedPost {
  text: string;
  url: string;
  activityUrn: string;
}

interface Lead {
  id: string;
  fullName: string;
  headline: string;
  profileUrl: string;
  scrapedPost: string;
  scrapedPostUrl: string;
  activityUrn?: string | null;
  scrapedPosts?: ScrapedPost[] | null;
  drafts: Draft[];
}

// ─── Spinner ──────────────────────────────────────────────────────────────────
function Spinner() {
  return (
    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
    </svg>
  );
}

// ─── Single comment draft for one post ───────────────────────────────────────
function PostCommentRow({
  post,
  draft,
  postIndex,
  onContentChange,
  onExecute,
}: {
  post: ScrapedPost;
  draft: Draft | undefined;
  postIndex: number;
  onContentChange: (draftId: string, content: string) => void;
  onExecute: (draft: Draft) => void;
}) {
  const [expanded, setExpanded] = useState(postIndex === 0); // first post open by default

  if (!draft) return null;

  const isLoading = draft.status === "EXECUTING";
  const isSuccess = draft.status === "EXECUTED";
  const isFailed  = draft.status === "FAILED";

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      {/* Post header — click to expand */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-start gap-3 p-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <span className="text-xs font-semibold text-gray-400 mt-0.5 shrink-0">
          Post {postIndex + 1}
        </span>
        <p className="text-xs text-gray-600 line-clamp-2 flex-1">{post.text}</p>
        <div className="flex items-center gap-2 shrink-0">
          {isSuccess && (
            <span className="text-xs font-medium text-green-600">✓ Commented</span>
          )}
          {isFailed && (
            <span className="text-xs font-medium text-red-500">✗ Failed</span>
          )}
          {post.url && (
            <a
              href={post.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-xs text-indigo-500 hover:underline"
            >
              View ↗
            </a>
          )}
          <span className="text-gray-400 text-xs">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      {/* Comment draft — shown when expanded */}
      {expanded && !isSuccess && (
        <div className="p-3 space-y-2 bg-white border-t border-gray-100">
          <p className="text-xs font-medium text-indigo-600 uppercase tracking-wide">AI Comment Draft</p>
          <textarea
            value={draft.content}
            onChange={e => onContentChange(draft.id, e.target.value)}
            disabled={isLoading}
            rows={3}
            className="w-full rounded-lg border border-gray-200 bg-gray-50 p-2.5 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-50"
          />
          {isFailed && (
            <p className="text-xs text-red-500">
              {draft.errorMessage ?? "Failed — check your LinkedIn session."}
            </p>
          )}
          <button
            onClick={() => onExecute(draft)}
            disabled={isLoading}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? <><Spinner /> Posting…</> : isFailed ? "↺ Retry" : "Post Comment"}
          </button>
        </div>
      )}

      {expanded && isSuccess && (
        <div className="p-3 border-t border-gray-100">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800">
            ✓ Comment posted successfully
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Connection request section ───────────────────────────────────────────────
function ConnectionRequestRow({
  draft,
  onContentChange,
  onExecute,
}: {
  draft: Draft;
  onContentChange: (draftId: string, content: string) => void;
  onExecute: (draft: Draft, includeNote: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [includeNote, setIncludeNote] = useState(true);

  const isLoading = draft.status === "EXECUTING";
  const isSuccess = draft.status === "EXECUTED";
  const isFailed  = draft.status === "FAILED";

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wide">
          Connection Request
        </span>
        <div className="flex items-center gap-2">
          {isSuccess && <span className="text-xs font-medium text-green-600">✓ Sent</span>}
          {isFailed  && <span className="text-xs font-medium text-red-500">✗ Failed</span>}
          <span className="text-gray-400 text-xs">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      {expanded && !isSuccess && (
        <div className="p-3 space-y-3 bg-white border-t border-gray-100">
          {/* Optional note toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeNote}
              onChange={e => setIncludeNote(e.target.checked)}
              className="w-3.5 h-3.5 rounded accent-indigo-600"
            />
            <span className="text-xs font-medium text-gray-600">Include a personalised note</span>
          </label>

          {includeNote && (
            <>
              <textarea
                value={draft.content}
                onChange={e => onContentChange(draft.id, e.target.value)}
                disabled={isLoading}
                rows={3}
                maxLength={300}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 p-2.5 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-50"
              />
              <p className="text-xs text-gray-400 text-right">{draft.content.length}/300</p>
            </>
          )}

          {!includeNote && (
            <p className="text-xs text-gray-400 italic">
              Connection request will be sent without a note.
            </p>
          )}

          {isFailed && (
            <p className="text-xs text-red-500">
              {draft.errorMessage ?? "Failed — check your LinkedIn session."}
            </p>
          )}

          <button
            onClick={() => onExecute(draft, includeNote)}
            disabled={isLoading}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? <><Spinner /> Sending…</> : isFailed ? "↺ Retry" : "Send Request"}
          </button>
        </div>
      )}

      {expanded && isSuccess && (
        <div className="p-3 border-t border-gray-100">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800">
            ✓ Connection request sent
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Full lead card ───────────────────────────────────────────────────────────
function LeadCard({ lead }: { lead: Lead }) {
  const [drafts, setDrafts] = useState<Draft[]>(lead.drafts);

  // Normalise posts: prefer scrapedPosts array, fall back to single legacy fields
  const posts: ScrapedPost[] = (lead.scrapedPosts as ScrapedPost[] | null | undefined)?.length
    ? (lead.scrapedPosts as ScrapedPost[])
    : lead.scrapedPost
    ? [{ text: lead.scrapedPost, url: lead.scrapedPostUrl ?? "", activityUrn: lead.activityUrn ?? "" }]
    : [];

  const updateDraftContent = (draftId: string, content: string) =>
    setDrafts(prev => prev.map(d => d.id === draftId ? { ...d, content } : d));

  const updateDraftStatus = (draftId: string, status: DraftStatus) =>
    setDrafts(prev => prev.map(d => d.id === draftId ? { ...d, status } : d));

  const updateDraftError = (draftId: string, msg: string) =>
    setDrafts(prev => prev.map(d => d.id === draftId ? { ...d, errorMessage: msg } : d));

  const executeAction = async (draft: Draft, content?: string, overrideNote?: boolean) => {
    updateDraftError(draft.id, "");
    updateDraftStatus(draft.id, "EXECUTING");

    try {
      const body: Record<string, unknown> = {
        draftId:   draft.id,
        leadId:    lead.id,
        content:   content ?? draft.content,
        type:      draft.type,
        targetUrl: draft.type === "COMMENT" ? (draft.postUrn ? `https://www.linkedin.com/feed/update/${encodeURIComponent(draft.postUrn)}` : lead.scrapedPostUrl) : lead.profileUrl,
      };

      // For connection request with no note: send empty string content
      if (draft.type === "CONNECTION_REQUEST" && overrideNote === false) {
        body.content = "";
      }

      const res = await fetch("/api/execute-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail ?? data.error ?? "Execution failed");
      }

      updateDraftStatus(draft.id, "EXECUTED");
    } catch (e: any) {
      updateDraftError(draft.id, e.message ?? "Unknown error");
      updateDraftStatus(draft.id, "FAILED");
    }
  };

  // Sort drafts: comment drafts (linked to posts) + connection request
  const commentDrafts = drafts.filter(d => d.type === "COMMENT");
  const connDraft     = drafts.find(d => d.type === "CONNECTION_REQUEST");

  const engagedCount = drafts.filter(d => d.status === "EXECUTED").length;
  const totalActions = drafts.length;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Lead header */}
      <div className="px-5 py-4 flex items-start justify-between border-b border-gray-100">
        <div className="min-w-0">
          <a
            href={lead.profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-gray-900 hover:underline text-sm"
          >
            {lead.fullName}
          </a>
          <p className="text-xs text-gray-500 mt-0.5 truncate max-w-sm">{lead.headline}</p>
        </div>
        {engagedCount > 0 && (
          <span className="text-xs text-green-600 font-medium bg-green-50 px-2 py-0.5 rounded-full shrink-0 ml-3">
            {engagedCount}/{totalActions} done
          </span>
        )}
      </div>

      <div className="px-5 py-4 space-y-3">
        {/* Posts + comment drafts */}
        {posts.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              {posts.length} Post{posts.length > 1 ? "s" : ""} · Comment Drafts
            </p>
            {posts.map((post, i) => {
              // Match this post to its comment draft by postUrn
              const draft = commentDrafts.find(d => d.postUrn === post.activityUrn)
                ?? commentDrafts[i]; // fallback: positional
              return (
                <PostCommentRow
                  key={post.activityUrn || i}
                  post={post}
                  draft={draft}
                  postIndex={i}
                  onContentChange={updateDraftContent}
                  onExecute={d => executeAction(d)}
                />
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3">
            <p className="text-xs text-gray-400">
              No posts found for this lead — comment drafts unavailable.
            </p>
          </div>
        )}

        {/* Connection request */}
        {connDraft && (
          <ConnectionRequestRow
            draft={connDraft}
            onContentChange={updateDraftContent}
            onExecute={(d, includeNote) =>
              executeAction(d, includeNote ? d.content : "", includeNote)
            }
          />
        )}

        {/* Edge case: no drafts at all (AI + fallback both failed) */}
        {drafts.length === 0 && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
            <p className="text-xs text-amber-700 font-medium">
              Draft generation is still in progress — refresh the page in a moment.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Inbox ────────────────────────────────────────────────────────────────────
export default function ApprovalInbox({ leads }: { leads: Lead[] }) {
  if (leads.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400">
        <p className="text-lg font-medium">Inbox is empty</p>
        <p className="text-sm mt-1">Add leads to start generating drafts.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {leads.map(lead => (
        <LeadCard key={lead.id} lead={lead} />
      ))}
    </div>
  );
}
