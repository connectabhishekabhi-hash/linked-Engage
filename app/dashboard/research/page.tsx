"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

// ── Types ────────────────────────────────────────────────────────────────────
type ResearchStatus =
  | "DRAFT"
  | "DISCOVERING"
  | "RESEARCHING"
  | "QUALIFYING"
  | "FINDING_CONTACTS"
  | "ANALYZING"
  | "COMPLETED"
  | "PAUSED"
  | "FAILED";

interface ResearchCampaign {
  id:              string;
  name:            string;
  industry:        string;
  location:        string;
  companySize:     string | null;
  status:          ResearchStatus;
  companiesFound:  number;
  qualified:       number;
  contactsFound:   number;
  targetCount:     number;
  createdAt:       string;
}

// ── Status badge ─────────────────────────────────────────────────────────────
const STATUS_STYLE: Record<ResearchStatus, string> = {
  DRAFT:            "bg-gray-50    text-gray-600    border-gray-200",
  DISCOVERING:      "bg-blue-50    text-blue-700    border-blue-200",
  RESEARCHING:      "bg-amber-50   text-amber-700   border-amber-200",
  QUALIFYING:       "bg-purple-50  text-purple-700  border-purple-200",
  FINDING_CONTACTS: "bg-indigo-50  text-indigo-700  border-indigo-200",
  ANALYZING:        "bg-pink-50    text-pink-700    border-pink-200",
  COMPLETED:        "bg-green-50   text-green-700   border-green-200",
  PAUSED:           "bg-yellow-50  text-yellow-700  border-yellow-200",
  FAILED:           "bg-red-50     text-red-700     border-red-200",
};

const STATUS_DOT: Record<ResearchStatus, string> = {
  DRAFT:            "bg-gray-400",
  DISCOVERING:      "bg-blue-500    animate-pulse",
  RESEARCHING:      "bg-amber-500   animate-pulse",
  QUALIFYING:       "bg-purple-500  animate-pulse",
  FINDING_CONTACTS: "bg-indigo-500  animate-pulse",
  ANALYZING:        "bg-pink-500    animate-pulse",
  COMPLETED:        "bg-green-500",
  PAUSED:           "bg-yellow-500",
  FAILED:           "bg-red-500",
};

function StatusBadge({ status }: { status: ResearchStatus }) {
  const label = status.replace(/_/g, " ");
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[status]}`} />
      {label.charAt(0) + label.slice(1).toLowerCase()}
    </span>
  );
}

// ── Chip input ───────────────────────────────────────────────────────────────
function ChipInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  const [input, setInput] = useState("");

  const addChip = () => {
    const trimmed = input.trim();
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
    }
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addChip();
    }
    if (e.key === "Backspace" && input === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-1.5 w-full rounded-xl border border-gray-200 px-3 py-2 min-h-[42px] focus-within:ring-2 focus-within:ring-indigo-300 transition-shadow">
        {value.map((chip) => (
          <span
            key={chip}
            className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 px-2 py-0.5 text-xs font-medium"
          >
            {chip}
            <button
              type="button"
              onClick={() => onChange(value.filter((c) => c !== chip))}
              className="text-indigo-400 hover:text-indigo-600"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={addChip}
          placeholder={value.length === 0 ? placeholder : ""}
          className="flex-1 min-w-[120px] text-sm outline-none bg-transparent"
        />
      </div>
      <p className="text-xs text-gray-400">Press Enter or comma to add</p>
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mb-4">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
          stroke="#6366f1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 2L9 6M15 2L15 6M9 6C6.24 6 4 8.24 4 11L4 13C4 15.76 6.24 18 9 18L15 18C17.76 18 20 15.76 20 13L20 11C20 8.24 17.76 6 15 6L9 6Z"/>
          <path d="M12 18L12 22M8 22L16 22"/>
        </svg>
      </div>
      <h3 className="text-base font-semibold text-gray-900">No research campaigns yet</h3>
      <p className="text-sm text-gray-400 mt-1 max-w-xs">
        Create your first research campaign to discover and qualify prospects automatically.
      </p>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function ResearchPage() {
  const [campaigns, setCampaigns] = useState<ResearchCampaign[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState("");
  const [success,   setSuccess]   = useState("");
  const [showForm,  setShowForm]  = useState(false);

  // Form state
  const [form, setForm] = useState({
    name:            "",
    industry:        "",
    location:        "",
    companySize:     "",
    services:        [] as string[],
    exclusions:      [] as string[],
    targetCount:     30,
    instructions:    "",
  });

  const set = (field: string) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => setForm((p) => ({ ...p, [field]: e.target.value }));

  // Load campaigns
  const load = useCallback(async () => {
    try {
      const res  = await fetch("/api/research");
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

    const res = await fetch("/api/research", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        name:         form.name,
        industry:     form.industry,
        location:     form.location,
        companySize:  form.companySize || undefined,
        services:     form.services,
        exclusions:   form.exclusions,
        targetCount:  form.targetCount,
        instructions: form.instructions || undefined,
      }),
    });
    const data = await res.json();
    setSaving(false);

    if (res.ok) {
      setCampaigns((p) => [data.campaign, ...p]);
      setForm({ name: "", industry: "", location: "", companySize: "", services: [], exclusions: [], targetCount: 30, instructions: "" });
      setShowForm(false);
      setSuccess("Research campaign created!");
      setTimeout(() => setSuccess(""), 3000);
    } else {
      setError(data.error ?? "Failed to create campaign");
    }
  };

  const formatDate = (d: string) => {
    const date = new Date(d);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Research</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Discover companies, qualify prospects, and find decision makers automatically.
          </p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-5 py-2.5 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Research Campaign
          </button>
        )}
      </div>

      {success && (
        <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2">{success}</p>
      )}

      {/* Creation form */}
      {showForm && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-900">New Research Campaign</h2>
            <button
              onClick={() => setShowForm(false)}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <form onSubmit={handleCreate} className="px-6 py-5 space-y-5">
            {/* Row 1: Name */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Campaign Name
              </label>
              <input
                value={form.name}
                onChange={set("name")}
                required
                placeholder="e.g. SaaS Companies in NYC"
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 transition-shadow"
              />
            </div>

            {/* Row 2: Industry + Location */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Industry
                </label>
                <input
                  value={form.industry}
                  onChange={set("industry")}
                  required
                  placeholder="e.g. Marketing Agencies"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 transition-shadow"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Location
                </label>
                <input
                  value={form.location}
                  onChange={set("location")}
                  required
                  placeholder="e.g. New York, NY"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 transition-shadow"
                />
              </div>
            </div>

            {/* Row 3: Company Size + Prospects */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Company Size <span className="text-gray-400 normal-case font-normal">(optional)</span>
                </label>
                <input
                  value={form.companySize}
                  onChange={set("companySize")}
                  placeholder="e.g. 10-50 employees"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 transition-shadow"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Number of Prospects
                </label>
                <input
                  type="number"
                  value={form.targetCount}
                  onChange={(e) => setForm((p) => ({ ...p, targetCount: Math.max(5, Math.min(100, parseInt(e.target.value) || 30)) }))}
                  min={5}
                  max={100}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 transition-shadow"
                />
                <p className="text-xs text-gray-400">Between 5 and 100</p>
              </div>
            </div>

            {/* Services/Keywords chips */}
            <ChipInput
              label="Services / Keywords"
              value={form.services}
              onChange={(v) => setForm((p) => ({ ...p, services: v }))}
              placeholder="e.g. SEO, PPC, content marketing"
            />

            {/* Exclusions chips */}
            <ChipInput
              label="Exclusions"
              value={form.exclusions}
              onChange={(v) => setForm((p) => ({ ...p, exclusions: v }))}
              placeholder="e.g. enterprise, government"
            />

            {/* Additional Instructions */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Additional Instructions <span className="text-gray-400 normal-case font-normal">(optional)</span>
              </label>
              <textarea
                value={form.instructions}
                onChange={set("instructions")}
                rows={3}
                placeholder="Any specific criteria or notes for the research..."
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 transition-shadow"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>
            )}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors"
              >
                {saving ? "Creating..." : "Create Campaign"}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Campaign list */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold text-gray-700">
          Your Research Campaigns
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
              <Link
                key={c.id}
                href={`/dashboard/research/${c.id}`}
                className="block bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4 hover:border-indigo-200 hover:shadow-md transition-all"
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Left: info */}
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <p className="font-semibold text-gray-900 text-sm truncate">{c.name}</p>
                      <StatusBadge status={c.status} />
                    </div>

                    <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                      <span className="flex items-center gap-1">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 21h18M3 7v1a3 3 0 006 0V7m0 0a3 3 0 016 0v1a3 3 0 006 0V7M3 7h18" />
                        </svg>
                        {c.industry}
                      </span>
                      <span className="flex items-center gap-1">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                          <circle cx="12" cy="10" r="3" />
                        </svg>
                        {c.location}
                      </span>
                      <span className="text-gray-300">|</span>
                      <span>{formatDate(c.createdAt)}</span>
                    </div>

                    {/* Progress counters */}
                    <div className="flex items-center gap-4 mt-2">
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="w-5 h-5 rounded-md bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-[10px]">
                          {c.companiesFound}
                        </span>
                        <span className="text-gray-400">found</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="w-5 h-5 rounded-md bg-green-50 text-green-600 flex items-center justify-center font-bold text-[10px]">
                          {c.qualified}
                        </span>
                        <span className="text-gray-400">qualified</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="w-5 h-5 rounded-md bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-[10px]">
                          {c.contactsFound}
                        </span>
                        <span className="text-gray-400">contacts</span>
                      </div>
                    </div>
                  </div>

                  {/* Right: arrow */}
                  <div className="text-gray-300 mt-1">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
