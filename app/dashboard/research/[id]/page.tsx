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
  companiesFound: number;
  companiesQualified: number;
  contactsFound: number;
  createdAt:    string;
}

interface Contact {
  id:          string;
  fullName:    string;
  title:       string;
  linkedinUrl: string | null;
  isPrimary:   boolean;
}

interface Evidence {
  field: string;
  value: string;
}

interface Company {
  id:              string;
  name:            string;
  domain:          string | null;
  website:         string | null;
  location:        string | null;
  researchStatus:  string;
  googleAdsStatus: string | null;
  metaAdsStatus:   string | null;
  contacts:        Contact[];
  evidence:        Evidence[];
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

const RUNNING_STATUSES: ResearchStatus[] = [
  "DISCOVERING", "RESEARCHING", "QUALIFYING", "FINDING_CONTACTS", "ANALYZING",
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function getSocial(evidence: Evidence[], platform: string): string | null {
  return evidence.find(e => e.field === `social_${platform}`)?.value ?? null;
}

function getEmails(evidence: Evidence[]): string[] {
  return evidence.filter(e => e.field === "email").map(e => e.value);
}

function getPhones(evidence: Evidence[]): string[] {
  return evidence.filter(e => e.field === "phone").map(e => e.value);
}

function SocialIcon({ url, platform }: { url: string | null; platform: string }) {
  if (!url) return <span className="text-gray-200">-</span>;
  const colors: Record<string, string> = {
    linkedin: "text-[#0A66C2]", facebook: "text-[#1877F2]",
    instagram: "text-[#E4405F]", twitter: "text-gray-800",
  };
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className={`${colors[platform] || "text-indigo-500"} hover:opacity-70 text-xs font-medium`}
      onClick={e => e.stopPropagation()}>
      {platform.charAt(0).toUpperCase() + platform.slice(1, 2)}
    </a>
  );
}

function AdsTag({ status }: { status: string | null }) {
  if (!status || status === "UNKNOWN") return <span className="text-gray-300">--</span>;
  if (status === "LIKELY" || status === "OBSERVED")
    return <span className="text-green-600 text-xs font-medium">Yes</span>;
  return <span className="text-gray-400 text-xs">No</span>;
}

// ── Progress row ─────────────────────────────────────────────────────────────
function StageRow({ label, current, total }: { label: string; current: number; total: number | null }) {
  const pct = total && total > 0 ? Math.round((current / total) * 100) : current > 0 ? 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-600 font-medium">{label}</span>
        <span className="text-gray-400 font-mono">{total !== null ? `${current}/${total}` : current}</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full bg-indigo-500 rounded-full transition-all duration-500" style={{ width: `${Math.min(pct, 100)}%` }} />
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

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (campaign && RUNNING_STATUSES.includes(campaign.status)) {
      intervalRef.current = setInterval(fetchData, 5000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [campaign?.status, fetchData]);

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

  const handleExport = async () => {
    const res = await fetch(`/api/research/${campaignId}/export`);
    if (!res.ok) { setActionMsg("Export failed"); return; }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `research-${campaignId}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleAddToOutreach = async (companyId: string, contactId: string) => {
    setAddingOutreach(p => ({ ...p, [companyId]: true }));
    try {
      const res = await fetch(`/api/research/${campaignId}/company/${companyId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId }),
      });
      if (res.ok) {
        setActionMsg("Added to outreach");
        setTimeout(() => setActionMsg(""), 3000);
      } else {
        const data = await res.json();
        setActionMsg(data.error ?? "Failed");
      }
    } catch {
      setActionMsg("Failed to add to outreach");
    } finally {
      setAddingOutreach(p => ({ ...p, [companyId]: false }));
    }
  };

  if (loading) return <div className="flex items-center justify-center py-20 text-sm text-gray-400">Loading...</div>;

  if (error || !campaign) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-8">
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error || "Campaign not found"}</p>
        <Link href="/dashboard/research" className="text-sm text-indigo-600 hover:underline mt-3 inline-block">Back to Research</Link>
      </div>
    );
  }

  const isRunning = RUNNING_STATUSES.includes(campaign.status);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      {/* Header */}
      <div>
        <Link href="/dashboard/research" className="text-xs text-gray-400 hover:text-indigo-600 transition-colors flex items-center gap-1 mb-3">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
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
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {campaign.status === "DRAFT" && (
              <button onClick={handleStart} className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-5 py-2 transition-colors">
                Start Research
              </button>
            )}
            {isRunning && (
              <button onClick={() => handleAction("pause")} className="rounded-xl border border-yellow-200 text-yellow-600 hover:bg-yellow-50 text-sm font-semibold px-4 py-2">
                Pause
              </button>
            )}
            {campaign.status === "PAUSED" && (
              <button onClick={() => handleAction("resume")} className="rounded-xl border border-green-200 text-green-600 hover:bg-green-50 text-sm font-semibold px-4 py-2">
                Resume
              </button>
            )}
            {(isRunning || campaign.status === "PAUSED") && (
              <button onClick={() => handleAction("cancel")} className="rounded-xl border border-red-200 text-red-500 hover:bg-red-50 text-sm font-semibold px-4 py-2">
                Cancel
              </button>
            )}
            {campaign.status === "FAILED" && (
              <button onClick={() => handleAction("retry_failed")} className="rounded-xl border border-amber-200 text-amber-600 hover:bg-amber-50 text-sm font-semibold px-4 py-2">
                Retry Failed
              </button>
            )}
            {companies.length > 0 && (
              <button onClick={handleExport} className="rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-medium px-4 py-2 flex items-center gap-1.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
                Export CSV
              </button>
            )}
          </div>
        </div>
      </div>

      {actionMsg && <p className="text-sm text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-xl px-3 py-2">{actionMsg}</p>}

      {/* Stats cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{campaign.companiesFound}</p>
          <p className="text-xs text-gray-400 mt-1">Found</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{campaign.companiesQualified}</p>
          <p className="text-xs text-gray-400 mt-1">Scraped</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{campaign.contactsFound}</p>
          <p className="text-xs text-gray-400 mt-1">Founders Found</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <p className="text-2xl font-bold text-indigo-600">{campaign.targetCount}</p>
          <p className="text-xs text-gray-400 mt-1">Target</p>
        </div>
      </div>

      {/* Progress */}
      {jobStats && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-4">Pipeline Progress</h2>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <StageRow label="Google Search" current={jobStats.discovery.completed} total={jobStats.discovery.total || null} />
            <StageRow label="Website Scraping" current={jobStats.websiteResearch.completed} total={jobStats.websiteResearch.total || null} />
            <StageRow label="Scraped" current={jobStats.qualified} total={campaign.companiesFound || null} />
            <StageRow label="Founder Search" current={jobStats.decisionMakers.completed} total={jobStats.decisionMakers.total || null} />
            <StageRow label="Ads Check" current={jobStats.analysis.completed} total={jobStats.analysis.total || null} />
          </div>
        </div>
      )}

      {/* Results table */}
      {companies.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-bold text-gray-900">
              Results <span className="text-gray-400 font-normal">({companies.length})</span>
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Company</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Website</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Socials</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Email</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Phone</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Founder</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">Google Ads</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">Meta Ads</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {companies.map(co => {
                  const contact = co.contacts?.find(c => c.isPrimary) ?? co.contacts?.[0] ?? null;
                  const isExpanded = expandedId === co.id;
                  const emails = getEmails(co.evidence || []);
                  const phones = getPhones(co.evidence || []);

                  return (
                    <Fragment key={co.id}>
                      <tr onClick={() => setExpandedId(isExpanded ? null : co.id)} className="hover:bg-gray-50 cursor-pointer transition-colors">
                        <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{co.name}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {co.website ? (
                            <a href={co.website} target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline text-xs" onClick={e => e.stopPropagation()}>
                              {co.domain || co.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                            </a>
                          ) : <span className="text-gray-300">--</span>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <SocialIcon url={getSocial(co.evidence || [], "linkedin")} platform="linkedin" />
                            <SocialIcon url={getSocial(co.evidence || [], "facebook")} platform="facebook" />
                            <SocialIcon url={getSocial(co.evidence || [], "instagram")} platform="instagram" />
                            <SocialIcon url={getSocial(co.evidence || [], "twitter")} platform="twitter" />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600 max-w-[140px] truncate">
                          {emails.length > 0 ? emails[0] : <span className="text-gray-300">--</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                          {phones.length > 0 ? phones[0] : <span className="text-gray-300">--</span>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {contact ? (
                            <div className="text-xs">
                              <span className="text-gray-700 font-medium">{contact.fullName}</span>
                              {contact.linkedinUrl && (
                                <a href={contact.linkedinUrl} target="_blank" rel="noopener noreferrer" className="ml-1 text-[#0A66C2] hover:underline" onClick={e => e.stopPropagation()}>
                                  in
                                </a>
                              )}
                            </div>
                          ) : <span className="text-gray-300">--</span>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap"><AdsTag status={co.googleAdsStatus} /></td>
                        <td className="px-4 py-3 whitespace-nowrap"><AdsTag status={co.metaAdsStatus} /></td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            co.researchStatus === "COMPLETED" ? "bg-green-50 text-green-700" :
                            co.researchStatus === "FAILED" ? "bg-red-50 text-red-600" :
                            co.researchStatus === "DISCOVERED" ? "bg-gray-50 text-gray-500" :
                            "bg-blue-50 text-blue-600"
                          }`}>
                            {co.researchStatus?.toLowerCase() || "pending"}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {contact?.linkedinUrl && (
                            <button
                              onClick={e => { e.stopPropagation(); handleAddToOutreach(co.id, contact.id); }}
                              disabled={addingOutreach[co.id]}
                              className="rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 text-xs font-semibold px-2.5 py-1.5 transition-colors disabled:opacity-40"
                            >
                              {addingOutreach[co.id] ? "Adding..." : "Outreach"}
                            </button>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-gray-50">
                          <td colSpan={10} className="px-6 py-4">
                            <div className="grid grid-cols-3 gap-6 text-xs">
                              <div>
                                <p className="font-semibold text-gray-500 uppercase tracking-wide mb-2">Social Links</p>
                                {["linkedin","facebook","instagram","twitter","youtube","tiktok"].map(p => {
                                  const url = getSocial(co.evidence || [], p);
                                  return url ? (
                                    <p key={p} className="text-gray-700 mb-1">
                                      <span className="font-medium capitalize">{p}:</span>{" "}
                                      <a href={url} target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline break-all">{url}</a>
                                    </p>
                                  ) : null;
                                })}
                                {!["linkedin","facebook","instagram","twitter","youtube","tiktok"].some(p => getSocial(co.evidence || [], p)) && (
                                  <p className="text-gray-400 italic">No social links found</p>
                                )}
                              </div>
                              <div>
                                <p className="font-semibold text-gray-500 uppercase tracking-wide mb-2">Contact Info</p>
                                {emails.map((e, i) => <p key={i} className="text-gray-700 mb-1"><span className="font-medium">Email:</span> {e}</p>)}
                                {phones.map((p, i) => <p key={i} className="text-gray-700 mb-1"><span className="font-medium">Phone:</span> {p}</p>)}
                                {co.location && <p className="text-gray-700 mb-1"><span className="font-medium">Location:</span> {co.location}</p>}
                                {emails.length === 0 && phones.length === 0 && !co.location && (
                                  <p className="text-gray-400 italic">No contact info found yet</p>
                                )}
                              </div>
                              <div>
                                <p className="font-semibold text-gray-500 uppercase tracking-wide mb-2">Decision Makers</p>
                                {co.contacts?.length > 0 ? co.contacts.map(ct => (
                                  <div key={ct.id} className="mb-2">
                                    <p className="text-gray-700 font-medium">{ct.fullName}</p>
                                    <p className="text-gray-500">{ct.title}</p>
                                    {ct.linkedinUrl && (
                                      <a href={ct.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline">LinkedIn Profile</a>
                                    )}
                                  </div>
                                )) : <p className="text-gray-400 italic">No founders found yet</p>}
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

      {/* Empty state */}
      {!loading && companies.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center mb-3">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-gray-700">No results yet</h3>
            <p className="text-xs text-gray-400 mt-1">
              {campaign.status === "DRAFT"
                ? "Click Start Research to begin discovering companies via Google."
                : "Results will appear here as the extension scrapes websites."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
