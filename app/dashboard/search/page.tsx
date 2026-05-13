"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { buildSearchUrl, buildQuerySummary } from "@/lib/buildSearchUrl";

interface SearchProfile {
  fullName:         string;
  headline:         string;
  profileUrl:       string;
  profileUrn:       string;
  profileImageUrl:  string;
  connectionDegree: string;
}

// ── Degree badge ──────────────────────────────────────────────────────────────
function DegreeBadge({ degree }: { degree: string }) {
  const map: Record<string, string> = {
    "1st":  "bg-blue-50 text-blue-600 border-blue-200",
    "2nd":  "bg-indigo-50 text-indigo-600 border-indigo-200",
    "3rd+": "bg-gray-50 text-gray-500 border-gray-200",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${map[degree] ?? map["3rd+"]}`}>
      {degree}
    </span>
  );
}

// ── Profile result card ───────────────────────────────────────────────────────
function ProfileCard({ profile, added, onAdd }: {
  profile: SearchProfile;
  added:   boolean;
  onAdd:   (p: SearchProfile) => void;
}) {
  const initials = profile.fullName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-4">
      {/* Avatar */}
      <div className="shrink-0 w-11 h-11 rounded-full overflow-hidden bg-indigo-100 flex items-center justify-center">
        {profile.profileImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.profileImageUrl}
            alt={profile.fullName}
            className="w-full h-full object-cover"
            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <span className="text-xs font-bold text-indigo-600">{initials}</span>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <a href={profile.profileUrl} target="_blank" rel="noopener noreferrer"
            className="text-sm font-semibold text-gray-900 hover:underline">
            {profile.fullName}
          </a>
          <DegreeBadge degree={profile.connectionDegree} />
        </div>
        <p className="text-xs text-gray-500 truncate mt-0.5">{profile.headline}</p>
      </div>

      {/* CTA */}
      <button
        suppressHydrationWarning
        onClick={() => onAdd(profile)}
        disabled={added}
        className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
          added
            ? "bg-green-50 text-green-600 border border-green-200 cursor-default"
            : "bg-indigo-600 hover:bg-indigo-700 text-white"
        }`}
      >
        {added ? "✓ Added" : "+ Add Lead"}
      </button>
    </div>
  );
}

// ── Small label + input ───────────────────────────────────────────────────────
function FilterInput({ label, placeholder, value, onChange, note }: {
  label:       string;
  placeholder: string;
  value:       string;
  onChange:    (v: string) => void;
  note?:       string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline gap-2">
        <label className="text-xs font-semibold text-gray-700">{label}</label>
        {note && <span className="text-[10px] text-gray-400">{note}</span>}
      </div>
      <input
        suppressHydrationWarning
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800
          placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-300 transition-shadow"
      />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
// LinkedIn company size codes → human labels
const COMPANY_SIZES = [
  { code: "B", label: "1–10"    },
  { code: "C", label: "11–50"   },
  { code: "D", label: "51–200"  },
  { code: "E", label: "201–500" },
  { code: "F", label: "501–1k"  },
  { code: "G", label: "1k–5k"   },
  { code: "H", label: "5k–10k"  },
  { code: "I", label: "10k+"    },
];

export default function SearchPage() {
  // Structured filters
  const [keywords,           setKeywords]           = useState("");
  const [title,              setTitle]              = useState("");
  const [company,            setCompany]            = useState("");
  const [exclude,            setExclude]            = useState("");
  const [companySizes,       setCompanySizes]       = useState<string[]>([]);
  const [connectionDegrees,  setConnectionDegrees]  = useState<string[]>([]);

  // Search state
  const [searching,  setSearching]  = useState(false);
  const [searchId,   setSearchId]   = useState<string | null>(null);
  const [profiles,   setProfiles]   = useState<SearchProfile[]>([]);
  const [statusMsg,  setStatusMsg]  = useState("");
  const [error,      setError]      = useState<string | null>(null);
  const [added,      setAdded]      = useState<Set<string>>(new Set());
  const [totalFound, setTotalFound] = useState(0);

  const pollRef    = useRef<NodeJS.Timeout | null>(null);
  // Active filter criteria captured at search-start, used to post-filter results
  const filterRef  = useRef<{ title: string; excludeTerms: string[]; degrees: string[] }>({ title: "", excludeTerms: [], degrees: [] });

  // Derive the active filters object once so both preview + API call use it.
  const activeFilters = {
    keywords,
    exclude,
    title,
    company,
    connectionDegrees,
    companySizes,
  };

  // Human-readable summary for the "Search summary" preview in the UI.
  // NOT sent to LinkedIn — the extension uses the full URL from the payload.
  const queryPreview = buildQuerySummary(activeFilters);

  // Full LinkedIn people-search URL built from separate params (no boolean string).
  const searchUrl = buildSearchUrl(activeFilters);

  const hasQuery = !!(title.trim() || keywords.trim() || company.trim());

  // ── Client-side filter — LinkedIn's keyword search ignores boolean operators,
  //    so we enforce title / exclude terms ourselves after results arrive.
  const applyFilters = useCallback((results: SearchProfile[]): SearchProfile[] => {
    const { title, excludeTerms, degrees } = filterRef.current;
    return results.filter(p => {
      const haystack = `${p.fullName} ${p.headline}`.toLowerCase();
      // Title filter: only enforce when headline is non-empty (extraction can fail).
      // If headline is blank we can't verify — pass the profile through.
      if (title && p.headline.trim() && !p.headline.toLowerCase().includes(title.toLowerCase())) return false;
      // Connection degree filter: if specific degrees are selected, drop others.
      // Profiles with unknown degree ("") are passed through as we can't verify.
      if (degrees.length > 0 && p.connectionDegree && !degrees.includes(p.connectionDegree)) return false;
      // Exclude: drop profiles whose headline or name contains any excluded term
      for (const term of excludeTerms) {
        if (haystack.includes(term.toLowerCase())) return false;
      }
      return true;
    });
  }, []);

  // ── Polling ───────────────────────────────────────────────────────────────
  const poll = useCallback(async (id: string) => {
    try {
      const res  = await fetch(`/api/search/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      const s    = data.search;
      if (!s) return;

      if (s.status === "COMPLETED") {
        const raw     = (s.results as SearchProfile[]) ?? [];
        const results = applyFilters(raw);
        setProfiles(results);
        setTotalFound(results.length);
        const filtered = raw.length - results.length;
        setStatusMsg(
          `${results.length} result${results.length !== 1 ? "s" : ""} found` +
          (filtered > 0 ? ` (${filtered} filtered out by title/exclude)` : "")
        );
        setSearching(false);
        if (pollRef.current) clearInterval(pollRef.current);
      } else if (s.status === "FAILED") {
        setError(s.error ?? "Search failed. Make sure the extension is open and logged into LinkedIn.");
        setSearching(false);
        if (pollRef.current) clearInterval(pollRef.current);
      }
    } catch { /* network blip — keep polling */ }
  }, [applyFilters]);

  useEffect(() => {
    if (!searchId) return;
    pollRef.current = setInterval(() => poll(searchId), 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [searchId, poll]);

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasQuery || searching) return;

    if (pollRef.current) clearInterval(pollRef.current);
    setSearching(true);
    setProfiles([]);
    setError(null);
    setSearchId(null);
    setStatusMsg("Queuing search…");
    setTotalFound(0);

    // Capture current filter state — used by applyFilters when results arrive
    filterRef.current = {
      title:        title.trim(),
      excludeTerms: exclude.split(",").map(e => e.trim()).filter(Boolean),
      degrees:      connectionDegrees,
    };

    try {
      const res  = await fetch("/api/search", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          // query: stored in DB for display only
          query:    queryPreview,
          // searchUrl: the exact LinkedIn URL the extension must open
          searchUrl,
          // Individual filter fields kept for client-side post-filtering
          titleFilter:   title.trim(),
          excludeFilter: exclude.trim(),
          connectionDegrees,
        }),
      });

      let data: any = {};
      try { data = await res.json(); } catch { /* empty body */ }

      if (!res.ok) {
        setError(data.error ?? `Server error (${res.status})`);
        setSearching(false);
        return;
      }
      setSearchId(data.searchId);
      setStatusMsg("Extension is running the search on LinkedIn…");
    } catch {
      setError("Could not reach the server. Check your internet connection.");
      setSearching(false);
    }
  };

  // ── Export search results as CSV (client-side, no round-trip needed) ────
  const exportSearchResults = () => {
    const headers = ["Name", "Headline", "Profile URL", "Connection Degree"];
    const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const rows = profiles.map(p =>
      [esc(p.fullName), esc(p.headline), esc(p.profileUrl), esc(p.connectionDegree)].join(",")
    );
    const csv  = [headers.join(","), ...rows].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `search-results-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── Add lead ──────────────────────────────────────────────────────────────
  const handleAdd = async (profile: SearchProfile) => {
    try {
      const res = await fetch("/api/leads", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ urls: [profile.profileUrl] }),
      });
      if (res.ok) setAdded(prev => new Set(prev).add(profile.profileUrn));
    } catch { /* silent */ }
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Lead Search</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Build your search with the filters below. The Chrome extension runs it safely on LinkedIn.
        </p>
      </div>

      {/* Search builder */}
      <form onSubmit={handleSearch} className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-5 space-y-5">

        {/* Structured filter row */}
        <div className="grid grid-cols-2 gap-4">
          <FilterInput
            label="Job Title"
            placeholder="CEO, Founder, VP of Sales…"
            value={title}
            onChange={setTitle}
            note="searches title field"
          />
          <FilterInput
            label="Company"
            placeholder="Stripe, Google, any startup…"
            value={company}
            onChange={setCompany}
            note="current company"
          />
        </div>

        {/* Company size chips */}
        <div className="space-y-1.5">
          <div className="flex items-baseline gap-2">
            <label className="text-xs font-semibold text-gray-700">Company Size</label>
            <span className="text-[10px] text-gray-400">employees — select one or more</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {COMPANY_SIZES.map(({ code, label }) => {
              const active = companySizes.includes(code);
              return (
                <button
                  suppressHydrationWarning
                  key={code}
                  type="button"
                  onClick={() =>
                    setCompanySizes(prev =>
                      active ? prev.filter(c => c !== code) : [...prev, code]
                    )
                  }
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    active
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300 hover:text-indigo-600"
                  }`}
                >
                  {label}
                </button>
              );
            })}
            {companySizes.length > 0 && (
              <button
                type="button"
                onClick={() => setCompanySizes([])}
                className="text-[10px] text-gray-400 hover:text-red-500 underline ml-1 self-center"
              >
                clear
              </button>
            )}
          </div>
        </div>

        {/* Connection degree chips */}
        <div className="space-y-1.5">
          <div className="flex items-baseline gap-2">
            <label className="text-xs font-semibold text-gray-700">Connection Degree</label>
            <span className="text-[10px] text-gray-400">leave blank for all degrees</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(["1st", "2nd", "3rd+"] as const).map(deg => {
              const active = connectionDegrees.includes(deg);
              const colors: Record<string, string> = {
                "1st":  active ? "bg-blue-600 text-white border-blue-600"   : "bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600",
                "2nd":  active ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300 hover:text-indigo-600",
                "3rd+": active ? "bg-gray-600 text-white border-gray-600"   : "bg-white text-gray-600 border-gray-200 hover:border-gray-400",
              };
              return (
                <button
                  suppressHydrationWarning
                  key={deg}
                  type="button"
                  onClick={() =>
                    setConnectionDegrees(prev =>
                      active ? prev.filter(d => d !== deg) : [...prev, deg]
                    )
                  }
                  className={`rounded-full border px-4 py-1 text-xs font-semibold transition-colors ${colors[deg]}`}
                >
                  {deg}
                </button>
              );
            })}
            {connectionDegrees.length > 0 && (
              <button
                type="button"
                onClick={() => setConnectionDegrees([])}
                className="text-[10px] text-gray-400 hover:text-red-500 underline ml-1 self-center"
              >
                clear
              </button>
            )}
          </div>
          {connectionDegrees.length > 0 && (
            <p className="text-[10px] text-indigo-500">
              LinkedIn will only return {connectionDegrees.join(" & ")} connections.
            </p>
          )}
        </div>

        <FilterInput
          label="Keywords"
          placeholder="SaaS, B2B, marketing, fintech…"
          value={keywords}
          onChange={setKeywords}
          note="searched across the whole profile"
        />

        <FilterInput
          label="Exclude"
          placeholder="Freelance, Student, Intern"
          value={exclude}
          onChange={setExclude}
          note="comma-separated — these will be excluded from results"
        />

        {/* Query preview */}
        {hasQuery && (
          <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 space-y-1">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Search summary</p>
            <p className="text-xs font-mono text-gray-700 break-all">{queryPreview}</p>
            <p className="text-[10px] text-gray-400">
              Title maps to LinkedIn's <code className="bg-gray-100 px-1 rounded">title=</code> param.
              Keywords support LinkedIn boolean (<code className="bg-gray-100 px-1 rounded">AND</code>, <code className="bg-gray-100 px-1 rounded">OR</code>, <code className="bg-gray-100 px-1 rounded">NOT</code>).
              Exclude terms are appended as <code className="bg-gray-100 px-1 rounded">NOT "term"</code>.
            </p>
          </div>
        )}

        {/* Submit */}
        <button
          suppressHydrationWarning
          type="submit"
          disabled={searching || !hasQuery}
          className="flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700
            disabled:opacity-50 text-white text-sm font-semibold px-5 py-2.5 transition-colors"
        >
          {searching ? (
            <>
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeOpacity="0.25"/>
                <path d="M21 12a9 9 0 00-9-9"/>
              </svg>
              Searching…
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              Search LinkedIn
            </>
          )}
        </button>

        {/* Live status while waiting */}
        {searching && (
          <div className="flex items-center gap-3 rounded-xl bg-indigo-50 border border-indigo-100 px-4 py-3">
            <svg className="animate-spin shrink-0 w-4 h-4 text-indigo-500" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeOpacity="0.25"/>
              <path d="M21 12a9 9 0 00-9-9"/>
            </svg>
            <div>
              <p className="text-xs font-medium text-indigo-700">{statusMsg}</p>
              <p className="text-[10px] text-indigo-500 mt-0.5">
                Keep LinkedIn open in your browser. Results appear automatically.
              </p>
            </div>
          </div>
        )}
      </form>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
          <svg className="shrink-0 mt-0.5 w-4 h-4 text-red-500" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <div>
            <p className="text-xs font-semibold text-red-700">Search failed</p>
            <p className="text-xs text-red-600 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* Results */}
      {profiles.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              {statusMsg}
            </p>
            <div className="flex items-center gap-2">
              {added.size > 0 && (
                <span className="text-xs text-green-600 font-medium bg-green-50 border border-green-200 rounded-full px-2.5 py-0.5">
                  {added.size} added to pipeline
                </span>
              )}
              <button
                onClick={exportSearchResults}
                className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Export CSV
              </button>
              <button
                onClick={() => window.open("/api/leads/export", "_blank")}
                className="flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-100 transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Export All Leads
              </button>
            </div>
          </div>
          {profiles.map(p => (
            <ProfileCard
              key={p.profileUrn}
              profile={p}
              added={added.has(p.profileUrn)}
              onAdd={handleAdd}
            />
          ))}
        </div>
      )}

      {/* No results */}
      {!searching && !error && searchId && profiles.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col items-center justify-center py-16 text-center">
          <p className="text-base font-semibold text-gray-900">No results</p>
          <p className="text-sm text-gray-400 mt-1">Try broader keywords or remove some filters.</p>
        </div>
      )}

      {/* Initial empty state */}
      {!searching && !searchId && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mb-4">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
              stroke="#6366f1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </div>
          <h3 className="text-base font-semibold text-gray-900">Find your ideal leads</h3>
          <p className="text-sm text-gray-400 mt-1 max-w-sm">
            Fill in the filters above. The extension runs the search on LinkedIn and returns profiles with photos, headlines, and connection degree.
          </p>
        </div>
      )}
    </div>
  );
}
