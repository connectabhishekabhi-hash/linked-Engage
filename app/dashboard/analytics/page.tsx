"use client";

import { useState, useEffect, useCallback } from "react";

interface ViewerData {
  totalViews:   number;
  reactions:    number;
  comments:     number;
  shares:       number;
  clicks:       number;
  topCompanies: { name: string; count: number }[];
  topTitles:    { name: string; count: number }[];
}

interface PostAnalytics {
  id:          string;
  postUrn:     string;
  postUrl:     string | null;
  postPreview: string | null;
  viewerData:  ViewerData;
  fetchedAt:   string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sumField(records: PostAnalytics[], key: keyof ViewerData) {
  return records.reduce((acc, r) => acc + ((r.viewerData[key] as number) ?? 0), 0);
}

// ── Mini bar ──────────────────────────────────────────────────────────────────
function Bar({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-700 font-medium truncate max-w-[180px]">{label}</span>
        <span className="text-gray-400 shrink-0 ml-2">{count}</span>
      </div>
      <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full bg-indigo-500 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── Summary tile ──────────────────────────────────────────────────────────────
function SummaryTile({ label, value, icon, color }: {
  label: string; value: number; icon: React.ReactNode; color: string;
}) {
  return (
    <div className={`rounded-2xl border p-4 flex items-center gap-3 ${color}`}>
      <div className="w-9 h-9 rounded-xl bg-white/60 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-xl font-bold text-gray-900 leading-none">{value.toLocaleString()}</p>
        <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      </div>
    </div>
  );
}

// ── Per-post card ─────────────────────────────────────────────────────────────
function PostCard({ record }: { record: PostAnalytics }) {
  const vd         = record.viewerData;
  const maxCompany = Math.max(...(vd.topCompanies?.map((c) => c.count) ?? [0]), 1);
  const maxTitle   = Math.max(...(vd.topTitles?.map((t) => t.count) ?? [0]), 1);
  const hasDemo    = (vd.topCompanies?.length ?? 0) > 0 || (vd.topTitles?.length ?? 0) > 0;

  const stats = [
    { label: "Views",     val: vd.totalViews, icon: "👁️" },
    { label: "Reactions", val: vd.reactions,  icon: "❤️" },
    { label: "Comments",  val: vd.comments,   icon: "💬" },
    { label: "Shares",    val: vd.shares,     icon: "🔁" },
    { label: "Clicks",    val: vd.clicks,     icon: "🖱️" },
  ];

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0 space-y-0.5">
          {record.postPreview ? (
            <p className="text-sm text-gray-800 font-medium line-clamp-2">{record.postPreview}</p>
          ) : (
            <p className="text-xs font-mono text-gray-400 truncate">{record.postUrn}</p>
          )}
          {record.postUrl && (
            <a href={record.postUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs text-indigo-500 hover:underline inline-block">
              View on LinkedIn ↗
            </a>
          )}
        </div>
        <span className="text-xs text-gray-400 shrink-0 whitespace-nowrap">
          {new Date(record.fetchedAt).toLocaleDateString()}
        </span>
      </div>

      <div className="px-5 py-4 space-y-5">
        <div className="grid grid-cols-5 gap-2">
          {stats.map(({ label, val, icon }) => (
            <div key={label} className="bg-gray-50 rounded-xl p-3 text-center border border-gray-100">
              <p className="text-base">{icon}</p>
              <p className="text-lg font-bold text-gray-900 mt-0.5">{val.toLocaleString()}</p>
              <p className="text-[10px] text-gray-400 mt-0.5 uppercase tracking-wide">{label}</p>
            </div>
          ))}
        </div>

        {hasDemo ? (
          <div className="grid grid-cols-2 gap-6">
            {vd.topCompanies?.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Top Companies</p>
                {vd.topCompanies.slice(0, 6).map((c) => (
                  <Bar key={c.name} label={c.name} count={c.count} max={maxCompany} />
                ))}
              </div>
            )}
            {vd.topTitles?.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Top Job Titles</p>
                {vd.topTitles.slice(0, 6).map((t) => (
                  <Bar key={t.name} label={t.name} count={t.count} max={maxTitle} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-gray-400">
            Demographic breakdowns require an Organisation Page scope.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const [analytics,  setAnalytics]  = useState<PostAnalytics[]>([]);
  const [loading,    setLoading]    = useState(true);

  // Sync scheduled posts
  const [syncing,    setSyncing]    = useState(false);
  const [syncMsg,    setSyncMsg]    = useState<{ text: string; ok: boolean } | null>(null);

  // Manual URL fetch
  const [postUrl,    setPostUrl]    = useState("");
  const [fetching,   setFetching]   = useState(false);
  const [fetchMsg,   setFetchMsg]   = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const res  = await fetch("/api/analytics");
      const data = await res.json();
      if (res.ok) setAnalytics(data.analytics ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Sync scheduled posts ────────────────────────────────────────────────────
  const handleSync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/analytics/sync", { method: "POST" });
      let data: any = {};
      try { data = await res.json(); } catch { /* empty body */ }
      setSyncing(false);
      if (res.ok) {
        setSyncMsg({
          text: data.synced
            ? `Synced ${data.synced} post${data.synced !== 1 ? "s" : ""}.`
            : "No new posts from the scheduler yet.",
          ok: true,
        });
        load();
      } else {
        setSyncMsg({ text: data.error ?? "Sync failed.", ok: false });
      }
    } catch {
      setSyncing(false);
      setSyncMsg({ text: "Network error.", ok: false });
    }
  };

  // ── Manual URL fetch ────────────────────────────────────────────────────────
  const handleFetch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!postUrl.trim()) return;
    setFetching(true);
    setFetchMsg(null);
    try {
      const res  = await fetch("/api/analytics/fetch", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ postUrl: postUrl.trim() }),
      });
      const data = await res.json();
      setFetching(false);
      if (res.ok) {
        setPostUrl("");
        setFetchMsg({ text: "Stats fetched successfully.", ok: true });
        load();
      } else {
        setFetchMsg({ text: data.error ?? "Failed to fetch stats.", ok: false });
      }
    } catch {
      setFetching(false);
      setFetchMsg({ text: "Network error.", ok: false });
    }
  };

  const totalViews     = sumField(analytics, "totalViews");
  const totalReactions = sumField(analytics, "reactions");
  const totalComments  = sumField(analytics, "comments");
  const totalShares    = sumField(analytics, "shares");

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Analytics</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Track impressions and engagement for your LinkedIn posts.
        </p>
      </div>

      {/* Two action cards side by side */}
      <div className="grid grid-cols-2 gap-4">

        {/* Card 1 — Sync scheduler posts */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4 space-y-3">
          <div>
            <p className="text-sm font-bold text-gray-900">Scheduled Posts</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Sync stats for posts you published via the scheduler.
            </p>
          </div>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 w-full justify-center rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold py-2.5 transition-colors"
          >
            {syncing ? (
              <>
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeOpacity="0.25"/>
                  <path d="M21 12a9 9 0 00-9-9"/>
                </svg>
                Syncing…
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10"/>
                  <polyline points="1 20 1 14 7 14"/>
                  <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
                </svg>
                Sync Now
              </>
            )}
          </button>
          {syncMsg && (
            <p className={`text-xs rounded-lg px-3 py-2 border ${
              syncMsg.ok ? "bg-green-50 text-green-700 border-green-200"
                         : "bg-red-50 text-red-600 border-red-200"
            }`}>{syncMsg.text}</p>
          )}
        </div>

        {/* Card 2 — Manual URL */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4 space-y-3">
          <div>
            <p className="text-sm font-bold text-gray-900">Any Post</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Paste any LinkedIn post URL to pull its stats.
            </p>
          </div>
          <form onSubmit={handleFetch} className="space-y-2">
            <input
              value={postUrl}
              onChange={(e) => setPostUrl(e.target.value)}
              placeholder="linkedin.com/feed/update/urn:li:ugcPost:…"
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 transition-shadow"
            />
            <button
              type="submit"
              disabled={fetching || !postUrl.trim()}
              className="w-full rounded-xl bg-gray-900 hover:bg-gray-700 disabled:opacity-40 text-white text-sm font-semibold py-2.5 transition-colors"
            >
              {fetching ? "Fetching…" : "Fetch Stats"}
            </button>
          </form>
          {fetchMsg && (
            <p className={`text-xs rounded-lg px-3 py-2 border ${
              fetchMsg.ok ? "bg-green-50 text-green-700 border-green-200"
                          : "bg-red-50 text-red-600 border-red-200"
            }`}>{fetchMsg.text}</p>
          )}
        </div>
      </div>

      {/* Summary tiles */}
      {analytics.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          <SummaryTile label="Total Views" value={totalViews} color="bg-indigo-50 border-indigo-100"
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
          />
          <SummaryTile label="Reactions" value={totalReactions} color="bg-rose-50 border-rose-100"
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>}
          />
          <SummaryTile label="Comments" value={totalComments} color="bg-amber-50 border-amber-100"
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>}
          />
          <SummaryTile label="Shares" value={totalShares} color="bg-emerald-50 border-emerald-100"
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>}
          />
        </div>
      )}

      {/* Post list */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-sm text-gray-400">
          Loading…
        </div>
      ) : analytics.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col items-center justify-center py-20 text-center">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mb-4">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
              stroke="#6366f1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10"/>
              <line x1="12" y1="20" x2="12" y2="4"/>
              <line x1="6"  y1="20" x2="6"  y2="14"/>
            </svg>
          </div>
          <h3 className="text-base font-semibold text-gray-900">No analytics yet</h3>
          <p className="text-sm text-gray-400 mt-1 max-w-xs">
            Paste a post URL above to fetch its stats, or sync posts you scheduled with this tool.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-gray-400">{analytics.length} post{analytics.length !== 1 ? "s" : ""} tracked</p>
          {analytics.map((record) => (
            <PostCard key={record.id} record={record} />
          ))}
        </div>
      )}
    </div>
  );
}
