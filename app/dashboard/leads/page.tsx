"use client";

import { useState, useEffect, useRef } from "react";

type LeadStatus = "PENDING" | "SCRAPING" | "AWAITING_APPROVAL" | "ENGAGED" | "FAILED";

interface LeadSummary {
  id: string;
  fullName: string | null;
  headline: string | null;
  profileUrl: string;
  status: LeadStatus;
  updatedAt: string;
  scrapedBio: string | null;
  drafts: { id: string; type: string; status: string }[];
}

interface StatusCounts {
  PENDING: number;
  SCRAPING: number;
  AWAITING_APPROVAL: number;
  ENGAGED: number;
  FAILED: number;
}

const STATUS_CFG: Record<LeadStatus, { label: string; color: string; dot: string }> = {
  PENDING:            { label: "Pending",        color: "text-gray-500  bg-gray-100",   dot: "bg-gray-400"   },
  SCRAPING:           { label: "Scraping",        color: "text-blue-600  bg-blue-50",    dot: "bg-blue-500"   },
  AWAITING_APPROVAL:  { label: "Ready",           color: "text-amber-600 bg-amber-50",   dot: "bg-amber-500"  },
  ENGAGED:            { label: "Engaged",         color: "text-green-600 bg-green-50",   dot: "bg-green-500"  },
  FAILED:             { label: "Failed",          color: "text-red-600   bg-red-50",     dot: "bg-red-500"    },
};

export default function LeadsPage() {
  const [input,        setInput]        = useState("");
  const [submitting,   setSubmitting]   = useState(false);
  const [message,      setMessage]      = useState<{ text: string; ok: boolean } | null>(null);
  const [leads,        setLeads]        = useState<LeadSummary[]>([]);
  const [counts,       setCounts]       = useState<StatusCounts | null>(null);
  const [showConfirm,  setShowConfirm]  = useState(false);
  const [flushing,     setFlushing]     = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const parseUrls = (raw: string) =>
    raw.split(/[\n,]+/).map((u) => u.trim()).filter(Boolean);

  const poll = async () => {
    try {
      const res = await fetch("/api/leads/status");
      if (!res.ok) return;
      const data = await res.json();
      setLeads(data.leads);
      setCounts(data.counts);
    } catch { /* silently retry */ }
  };

  useEffect(() => {
    poll();
    pollRef.current = setInterval(poll, 4000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const handleSubmit = async () => {
    const urls = parseUrls(input);
    if (!urls.length) return;
    setSubmitting(true);
    setMessage(null);

    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls }),
    });
    const data = await res.json();
    setSubmitting(false);

    if (res.ok) {
      setInput("");
      setMessage({ text: data.message, ok: true });
      poll();
    } else {
      setMessage({ text: data.error ?? "Something went wrong", ok: false });
    }
  };

  const handleFlush = async () => {
    setFlushing(true);
    setShowConfirm(false);
    const res = await fetch("/api/leads", { method: "DELETE" });
    if (res.ok) {
      setLeads([]);
      setCounts({ PENDING: 0, SCRAPING: 0, AWAITING_APPROVAL: 0, ENGAGED: 0, FAILED: 0 });
      setMessage({ text: "All leads cleared.", ok: true });
    } else {
      setMessage({ text: "Failed to clear leads.", ok: false });
    }
    setFlushing(false);
  };

  const urlCount = parseUrls(input).length;

  return (
    <>
      {/* Flush confirmation */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <div>
              <p className="font-semibold text-gray-900">Flush all leads?</p>
              <p className="text-sm text-gray-500 mt-1">
                Permanently deletes all leads, drafts, and jobs. Cannot be undone.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 rounded-xl border border-gray-200 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleFlush}
                disabled={flushing}
                className="flex-1 rounded-xl bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {flushing ? "Deleting…" : "Delete all"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        {/* Page header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Add Leads</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              Paste LinkedIn URLs — the extension scrapes and drafts automatically.
            </p>
          </div>
          {leads.length > 0 && (
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => window.open("/api/leads/export", "_blank")}
                className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                ↓ Export CSV
              </button>
              <button
                onClick={() => setShowConfirm(true)}
                className="rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 transition-colors"
              >
                🗑 Flush
              </button>
            </div>
          )}
        </div>

        {/* Input card */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <label className="block text-sm font-medium text-gray-700">
            LinkedIn Profile URLs
            <span className="ml-2 font-normal text-gray-400 text-xs">one per line or comma-separated</span>
          </label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={"https://linkedin.com/in/jane-doe/\nhttps://linkedin.com/in/john-smith/"}
            rows={5}
            className="w-full rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm font-mono text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 transition-shadow"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">
              {urlCount > 0 ? `${urlCount} URL${urlCount !== 1 ? "s" : ""} detected` : "No URLs yet"}
            </span>
            <button
              onClick={handleSubmit}
              disabled={urlCount === 0 || submitting}
              className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? "Saving…" : `Queue ${urlCount || ""} Lead${urlCount !== 1 ? "s" : ""}`}
            </button>
          </div>
          {message && (
            <p className={`text-sm rounded-xl px-3 py-2 border ${
              message.ok
                ? "bg-green-50 text-green-700 border-green-200"
                : "bg-red-50 text-red-700 border-red-200"
            }`}>
              {message.text}
            </p>
          )}
        </div>

        {/* Live pipeline */}
        {counts && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">Pipeline</h2>
              <span className="flex items-center gap-1.5 text-xs text-gray-400">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                Live · every 4s
              </span>
            </div>

            {/* Count pills */}
            <div className="grid grid-cols-5 gap-2">
              {(Object.entries(STATUS_CFG) as [LeadStatus, typeof STATUS_CFG[LeadStatus]][]).map(
                ([key, cfg]) => (
                  <div key={key} className={`rounded-xl p-3 text-center ${cfg.color.split(" ")[1]}`}>
                    <p className={`text-xl font-bold ${cfg.color.split(" ")[0]}`}>{counts[key]}</p>
                    <p className={`text-xs font-medium mt-0.5 ${cfg.color.split(" ")[0]} opacity-80`}>
                      {cfg.label}
                    </p>
                  </div>
                )
              )}
            </div>

            {/* Lead list */}
            {leads.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Recent Leads
                  </p>
                </div>
                <ul className="divide-y divide-gray-50">
                  {leads.slice(0, 12).map((lead) => {
                    const cfg = STATUS_CFG[lead.status];
                    const name =
                      lead.fullName ??
                      (() => {
                        try {
                          return new URL(lead.profileUrl).pathname
                            .replace("/in/", "")
                            .replace(/\/$/, "");
                        } catch { return lead.profileUrl; }
                      })();

                    return (
                      <li key={lead.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors">
                        <div className="min-w-0 flex-1">
                          <a
                            href={lead.profileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-medium text-gray-800 truncate block hover:underline"
                          >
                            {name}
                          </a>
                          {lead.status === "FAILED" && lead.scrapedBio ? (
                            <p className="text-xs text-red-400 truncate mt-0.5" title={lead.scrapedBio}>
                              {lead.scrapedBio.replace("Extension error: ", "")}
                            </p>
                          ) : lead.headline ? (
                            <p className="text-xs text-gray-500 truncate mt-0.5" title={lead.headline}>
                              {lead.headline}
                            </p>
                          ) : (
                            <p className="text-xs text-gray-400 truncate mt-0.5">{lead.profileUrl}</p>
                          )}
                        </div>
                        <div className="ml-3 flex items-center gap-2 shrink-0">
                          {lead.status === "SCRAPING" && (
                            <svg className="w-3.5 h-3.5 animate-spin text-blue-400" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                            </svg>
                          )}
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${cfg.color}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                            {cfg.label}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {counts.AWAITING_APPROVAL > 0 && (
                  <div className="px-4 py-3 bg-indigo-50 border-t border-indigo-100">
                    <a href="/dashboard" className="text-xs font-semibold text-indigo-600 hover:underline">
                      {counts.AWAITING_APPROVAL} lead{counts.AWAITING_APPROVAL !== 1 ? "s" : ""} ready to review in Inbox →
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Export Leads */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Export Leads</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Download all your leads with AI-generated drafts as a CSV file.
              </p>
            </div>
            <button
              onClick={() => window.open("/api/leads/export", "_blank")}
              disabled={leads.length === 0}
              className="flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 transition-colors shrink-0"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Download CSV
            </button>
          </div>
          {leads.length > 0 && (
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs text-gray-500">
              <div className="rounded-xl bg-gray-50 py-2">
                <p className="font-bold text-gray-900 text-base">{leads.length}</p>
                <p>Total leads</p>
              </div>
              <div className="rounded-xl bg-gray-50 py-2">
                <p className="font-bold text-gray-900 text-base">{counts?.AWAITING_APPROVAL ?? 0}</p>
                <p>With AI drafts</p>
              </div>
              <div className="rounded-xl bg-gray-50 py-2">
                <p className="font-bold text-gray-900 text-base">{counts?.ENGAGED ?? 0}</p>
                <p>Engaged</p>
              </div>
            </div>
          )}
          {leads.length === 0 && (
            <p className="mt-3 text-xs text-gray-400">
              Add some leads above to enable export.
            </p>
          )}
        </div>

        {/* How it works */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { n: "1", title: "Add URLs",      desc: "Paste any LinkedIn profile URLs" },
            { n: "2", title: "Auto Scrape",   desc: "Extension reads bio & recent posts" },
            { n: "3", title: "Review & Send", desc: "Approve AI drafts with one click" },
          ].map((s) => (
            <div key={s.n} className="bg-white rounded-2xl border border-gray-100 p-4 space-y-2 text-center">
              <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-600 font-bold text-xs flex items-center justify-center mx-auto">
                {s.n}
              </div>
              <p className="text-sm font-semibold text-gray-800">{s.title}</p>
              <p className="text-xs text-gray-400">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
