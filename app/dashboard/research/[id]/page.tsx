"use client";

import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import { useParams } from "next/navigation";
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

interface Campaign {
  id:           string;
  name:         string;
  industry:     string;
  location:     string;
  companySize:  string | null;
  status:       ResearchStatus;
  targetCount:  number;
  createdAt:    string;
}

interface Contact {
  id:          string;
  name:        string;
  title:       string;
  linkedinUrl: string | null;
  email:       string | null;
}

interface Company {
  id:            string;
  name:          string;
  website:       string | null;
  location:      string | null;
  size:          string | null;
  score:         number | null;
  opportunity:   string | null;
  status:        string;
  googleAds:     boolean | null;
  metaAds:       boolean | null;
  websiteResearched: boolean;
  qualified:     boolean;
  contacts:      Contact[];
}

interface JobStats {
  discovery:       { total: number; completed: number };
  websiteResearch: { total: number; completed: number };
  qualified:       number;
  decisionMakers:  { total: number; completed: number };
  analysis:        { total: number; completed: number };
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

// ── Running statuses (for polling) ───────────────────────────────────────────
const RUNNING_STATUSES: ResearchStatus[] = [
  "DISCOVERING",
  "RESEARCHING",
  "QUALIFYING",
  "FINDING_CONTACTS",
  "ANALYZING",
];

// ── Stage progress component ─────────────────────────────────────────────────
function StageRow({
  label,
  current,
  total,
  icon,
}: {
  label: string;
  current: number;
  total: number | null;
  icon: React.ReactNode;
}) {
  const pct = total && total > 0 ? Math.round((current / total) * 100) : current > 0 ? 100 : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-gray-600 font-medium">
          {icon}
          {label}
        </span>
        <span className="text-gray-400 font-mono">
          {total !== null ? `${current}/${total}` : current}
        </span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-indigo-500 rounded-full transition-all duration-500"
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function ResearchDetailPage() {
  const params = useParams();
  const campaignId = params.id as string;

  const [campaign,   setCampaign]   = useState<Campaign | null>(null);
  const [companies,  setCompanies]  = useState<Company[]>([]);
  const [jobStats,   setJobStats]   = useState<JobStats | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState("");
  const [actionMsg,  setActionMsg]  = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addingOutreach, setAddingOutreach] = useState<Record<string, boolean>>({});
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch campaign data
  const fetchData = useCallback(async () => {
    try {
      const res  = await fetch(`/api/research/${campaignId}`);
      const data = await res.json();
      if (res.ok) {
        setCampaign(data.campaign);
        setCompanies(data.companies ?? []);
        setJobStats(data.jobStats ?? null);
      } else {
        setError(data.error ?? "Failed to load campaign");
      }
    } catch {
      setError("Failed to load campaign");
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  // Initial load
  useEffect(() => { fetchData(); }, [fetchData]);

  // Polling while running
  useEffect(() => {
    if (campaign && RUNNING_STATUSES.includes(campaign.status)) {
      intervalRef.current = setInterval(fetchData, 5000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [campaign?.status, fetchData]);

  // Action handlers
  const handleAction = async (action: string, method: string = "PATCH") => {
    setActionMsg("");
    try {
      const res = await fetch(`/api/research/${campaignId}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (res.ok) {
        setCampaign(data.campaign ?? data);
        setActionMsg(`Action "${action}" completed`);
        setTimeout(() => setActionMsg(""), 3000);
        fetchData();
      } else {
        setActionMsg(data.error ?? "Action failed");
      }
    } catch {
      setActionMsg("Action failed");
    }
  };

  const handleStart = () => handleAction("start", "POST");

  // Export CSV
  const handleExport = async () => {
    const res = await fetch(`/api/research/${campaignId}/export`);
    if (!res.ok) {
      setActionMsg("Export failed");
      return;
    }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `research-${campaignId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Add to outreach
  const handleAddToOutreach = async (companyId: string, contactId: string) => {
    setAddingOutreach((p) => ({ ...p, [companyId]: true }));
    try {
      const res = await fetch(`/api/research/${campaignId}/company/${companyId}`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ contactId }),
      });
      if (res.ok) {
        setActionMsg("Added to outreach");
        setTimeout(() => setActionMsg(""), 3000);
      } else {
        const data = await res.json();
        setActionMsg(data.error ?? "Failed to add to outreach");
      }
    } catch {
      setActionMsg("Failed to add to outreach");
    } finally {
      setAddingOutreach((p) => ({ ...p, [companyId]: false }));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-gray-400">
        Loading...
      </div>
    );
  }

  if (error || !campaign) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-8">
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          {error || "Campaign not found"}
        </p>
        <Link href="/dashboard/research" className="text-sm text-indigo-600 hover:underline mt-3 inline-block">
          Back to Research
        </Link>
      </div>
    );
  }

  const isRunning = RUNNING_STATUSES.includes(campaign.status);

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      {/* Breadcrumb + header */}
      <div>
        <Link
          href="/dashboard/research"
          className="text-xs text-gray-400 hover:text-indigo-600 transition-colors flex items-center gap-1 mb-3"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to Research
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-gray-900">{campaign.name}</h1>
              <StatusBadge status={campaign.status} />
            </div>
            <div className="flex items-center gap-3 text-sm text-gray-400 mt-1">
              <span>{campaign.industry}</span>
              <span className="text-gray-200">|</span>
              <span>{campaign.location}</span>
              {campaign.companySize && (
                <>
                  <span className="text-gray-200">|</span>
                  <span>{campaign.companySize}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {campaign.status === "DRAFT" && (
              <button
                onClick={handleStart}
                className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-5 py-2 transition-colors"
              >
                Start Research
              </button>
            )}
            {isRunning && (
              <button
                onClick={() => handleAction("pause")}
                className="rounded-xl border border-yellow-200 text-yellow-600 hover:bg-yellow-50 text-sm font-semibold px-4 py-2 transition-colors"
              >
                Pause
              </button>
            )}
            {campaign.status === "PAUSED" && (
              <button
                onClick={() => handleAction("resume")}
                className="rounded-xl border border-green-200 text-green-600 hover:bg-green-50 text-sm font-semibold px-4 py-2 transition-colors"
              >
                Resume
              </button>
            )}
            {(isRunning || campaign.status === "PAUSED") && (
              <button
                onClick={() => handleAction("cancel")}
                className="rounded-xl border border-red-200 text-red-500 hover:bg-red-50 text-sm font-semibold px-4 py-2 transition-colors"
              >
                Cancel
              </button>
            )}
            {campaign.status === "FAILED" && (
              <button
                onClick={() => handleAction("retry_failed")}
                className="rounded-xl border border-amber-200 text-amber-600 hover:bg-amber-50 text-sm font-semibold px-4 py-2 transition-colors"
              >
                Retry Failed
              </button>
            )}
            {companies.length > 0 && (
              <button
                onClick={handleExport}
                className="rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-medium px-4 py-2 transition-colors flex items-center gap-1.5"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                </svg>
                Export CSV
              </button>
            )}
          </div>
        </div>
      </div>

      {actionMsg && (
        <p className="text-sm text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-xl px-3 py-2">
          {actionMsg}
        </p>
      )}

      {/* Progress section */}
      {jobStats && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-4">Progress</h2>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <StageRow
              label="Discovery"
              current={jobStats.discovery.completed}
              total={null}
              icon={
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              }
            />
            <StageRow
              label="Website Research"
              current={jobStats.websiteResearch.completed}
              total={jobStats.websiteResearch.total}
              icon={
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10A15.3 15.3 0 0112 2z" />
                </svg>
              }
            />
            <StageRow
              label="Qualified"
              current={jobStats.qualified}
              total={campaign.targetCount}
              icon={
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              }
            />
            <StageRow
              label="Decision Makers"
              current={jobStats.decisionMakers.completed}
              total={jobStats.decisionMakers.total}
              icon={
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
                </svg>
              }
            />
            <StageRow
              label="Analysis"
              current={jobStats.analysis.completed}
              total={jobStats.analysis.total}
              icon={
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
                </svg>
              }
            />
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="font-medium">Target:</span>
              <span className="text-indigo-600 font-bold">{campaign.targetCount}</span>
              <span>qualified prospects</span>
            </div>
          </div>
        </div>
      )}

      {/* Results table */}
      {companies.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-900">
              Results
              <span className="ml-2 text-gray-400 font-normal">({companies.length})</span>
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Company</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Website</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Location</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Size</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Score</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Decision Maker</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Title</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">LinkedIn</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Google Ads</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Meta Ads</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Opportunity</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {companies.map((co) => {
                  const contact = co.contacts?.[0] ?? null;
                  const isExpanded = expandedId === co.id;
                  const canOutreach = contact?.linkedinUrl;

                  return (
                    <Fragment key={co.id}>
                      <tr
                        onClick={() => setExpandedId(isExpanded ? null : co.id)}
                        className="hover:bg-gray-50 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{co.name}</td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                          {co.website ? (
                            <a
                              href={co.website}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-indigo-500 hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {co.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                            </a>
                          ) : (
                            <span className="text-gray-300">--</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{co.location ?? "--"}</td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{co.size ?? "--"}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {co.score !== null ? (
                            <span className={`inline-flex items-center justify-center w-8 h-6 rounded-md text-xs font-bold ${
                              co.score >= 80 ? "bg-green-50 text-green-700" :
                              co.score >= 60 ? "bg-yellow-50 text-yellow-700" :
                              "bg-gray-50 text-gray-500"
                            }`}>
                              {co.score}
                            </span>
                          ) : (
                            <span className="text-gray-300">--</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{contact?.name ?? "--"}</td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">{contact?.title ?? "--"}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {contact?.linkedinUrl ? (
                            <a
                              href={contact.linkedinUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-indigo-500 hover:underline text-xs"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Profile
                            </a>
                          ) : (
                            <span className="text-gray-300">--</span>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {co.googleAds !== null ? (
                            co.googleAds ? (
                              <span className="text-green-600 text-xs font-medium">Yes</span>
                            ) : (
                              <span className="text-gray-400 text-xs">No</span>
                            )
                          ) : (
                            <span className="text-gray-300">--</span>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {co.metaAds !== null ? (
                            co.metaAds ? (
                              <span className="text-green-600 text-xs font-medium">Yes</span>
                            ) : (
                              <span className="text-gray-400 text-xs">No</span>
                            )
                          ) : (
                            <span className="text-gray-300">--</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs max-w-[150px] truncate">{co.opportunity ?? "--"}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            co.status === "completed" ? "bg-green-50 text-green-700" :
                            co.status === "failed"    ? "bg-red-50 text-red-600" :
                            co.status === "pending"   ? "bg-gray-50 text-gray-500" :
                            "bg-blue-50 text-blue-600"
                          }`}>
                            {co.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {canOutreach && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAddToOutreach(co.id, contact!.id);
                              }}
                              disabled={addingOutreach[co.id]}
                              className="rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 text-xs font-semibold px-2.5 py-1.5 transition-colors disabled:opacity-40"
                            >
                              {addingOutreach[co.id] ? "Adding..." : "Add to Outreach"}
                            </button>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-gray-50">
                          <td colSpan={13} className="px-6 py-4">
                            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                              <div>
                                <p className="font-semibold text-gray-500 uppercase tracking-wide mb-1">Company Details</p>
                                <p className="text-gray-700"><span className="font-medium">Name:</span> {co.name}</p>
                                <p className="text-gray-700"><span className="font-medium">Website:</span> {co.website ?? "N/A"}</p>
                                <p className="text-gray-700"><span className="font-medium">Location:</span> {co.location ?? "N/A"}</p>
                                <p className="text-gray-700"><span className="font-medium">Size:</span> {co.size ?? "N/A"}</p>
                                <p className="text-gray-700"><span className="font-medium">Score:</span> {co.score ?? "N/A"}</p>
                                <p className="text-gray-700"><span className="font-medium">Qualified:</span> {co.qualified ? "Yes" : "No"}</p>
                              </div>
                              <div>
                                <p className="font-semibold text-gray-500 uppercase tracking-wide mb-1">Advertising</p>
                                <p className="text-gray-700"><span className="font-medium">Google Ads:</span> {co.googleAds === null ? "Unknown" : co.googleAds ? "Yes" : "No"}</p>
                                <p className="text-gray-700"><span className="font-medium">Meta Ads:</span> {co.metaAds === null ? "Unknown" : co.metaAds ? "Yes" : "No"}</p>
                                {co.opportunity && (
                                  <p className="text-gray-700 mt-1"><span className="font-medium">Opportunity:</span> {co.opportunity}</p>
                                )}
                              </div>
                              <div>
                                <p className="font-semibold text-gray-500 uppercase tracking-wide mb-1">Contacts</p>
                                {co.contacts.length > 0 ? (
                                  co.contacts.map((ct) => (
                                    <div key={ct.id} className="mb-2">
                                      <p className="text-gray-700 font-medium">{ct.name}</p>
                                      <p className="text-gray-500">{ct.title}</p>
                                      {ct.linkedinUrl && (
                                        <a
                                          href={ct.linkedinUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-indigo-500 hover:underline"
                                        >
                                          LinkedIn Profile
                                        </a>
                                      )}
                                      {ct.email && (
                                        <p className="text-gray-500">{ct.email}</p>
                                      )}
                                    </div>
                                  ))
                                ) : (
                                  <p className="text-gray-400 italic">No contacts found yet</p>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty results */}
      {!loading && companies.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center mb-3">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-gray-700">No results yet</h3>
            <p className="text-xs text-gray-400 mt-1">
              {campaign.status === "DRAFT"
                ? "Start the research to begin discovering companies."
                : "Results will appear here as the research progresses."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

