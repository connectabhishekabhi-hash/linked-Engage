"use client";

import { useState, useEffect, useCallback } from "react";

type CampaignStatus = "ACTIVE" | "PAUSED" | "ARCHIVED";

interface Campaign {
  id:              string;
  name:            string;
  targetPostUrl:   string | null;
  triggerKeyword:  string | null;
  messageTemplate: string | null;
  status:          CampaignStatus;
  leadsTriggered:  number;
  monitorAllPosts: boolean;
  autoConnect:     boolean;
  createdAt:       string;
}

// ── Status badge ──────────────────────────────────────────────────────────────
const STATUS_STYLE: Record<CampaignStatus, string> = {
  ACTIVE:   "bg-green-50  text-green-700  border-green-200",
  PAUSED:   "bg-amber-50  text-amber-700  border-amber-200",
  ARCHIVED: "bg-gray-100  text-gray-500   border-gray-200",
};

const STATUS_DOT: Record<CampaignStatus, string> = {
  ACTIVE:   "bg-green-500 animate-pulse",
  PAUSED:   "bg-amber-400",
  ARCHIVED: "bg-gray-400",
};

function StatusBadge({ status }: { status: CampaignStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[status]}`} />
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

// ── Mode badge ────────────────────────────────────────────────────────────────
function ModeBadge({ campaign }: { campaign: Campaign }) {
  const badges = [];
  if (campaign.monitorAllPosts) {
    badges.push(
      <span key="all" className="inline-flex items-center gap-1 rounded-full border border-purple-200 bg-purple-50 text-purple-700 px-2 py-0.5 text-xs font-medium">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>
        All Posts
      </span>
    );
  }
  if (campaign.autoConnect) {
    badges.push(
      <span key="auto" className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 text-blue-700 px-2 py-0.5 text-xs font-medium">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4-4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
        Auto-Connect
      </span>
    );
  }
  return badges.length > 0 ? <div className="flex gap-1.5 mt-1">{badges}</div> : null;
}

// ── Toggle switch component ──────────────────────────────────────────────────
function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description: string;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <div className="pt-0.5">
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => onChange(!checked)}
          className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${
            checked ? "bg-indigo-600" : "bg-gray-200"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform ${
              checked ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
      </div>
      <div>
        <p className="text-sm font-medium text-gray-700 group-hover:text-gray-900">{label}</p>
        <p className="text-xs text-gray-400 leading-snug mt-0.5">{description}</p>
      </div>
    </label>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mb-4">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
          stroke="#6366f1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
        </svg>
      </div>
      <h3 className="text-base font-semibold text-gray-900">No campaigns yet</h3>
      <p className="text-sm text-gray-400 mt-1 max-w-xs">
        Create your first campaign to automatically connect with LinkedIn commenters.
      </p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState("");
  const [success,   setSuccess]   = useState("");

  // Form state
  const [form, setForm] = useState({
    name:            "",
    targetPostUrl:   "",
    triggerKeyword:  "",
    messageTemplate: "",
    monitorAllPosts: false,
    autoConnect:     false,
  });

  const set = (field: string) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => setForm((p) => ({ ...p, [field]: e.target.value }));

  const setBool = (field: string) => (v: boolean) =>
    setForm((p) => ({ ...p, [field]: v }));

  // Load campaigns
  const load = useCallback(async () => {
    try {
      const res  = await fetch("/api/campaigns");
      const data = await res.json();
      if (res.ok) setCampaigns(data.campaigns ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Create campaign
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    const res  = await fetch("/api/campaigns", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(form),
    });
    const data = await res.json();
    setSaving(false);

    if (res.ok) {
      setCampaigns((p) => [data.campaign, ...p]);
      setForm({ name: "", targetPostUrl: "", triggerKeyword: "", messageTemplate: "", monitorAllPosts: false, autoConnect: false });
      setSuccess("Campaign created!");
      setTimeout(() => setSuccess(""), 3000);
    } else {
      setError(data.error ?? "Failed to create campaign");
    }
  };

  // Toggle ACTIVE <> PAUSED
  const toggleStatus = async (campaign: Campaign) => {
    const next = campaign.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    const res  = await fetch(`/api/campaigns/${campaign.id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ status: next }),
    });
    if (res.ok) {
      setCampaigns((p) =>
        p.map((c) => (c.id === campaign.id ? { ...c, status: next } : c))
      );
    }
  };

  // Delete
  const handleDelete = async (id: string) => {
    if (!confirm("Delete this campaign?")) return;
    const res = await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
    if (res.ok) setCampaigns((p) => p.filter((c) => c.id !== id));
  };

  // Determine which fields are required
  const needsPostUrl  = !form.monitorAllPosts;
  const needsKeyword  = !form.autoConnect;

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Campaigns</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Auto-connect with LinkedIn commenters — on specific posts or across all your content.
        </p>
      </div>

      {/* How it works */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { n: "1", title: "Choose mode",      desc: "Monitor a specific post or all your posts automatically" },
          { n: "2", title: "Set triggers",     desc: "Keyword-based or auto-connect with every commenter"      },
          { n: "3", title: "Auto DM fires",    desc: "Extension sends your connection note when triggered"     },
        ].map((s) => (
          <div key={s.n} className="bg-white rounded-2xl border border-gray-100 p-4 space-y-2 text-center shadow-sm">
            <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-600 text-xs font-bold flex items-center justify-center mx-auto">
              {s.n}
            </div>
            <p className="text-sm font-semibold text-gray-800">{s.title}</p>
            <p className="text-xs text-gray-400 leading-snug">{s.desc}</p>
          </div>
        ))}
      </div>

      {/* Create form */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-900">New Campaign</h2>
        </div>
        <form onSubmit={handleCreate} className="px-6 py-5 space-y-5">
          {/* Campaign mode toggles */}
          <div className="bg-gray-50 rounded-xl border border-gray-100 p-4 space-y-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Campaign Mode</p>
            <Toggle
              checked={form.monitorAllPosts}
              onChange={setBool("monitorAllPosts")}
              label="Monitor all my posts"
              description="Automatically discover and monitor comments across all your LinkedIn posts — no URL needed."
            />
            <Toggle
              checked={form.autoConnect}
              onChange={setBool("autoConnect")}
              label="Auto-connect with all commenters"
              description="Send a connection request to every new commenter — no trigger keyword required."
            />
          </div>

          {/* Row 1: Name + keyword */}
          <div className={`grid gap-4 ${needsKeyword ? "grid-cols-2" : "grid-cols-1"}`}>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Campaign Name
              </label>
              <input
                value={form.name}
                onChange={set("name")}
                required
                placeholder={form.monitorAllPosts ? "e.g. Auto-Connect All Commenters" : "e.g. Free Guide Giveaway"}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 transition-shadow"
              />
            </div>
            {needsKeyword && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Trigger Keyword
                </label>
                <input
                  value={form.triggerKeyword}
                  onChange={set("triggerKeyword")}
                  required={needsKeyword}
                  placeholder="SEND"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-indigo-300 transition-shadow"
                />
                <p className="text-xs text-gray-400">
                  Case-insensitive. Stored in UPPERCASE.
                </p>
              </div>
            )}
          </div>

          {/* Target post URL — only when NOT monitoring all posts */}
          {needsPostUrl && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Target LinkedIn Post URL
              </label>
              <input
                value={form.targetPostUrl}
                onChange={set("targetPostUrl")}
                required={needsPostUrl}
                type="url"
                placeholder="https://www.linkedin.com/feed/update/urn:li:ugcPost:..."
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 transition-shadow"
              />
            </div>
          )}

          {/* Message template — optional */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Connection Note {form.autoConnect && <span className="text-gray-400 normal-case font-normal">(optional)</span>}
              </label>
              <span className="text-xs text-gray-400">{form.messageTemplate.length}/300</span>
            </div>
            <textarea
              value={form.messageTemplate}
              onChange={set("messageTemplate")}
              required={!form.autoConnect}
              rows={3}
              maxLength={300}
              placeholder={
                form.autoConnect
                  ? `Hi {{firstName}},\n\nI noticed you engaged with my content — happy to connect!`
                  : `Hi {{firstName}},\n\nThanks for your interest! Here's the link to the guide: ...\n\nHappy to connect!`
              }
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 transition-shadow"
            />
            <p className="text-xs text-gray-400">
              Use <code className="bg-gray-100 px-1 rounded font-mono">{"{{firstName}}"}</code> as a placeholder.
              {form.autoConnect && " Leave empty to send connection requests without a note."}
            </p>
          </div>

          {error   && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}
          {success && <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2">{success}</p>}

          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors"
          >
            {saving ? "Creating..." : "Create Campaign"}
          </button>
        </form>
      </div>

      {/* Campaign list */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold text-gray-700">
          Your Campaigns
          {campaigns.length > 0 && (
            <span className="ml-2 text-gray-400 font-normal">({campaigns.length})</span>
          )}
        </h2>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-gray-400">
            Loading...
          </div>
        ) : campaigns.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
            <EmptyState />
          </div>
        ) : (
          <div className="space-y-3">
            {campaigns.map((c) => (
              <div
                key={c.id}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4"
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Left: info */}
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <p className="font-semibold text-gray-900 text-sm truncate">{c.name}</p>
                      <StatusBadge status={c.status} />
                    </div>

                    <ModeBadge campaign={c} />

                    <div className="flex items-center gap-4 text-xs text-gray-400 flex-wrap mt-1">
                      {c.triggerKeyword && (
                        <span>
                          Keyword:{" "}
                          <span className="font-mono font-semibold text-indigo-600">
                            {c.triggerKeyword}
                          </span>
                        </span>
                      )}
                      <span>
                        Triggered:{" "}
                        <span className="font-semibold text-gray-700">{c.leadsTriggered}</span>
                      </span>
                      {c.targetPostUrl && (
                        <a
                          href={c.targetPostUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-500 hover:underline truncate max-w-xs"
                        >
                          View post &#8599;
                        </a>
                      )}
                      {c.monitorAllPosts && !c.targetPostUrl && (
                        <span className="text-purple-500 font-medium">Monitoring all posts</span>
                      )}
                    </div>

                    {/* Template preview */}
                    {c.messageTemplate && (
                      <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 line-clamp-2 mt-2 border border-gray-100">
                        {c.messageTemplate}
                      </p>
                    )}
                    {!c.messageTemplate && c.autoConnect && (
                      <p className="text-xs text-gray-400 italic mt-2">
                        No connection note — sending blank connection requests
                      </p>
                    )}
                  </div>

                  {/* Right: actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => toggleStatus(c)}
                      className={`rounded-xl px-3 py-1.5 text-xs font-semibold border transition-colors ${
                        c.status === "ACTIVE"
                          ? "border-amber-200 text-amber-600 hover:bg-amber-50"
                          : "border-green-200 text-green-600 hover:bg-green-50"
                      }`}
                    >
                      {c.status === "ACTIVE" ? "Pause" : "Activate"}
                    </button>
                    <button
                      onClick={() => handleDelete(c.id)}
                      className="rounded-xl px-3 py-1.5 text-xs font-semibold border border-red-200 text-red-500 hover:bg-red-50 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
