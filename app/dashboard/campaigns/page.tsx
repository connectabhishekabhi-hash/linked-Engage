"use client";

import { useState, useEffect, useCallback } from "react";

type CampaignStatus = "ACTIVE" | "PAUSED" | "ARCHIVED";

interface Campaign {
  id:              string;
  name:            string;
  targetPostUrl:   string;
  triggerKeyword:  string;
  messageTemplate: string;
  status:          CampaignStatus;
  leadsTriggered:  number;
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
        Create your first keyword campaign to automatically DM LinkedIn commenters.
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
  });

  const set = (field: string) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => setForm((p) => ({ ...p, [field]: e.target.value }));

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
      setForm({ name: "", targetPostUrl: "", triggerKeyword: "", messageTemplate: "" });
      setSuccess("Campaign created!");
      setTimeout(() => setSuccess(""), 3000);
    } else {
      setError(data.error ?? "Failed to create campaign");
    }
  };

  // Toggle ACTIVE ↔ PAUSED
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

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Campaigns</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Auto-send a DM or connection note to anyone who comments a keyword on your post.
        </p>
      </div>

      {/* How it works */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { n: "1", title: "Pick a post",       desc: "Paste the URL of any LinkedIn post you authored" },
          { n: "2", title: "Set a keyword",     desc: "e.g. SEND — users comment it to opt in"         },
          { n: "3", title: "Auto DM fires",     desc: "Extension sends your template when keyword found" },
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
        <form onSubmit={handleCreate} className="px-6 py-5 space-y-4">
          {/* Row 1 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Campaign Name
              </label>
              <input
                value={form.name}
                onChange={set("name")}
                required
                placeholder="e.g. Free Guide Giveaway"
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 transition-shadow"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Trigger Keyword
              </label>
              <input
                value={form.triggerKeyword}
                onChange={set("triggerKeyword")}
                required
                placeholder="SEND"
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-indigo-300 transition-shadow"
              />
              <p className="text-xs text-gray-400">
                Case-insensitive. Stored in UPPERCASE.
              </p>
            </div>
          </div>

          {/* Target post URL */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Target LinkedIn Post URL
            </label>
            <input
              value={form.targetPostUrl}
              onChange={set("targetPostUrl")}
              required
              type="url"
              placeholder="https://www.linkedin.com/feed/update/urn:li:ugcPost:..."
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 transition-shadow"
            />
          </div>

          {/* Message template */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                DM / Connection Note Template
              </label>
              <span className="text-xs text-gray-400">{form.messageTemplate.length}/300</span>
            </div>
            <textarea
              value={form.messageTemplate}
              onChange={set("messageTemplate")}
              required
              rows={4}
              maxLength={300}
              placeholder={`Hi {{firstName}},\n\nThanks for your interest! Here's the link to the guide: ...\n\nHappy to connect!`}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 transition-shadow"
            />
            <p className="text-xs text-gray-400">
              Use <code className="bg-gray-100 px-1 rounded font-mono">{"{{firstName}}"}</code> as a placeholder for the commenter's first name.
            </p>
          </div>

          {error   && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}
          {success && <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2">✓ {success}</p>}

          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors"
          >
            {saving ? "Creating…" : "Create Campaign"}
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
            Loading…
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
                    <div className="flex items-center gap-2.5">
                      <p className="font-semibold text-gray-900 text-sm truncate">{c.name}</p>
                      <StatusBadge status={c.status} />
                    </div>

                    <div className="flex items-center gap-4 text-xs text-gray-400 flex-wrap">
                      <span>
                        Keyword:{" "}
                        <span className="font-mono font-semibold text-indigo-600">
                          {c.triggerKeyword}
                        </span>
                      </span>
                      <span>
                        Triggered:{" "}
                        <span className="font-semibold text-gray-700">{c.leadsTriggered}</span>
                      </span>
                      <a
                        href={c.targetPostUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-500 hover:underline truncate max-w-xs"
                      >
                        View post ↗
                      </a>
                    </div>

                    {/* Template preview */}
                    <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 line-clamp-2 mt-2 border border-gray-100">
                      {c.messageTemplate}
                    </p>
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
