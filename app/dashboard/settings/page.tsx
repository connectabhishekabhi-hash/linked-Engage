"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";

type ConnectionStatus = "idle" | "loading" | "connected" | "error";

function Section({
  icon,
  title,
  subtitle,
  badge,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {icon}
          <div>
            <h2 className="font-semibold text-gray-900 text-sm">{title}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
          </div>
        </div>
        {badge}
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  );
}

function ConnectedBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 border border-green-200 px-3 py-1 text-xs font-semibold text-green-700">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
      Connected
    </span>
  );
}

// ── Main content ──────────────────────────────────────────────────────────────
function SettingsContent() {
  const [cookie,        setCookie]        = useState("");
  const [status,        setStatus]        = useState<ConnectionStatus>("idle");
  const [lastVerified,  setLastVerified]  = useState<string | null>(null);
  const [errorMsg,      setErrorMsg]      = useState("");
  const [apiToken,      setApiToken]      = useState<string | null>(null);
  const [copied,        setCopied]        = useState(false);
  const [oauthConnected,setOauthConnected]= useState(false);
  const [oauthMemberId, setOauthMemberId] = useState<string | null>(null);

  const searchParams = useSearchParams();

  const copyToken = () => {
    if (!apiToken) return;
    navigator.clipboard.writeText(apiToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    fetch("/api/linkedin-account")
      .then((r) => r.json())
      .then((data) => {
        if (data.connected) {
          setStatus("connected");
          setLastVerified(data.account?.lastVerifiedAt ?? null);
        }
        if (data.apiToken) setApiToken(data.apiToken);
        if (data.account?.linkedinMemberId) {
          setOauthConnected(true);
          setOauthMemberId(data.account.linkedinMemberId);
        }
      });
    if (searchParams.get("linkedin") === "connected") setOauthConnected(true);
  }, [searchParams]);

  const handleSave = async () => {
    setStatus("loading");
    setErrorMsg("");
    const res = await fetch("/api/linkedin-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ liAt: cookie }),
    });
    if (res.ok) {
      setStatus("connected");
      setLastVerified(new Date().toISOString());
      setCookie("");
    } else {
      const data = await res.json();
      setStatus("error");
      setErrorMsg(data.error ?? "Failed to save cookie");
    }
  };

  const handleDisconnect = async () => {
    await fetch("/api/linkedin-account", { method: "DELETE" });
    setStatus("idle");
    setLastVerified(null);
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Manage your LinkedIn connection and extension token.
        </p>
      </div>

      {/* LinkedIn Session Cookie */}
      <Section
        icon={
          <div className="w-9 h-9 rounded-xl bg-[#0A66C2] flex items-center justify-center text-white font-bold text-xs shrink-0">
            in
          </div>
        }
        title="LinkedIn Session"
        subtitle="Required for posting comments and connection requests"
        badge={status === "connected" ? <ConnectedBadge /> : undefined}
      >
        {status === "connected" ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Session active — cookie stored with AES-256-GCM encryption.
              {lastVerified && (
                <span className="block text-xs text-gray-400 mt-1">
                  Last updated: {new Date(lastVerified).toLocaleDateString()}
                </span>
              )}
            </p>
            <button
              onClick={handleDisconnect}
              className="text-sm text-red-500 hover:text-red-700 font-medium underline-offset-2 hover:underline transition-colors"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 space-y-2">
              <p className="text-xs font-bold text-amber-800 uppercase tracking-wide">
                How to get your cookie
              </p>
              <ol className="text-xs text-amber-700 space-y-1.5 list-decimal list-inside leading-relaxed">
                <li>Open <strong>linkedin.com</strong> in Chrome and log in.</li>
                <li>Press <kbd className="bg-amber-100 px-1.5 py-0.5 rounded font-mono text-xs">F12</kbd> → Application tab.</li>
                <li>Cookies → <strong>https://www.linkedin.com</strong>.</li>
                <li>Find <strong className="font-mono">li_at</strong> → copy the Value.</li>
                <li>Paste below and click Save.</li>
              </ol>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700" htmlFor="liAt">
                li_at Cookie Value
              </label>
              <input
                id="liAt"
                type="password"
                value={cookie}
                onChange={(e) => setCookie(e.target.value)}
                placeholder="Paste your li_at cookie here…"
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300 transition-shadow"
              />
              <p className="text-xs text-gray-400">
                Encrypted with AES-256-GCM — never logged or exposed.
              </p>
            </div>

            {errorMsg && (
              <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                {errorMsg}
              </p>
            )}

            <button
              onClick={handleSave}
              disabled={!cookie || status === "loading"}
              className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {status === "loading" ? "Saving…" : "Save & Connect"}
            </button>
          </div>
        )}
      </Section>

      {/* LinkedIn Official API (OAuth) */}
      <Section
        icon={
          <div className="w-9 h-9 rounded-xl bg-[#0A66C2] flex items-center justify-center text-white font-bold text-[10px] shrink-0">
            API
          </div>
        }
        title="LinkedIn Official API"
        subtitle="Server-side posting — no extension needed for comments"
        badge={oauthConnected ? <ConnectedBadge /> : undefined}
      >
        {oauthConnected ? (
          <div className="space-y-3">
            <div className="flex items-start gap-3 rounded-xl bg-green-50 border border-green-200 p-4">
              <span className="text-green-500 font-bold mt-0.5">✓</span>
              <div>
                <p className="text-sm font-semibold text-green-800">LinkedIn API connected</p>
                <p className="text-xs text-green-600 mt-0.5">
                  Comments post directly via official API — faster and more reliable.
                </p>
                {oauthMemberId && (
                  <p className="text-xs font-mono text-green-500 mt-1">
                    Member ID: {oauthMemberId}
                  </p>
                )}
              </div>
            </div>
            <a href="/api/linkedin/connect" className="text-xs text-indigo-600 hover:underline font-medium">
              Re-authorise / refresh token →
            </a>
          </div>
        ) : (
          <div className="space-y-4">
            <ul className="text-xs text-gray-500 space-y-1.5">
              <li className="flex items-center gap-2">
                <span className="text-indigo-400">✓</span> Posts instantly from the server
              </li>
              <li className="flex items-center gap-2">
                <span className="text-indigo-400">✓</span> Official API — won&apos;t break on LinkedIn updates
              </li>
              <li className="flex items-center gap-2">
                <span className="text-indigo-400">✓</span> More reliable than session cookies
              </li>
            </ul>
            {searchParams.get("linkedin") === "error" && (
              <p className="text-sm text-red-600 rounded-xl bg-red-50 border border-red-200 px-3 py-2">
                Authorisation failed ({searchParams.get("reason") ?? "unknown"}). Please try again.
              </p>
            )}
            <a
              href="/api/linkedin/connect"
              className="flex items-center justify-center gap-2 w-full rounded-xl bg-[#0A66C2] py-2.5 text-sm font-semibold text-white hover:bg-[#004182] transition-colors"
            >
              <span className="font-bold text-base leading-none">in</span>
              Connect LinkedIn Account
            </a>
            <p className="text-xs text-gray-400 text-center">
              You&apos;ll be redirected to LinkedIn. Only comment permissions are requested.
            </p>
          </div>
        )}
      </Section>

      {/* Chrome Extension Token */}
      <Section
        icon={
          <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
        }
        title="Chrome Extension Token"
        subtitle="Paste into the LinkedEngage extension popup to activate it"
      >
        <p className="text-sm text-gray-500 mb-4">
          The extension uses your real browser session — no Playwright, no bans.
        </p>
        {apiToken ? (
          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Your Token
            </label>
            <div className="flex gap-2">
              <input
                readOnly
                value={apiToken}
                className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-mono text-gray-700 focus:outline-none"
              />
              <button
                onClick={copyToken}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors whitespace-nowrap"
              >
                {copied ? "✓ Copied!" : "Copy"}
              </button>
            </div>
            <p className="text-xs text-gray-400">
              Keep this secret — it grants full extension access to your account.
            </p>
          </div>
        ) : (
          <p className="text-sm text-gray-400">Loading token…</p>
        )}
      </Section>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64 text-sm text-gray-400">
        Loading settings…
      </div>
    }>
      <SettingsContent />
    </Suspense>
  );
}
