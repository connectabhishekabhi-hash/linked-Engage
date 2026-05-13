/**
 * background.js — MV3 Service Worker
 *
 * Key insight: Service workers CANNOT send cookies via fetch() cross-origin.
 * Instead we inject scripts into an active LinkedIn tab via chrome.scripting.executeScript,
 * which runs in the tab's real browser context and has full cookie access.
 */

import { getLinkedInAuth }              from "./utils/auth.js";
import { fetchNextJob, completeJob, failJob, getStoredToken } from "./utils/api.js";

// ── Module-load proof: if you see this in the service worker console the
//    script parsed and loaded correctly.
console.log("[bg] background.js module loaded ✓ v15 (bg reads prefs for content script)");

const ALARM_NAME = "linkedengage-poll";
const POLL_INTERVAL_MINUTES = 0.5; // every 30 seconds

// ─── Install / startup ────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  console.log("[bg] LinkedEngage installed — alarm set");
  setupAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  console.log("[bg] onStartup fired");
  setupAlarm();
});

function setupAlarm() {
  chrome.alarms.get(ALARM_NAME, (existing) => {
    if (!existing) {
      chrome.alarms.create(ALARM_NAME, { periodInMinutes: POLL_INTERVAL_MINUTES });
      console.log("[bg] Alarm created");
    } else {
      console.log("[bg] Alarm already exists, next fire in",
        Math.round((existing.scheduledTime - Date.now()) / 1000), "s");
    }
  });
}

// ─── Alarm + message handlers ─────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) await pollAndProcess();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "POLL_NOW") {
    pollAndProcess().then(() => sendResponse({ ok: true }));
    return true;
  }

  // ── Inline comment generation (content.js → background → backend) ──────
  // Content scripts can lose chrome.storage access after extension reload,
  // so background.js reads the popup AI preferences and merges them here.
  if (msg.type === "GENERATE_COMMENT") {
    (async () => {
      try {
        const token = await getStoredToken();
        if (!token) {
          sendResponse({ error: "Extension not connected. Open the popup and connect first." });
          return;
        }

        // Read AI preferences from storage (always available in service worker)
        const prefs = await chrome.storage.local.get([
          "aiLength", "aiTone", "aiEmojis", "aiAskQuestion",
        ]);

        const payload = {
          ...msg.payload,
          preferences: {
            length:      prefs.aiLength      ?? "standard",
            tone:        prefs.aiTone        ?? "professional",
            useEmojis:   prefs.aiEmojis      ?? false,
            askQuestion: prefs.aiAskQuestion  ?? false,
          },
        };

        const BACKEND = "http://localhost:3000";
        const res = await fetch(`${BACKEND}/api/extension/generate-comment`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          sendResponse({ error: err.error ?? `Server error ${res.status}` });
          return;
        }

        const data = await res.json();
        sendResponse({ comment: data.comment });
      } catch (e) {
        console.error("[bg] GENERATE_COMMENT error:", e);
        sendResponse({ error: e.message });
      }
    })();
    return true; // keep message port open for async response
  }
});

// ─── Core poll loop ───────────────────────────────────────────────────────────

async function pollAndProcess() {
  console.log("[bg] pollAndProcess fired");
  const token = await getStoredToken();
  if (!token) { console.log("[bg] No token — open extension popup and connect"); return; }
  console.log("[bg] Token present ✓");

  const auth = await getLinkedInAuth();
  if (!auth) {
    console.warn("[bg] No LinkedIn auth — user not logged into linkedin.com");
    await setStatus("⚠️ Not logged into LinkedIn — open linkedin.com first");
    return;
  }
  console.log("[bg] LinkedIn auth ✓ csrf=", auth.csrfToken ? "ok" : "MISSING");

  let job;
  try { job = await fetchNextJob(); }
  catch (e) { console.error("[bg] fetchNextJob failed:", e.message); return; }

  if (!job) { console.log("[bg] No pending jobs — idle"); await setStatus("✅ Connected — idle"); return; }
  console.log("[bg] Picked up job:", job.id, job.type, JSON.stringify(job.payload).slice(0, 100));

  console.log(`[bg] Job ${job.id} (${job.type})`);
  await setStatus(`⚙️ Running: ${job.type} for ${job.payload?.vanityName ?? job.payload?.profileUrn ?? ""}`);

  try {
    await processJob(job, auth);
    await setStatus("✅ Last job completed");
  } catch (err) {
    console.error(`[bg] Job failed:`, err.message);
    await failJob(job.id, err.message);
    await setStatus(`❌ Job failed: ${err.message.slice(0, 80)}`);
  }
}

// ─── Job processor ────────────────────────────────────────────────────────────

async function processJob(job, auth) {
  switch (job.type) {
    case "SCRAPE": {
      const vanityName = normalizeVanityName(job.payload.vanityName);
      if (!vanityName) throw new Error("Invalid LinkedIn profile URL or vanity name in scrape job");

      // ── Step 1: Get profile data (name, headline, bio, profileUrn) ──────────
      // Run in any existing LinkedIn tab — just needs cookies
      const profileData = await runInLinkedInTab("scrapeProfile", [vanityName, auth.csrfToken]);

      // ── Step 2: Get posts via the recent-activity page ────────────────────
      // Navigate a background tab to linkedin.com/in/{vanity}/recent-activity/all/
      // LinkedIn pre-renders all posts there — far more reliable than the API.
      let posts = profileData?.posts ?? [];

      if (posts.length === 0) {
        let activityTab;
        try {
          const activityUrl = `https://www.linkedin.com/in/${encodeURIComponent(vanityName)}/recent-activity/all/`;
          activityTab = await chrome.tabs.create({ url: activityUrl, active: false });
          await waitForTabLoad(activityTab.id);
          // Give LinkedIn's JS time to render the posts after initial load
          await new Promise(r => setTimeout(r, 5000));

          const activityResults = await chrome.scripting.executeScript({
            target: { tabId: activityTab.id },
            func: extractPostsFromPage,
            args: [auth.csrfToken, vanityName, profileData?.profileUrn ?? ""],
          });
          const activityData = activityResults?.[0]?.result ?? { posts: [], debug: [] };
          posts = Array.isArray(activityData) ? activityData : (activityData.posts ?? []);
          const debugLog = Array.isArray(activityData) ? [] : (activityData.debug ?? []);
          console.log("[bg] Activity page returned", posts.length, "posts. Debug:", debugLog.join(" | "));
        } catch (e) {
          console.warn("[bg] Activity page scrape failed:", e.message);
        } finally {
          if (activityTab) chrome.tabs.remove(activityTab.id).catch(() => {});
        }
      }

      await completeJob(job.id, { ...profileData, posts });
      break;
    }
    case "CONNECTION_REQUEST": {
      const result = await runInLinkedInTab("sendConnectionRequest", [job.payload.profileUrn, job.payload.note, auth.csrfToken]);
      await completeJob(job.id, { sent: true });
      break;
    }
    case "COMMENT": {
      const activityUrn = job.payload.activityUrn;
      const objectUrn   = job.payload.objectUrn || activityUrn;

      // ⚠️ Do NOT encodeURIComponent the URN here.
      // LinkedIn's /feed/update/ page expects literal colons in the URN path,
      // e.g. /feed/update/urn:li:activity:7457892111758045184
      // Percent-encoding breaks the redirect and the comment box never appears.
      const targetUrl = job.payload.targetUrl ||
        (activityUrn ? `https://www.linkedin.com/feed/update/${activityUrn}` : "");

      let myUrn = "";
      try {
        myUrn = await runInLinkedInTab("getMyProfile", [auth.csrfToken]);
      } catch (profileErr) {
        console.warn("[bg] Could not resolve my LinkedIn URN:", profileErr.message);
      }

      console.log("[bg] COMMENT — myUrn:", myUrn,
        "activityUrn:", activityUrn, "objectUrn:", objectUrn,
        "targetUrl:", targetUrl);

      if (!activityUrn && !objectUrn)
        throw new Error("No post URN in job payload — re-scrape this lead.");

      let commentPosted = false;

      // ── Attempt 1: Voyager API ─────────────────────────────────────────────
      if (myUrn) {
        try {
          await runInLinkedInTab("postComment",
            [activityUrn, objectUrn, myUrn, job.payload.commentText, auth.csrfToken]);
          commentPosted = true;
          console.log("[bg] COMMENT — Voyager API succeeded");
        } catch (apiErr) {
          // Log the FULL error (not truncated) so we can see the HTTP status
          console.warn("[bg] COMMENT — Voyager API failed (full error):", apiErr.message);
        }
      }

      // ── Attempt 2: Page fallback (DOM automation) ──────────────────────────
      if (!commentPosted) {
        console.log("[bg] COMMENT — trying page fallback, url:", targetUrl);
        await postCommentViaPage(targetUrl, job.payload.commentText);
        commentPosted = true;
        console.log("[bg] COMMENT — page fallback succeeded");
      }

      await completeJob(job.id, { posted: true });
      break;
    }
    case "SEARCH": {
      const {
        searchUrl,            // pre-built LinkedIn URL from lib/buildSearchUrl.ts
        query   = "",
        start   = 0,
        count   = 30,
        searchId,
        titleFilter   = "",  // for client-side post-filtering only
        excludeFilter = "",  // for client-side post-filtering only
      } = job.payload;

      // ── Validate we have a URL to open ────────────────────────────────────
      // searchUrl is built server-side by lib/buildSearchUrl.ts, which maps
      // each filter to its own URL param (title=, company=, keywords=, network=).
      // If it's missing (old job), fall back gracefully to a keyword search.
      const targetUrl = searchUrl?.trim()
        ? searchUrl.trim()
        : `https://www.linkedin.com/search/results/people/?origin=GLOBAL_SEARCH_HEADER&keywords=${encodeURIComponent(query.trim())}`;

      if (!targetUrl.includes("linkedin.com/search")) {
        throw new Error("Invalid or missing LinkedIn search URL in job payload");
      }

      await setStatus(`🔍 Searching LinkedIn…`);
      console.log(`[bg] SEARCH v9 — opening URL: ${targetUrl.slice(0, 120)}`);

      let profiles = [], total = 0, hasMore = false;
      let searchTab;
      try {
        // ── Open the pre-built LinkedIn search URL ────────────────────────
        // Each filter is already a separate URL param — no merging needed here.
        searchTab = await chrome.tabs.create({ url: targetUrl, active: true });
        console.log(`[bg] SEARCH tab created: ${searchTab.id}`);

        await waitForTabLoad(searchTab.id);
        // Buffer for LinkedIn's React hydration to complete
        await new Promise(r => setTimeout(r, 2000));

        const results = await chrome.scripting.executeScript({
          target: { tabId: searchTab.id },
          func:   extractSearchResults,
          args:   ["", start, count, auth.csrfToken],
        });

        const data = results?.[0]?.result ?? {};
        if (data?.error) throw new Error(data.error);

        let rawProfiles = data.profiles ?? [];
        total   = data.total   ?? rawProfiles.length;
        hasMore = data.hasMore ?? false;
        console.log(`[bg] SEARCH raw: ${rawProfiles.length} profiles from DOM`);
        if (data.debug?.length) console.log("[bg] SEARCH debug:", data.debug.join(" | "));

        // ── Smart client-side post-filter ─────────────────────────────────
        // Runs after LinkedIn's own URL filters (title=, keywords=, network=).
        // Three layers: Open-to-Work drop → exclude terms → title validation.
        const beforeFilter = rawProfiles.length;
        rawProfiles = sanitizeProfiles(rawProfiles, { titleFilter, excludeFilter });
        console.log(`[bg] SEARCH sanitize: ${beforeFilter} → ${rawProfiles.length} profiles`);

        profiles = rawProfiles;
        total    = profiles.length;
      } finally {
        if (searchTab?.id) chrome.tabs.remove(searchTab.id).catch(() => {});
      }

      console.log(`[bg] SEARCH v9 complete: ${profiles.length} profiles`);
      await completeJob(job.id, { profiles, total, hasMore, searchId });
      break;
    }

    default:
      throw new Error(`Unknown job type: ${job.type}`);
  }
}

// ─── Tab injection ────────────────────────────────────────────────────────────
// Runs Voyager API calls inside a real LinkedIn tab (has cookie access)

function normalizeVanityName(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const safeDecode = (text) => {
    try { return decodeURIComponent(text); }
    catch { return text; }
  };

  try {
    const parsed = raw.startsWith("http")
      ? new URL(raw)
      : new URL(`https://www.linkedin.com/in/${raw}`);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const vanity = segments[0] === "in" ? segments[1] : segments[0];
    return safeDecode(vanity ?? "").split("?")[0].split("#")[0].trim();
  } catch {
    return safeDecode(raw).split("/")[0].split("?")[0].split("#")[0].trim();
  }
}

async function postCommentViaPage(targetUrl, commentText) {
  if (!targetUrl) throw new Error("No post URL available for page comment fallback");

  let tab;
  try {
    tab = await chrome.tabs.create({ url: targetUrl, active: true });
    await waitForTabLoad(tab.id);
    await new Promise(r => setTimeout(r, 5000));

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: postCommentFromLinkedInPage,
      args: [commentText],
    });

    const result = results?.[0]?.result;
    if (result?.error) throw new Error(result.error);
    return result;
  } finally {
    if (tab?.id) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function runInLinkedInTab(fnName, args) {
  // Retry once if the tab was closed between lookup and script injection
  for (let attempt = 0; attempt < 2; attempt++) {
    const tab = await getOrCreateLinkedInTab();
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: executeVoyagerCall,
        args: [fnName, args],
      });
      const result = results?.[0]?.result;
      if (result?.error) throw new Error(result.error);
      return result?.data;
    } catch (e) {
      if (e.message?.includes("No tab with id") && attempt === 0) {
        console.warn("[bg] Tab gone, retrying with fresh tab:", e.message);
        continue; // getOrCreateLinkedInTab will open a new one
      }
      throw e;
    }
  }
}

/**
 * extractPostsFromPage — runs INSIDE the recent-activity tab (async, has real cookies).
 * Returns { posts: [{text, activityUrn, url}], debug: string[] }
 * Strategies tried in order:
 *   1. Voyager API (authenticated — most reliable)
 *   2. LinkedIn embedded JSON blobs in <code id="bpr-guid-*">
 *   3. Aggressive DOM text extraction (no class-name assumptions)
 */
async function extractPostsFromPage(csrfToken, vanityName, knownProfileUrn) {
  const posts = [];
  const debug = [];

  const apiHeaders = {
    "accept": "application/vnd.linkedin.normalized+json+2.1",
    "csrf-token": csrfToken,
    "x-restli-protocol-version": "2.0.0",
    "x-li-lang": "en_US",
    "x-li-track": JSON.stringify({
      clientVersion: "1.13.9220", mpVersion: "1.13.9220",
      osName: "web", timezoneOffset: new Date().getTimezoneOffset() / -60,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      deviceFormFactor: "DESKTOP", mpName: "voyager-web",
    }),
  };

  debug.push(`url=${window.location.href}`);
  debug.push(`knownProfileUrn=${knownProfileUrn || "none"}`);
  debug.push(`domCodeEls=${document.querySelectorAll("code[id]").length}`);
  debug.push(`domDataUrn=${document.querySelectorAll("[data-urn]").length}`);

  function cleanUrn(raw) {
    if (!raw) return "";
    if (/^urn:li:(activity|ugcPost|share):\d+$/.test(raw)) return raw;
    let m = raw.match(/urn:li:ugcPost:(\d+)/);
    if (m) return `urn:li:ugcPost:${m[1]}`;
    m = raw.match(/urn:li:share:(\d+)/);
    if (m) return `urn:li:share:${m[1]}`;
    m = raw.match(/urn:li:activity:(\d+)/);
    if (m) return `urn:li:activity:${m[1]}`;
    return raw;
  }

  function extractUrns(u) {
    if (!u) return { activityUrn: "", shareUrn: "" };
    let activityUrn = "", shareUrn = "";
    const all = [u?.entityUrn, u?.updateMetadata?.urn, u?.updateMetadata?.updateUrn, u?.updateUrn];
    for (const v of all) {
      if (!v) continue;
      const cleaned = cleanUrn(v);
      if (cleaned.startsWith("urn:li:activity:") && !activityUrn) activityUrn = cleaned;
      if ((cleaned.startsWith("urn:li:ugcPost:") || cleaned.startsWith("urn:li:share:")) && !shareUrn) shareUrn = cleaned;
    }
    return { activityUrn, shareUrn };
  }

  function extractText(u) {
    if (!u) return "";
    return (
      u?.commentary?.text?.text ??
      (typeof u?.commentary?.text === "string" ? u.commentary.text : null) ??
      u?.value?.["com.linkedin.voyager.feed.render.UpdateV2"]?.commentary?.text?.text ??
      u?.value?.["com.linkedin.voyager.feed.render.UpdateV2Mixin"]?.commentary?.text?.text ??
      u?.content?.text?.text ?? u?.headerText?.text ?? ""
    );
  }

  function tryAdd(u, source) {
    if (!u || posts.length >= 3) return false;
    const text = extractText(u);
    const { activityUrn, shareUrn } = extractUrns(u);
    const urn = activityUrn || shareUrn;
    if (text.length > 10 && urn && !posts.some(p => p.activityUrn === urn)) {
      posts.push({ text, activityUrn: urn, shareUrn, url: `https://www.linkedin.com/feed/update/${encodeURIComponent(urn)}` });
      debug.push(`post[${posts.length - 1}] from=${source} activity=${activityUrn.slice(-15)} share=${shareUrn.slice(-15)}`);
      return true;
    }
    return false;
  }

  function processNormalized(data, source) {
    const included = data?.included ?? [];
    const refs = data?.data?.["*elements"] ?? data?.data?.elements ?? data?.elements ?? [];
    const resolved = Array.isArray(refs)
      ? refs.map(r => typeof r === "string" ? included.find(i => i?.entityUrn === r) : r).filter(Boolean)
      : [];
    const pool = resolved.length > 0 ? resolved : included;
    debug.push(`${source}: refs=${refs.length} included=${included.length} resolved=${resolved.length}`);
    for (const u of pool) tryAdd(u, source);
  }

  // ── Strategy 1: Voyager API (authenticated fetch from within the tab) ──────
  let profileUrn = knownProfileUrn || "";

  if (!profileUrn && vanityName) {
    try {
      const pRes = await fetch(
        `https://www.linkedin.com/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=${encodeURIComponent(vanityName)}`,
        { credentials: "include", headers: apiHeaders }
      );
      debug.push(`profileLookup: status=${pRes.status}`);
      if (pRes.ok) {
        const pData = await pRes.json();
        const prof = (pData?.included ?? []).find(i => i?.firstName) ?? {};
        profileUrn = prof?.entityUrn ?? "";
        debug.push(`profileUrn resolved: ${profileUrn}`);
      }
    } catch (e) { debug.push(`profileLookup error: ${e.message}`); }
  }

  if (profileUrn) {
    const feedEndpoints = [
      `/voyager/api/identity/dash/profileUpdates?q=memberProfileUpdates&profileUrn=${encodeURIComponent(profileUrn)}&count=5&start=0`,
      `/voyager/api/feed/updates?profileId=${encodeURIComponent(profileUrn)}&q=memberShareFeed&moduleKey=member-share&count=5`,
      `/voyager/api/feed/profile-updates?profileId=${encodeURIComponent(profileUrn)}&q=memberShareFeed&moduleKey=member-share&count=5`,
    ];
    for (const ep of feedEndpoints) {
      if (posts.length >= 3) break;
      try {
        const fRes = await fetch(`https://www.linkedin.com${ep}`, { credentials: "include", headers: apiHeaders });
        debug.push(`api ${ep.split("?")[0].split("/").pop()}: status=${fRes.status}`);
        if (!fRes.ok) continue;
        const fData = await fRes.json();
        processNormalized(fData, ep.split("?")[0].split("/").pop());
      } catch (e) { debug.push(`api error: ${e.message.slice(0, 60)}`); }
    }
  } else {
    debug.push("no profileUrn — skipping API strategy");
  }

  // ── Strategy 2: Embedded JSON blobs <code id="bpr-guid-*"> ─────────────────
  if (posts.length === 0) {
    try {
      const codeEls = document.querySelectorAll("code[id]");
      let blobsChecked = 0;
      for (const el of codeEls) {
        if (posts.length >= 3) break;
        const raw = el.textContent || "";
        if (raw.length < 100) continue;
        let blob; try { blob = JSON.parse(raw); } catch { continue; }
        blobsChecked++;
        processNormalized(blob, "bpr-blob");
        const inc = blob?.included ?? blob?.data?.included ?? [];
        for (const u of inc) tryAdd(u, "bpr-included");
      }
      debug.push(`bpr-blobs: checked=${blobsChecked} posts=${posts.length}`);
    } catch (e) { debug.push(`bpr error: ${e.message}`); }
  }

  // ── Strategy 3: Aggressive DOM extraction — no class-name assumptions ───────
  // Find every element with data-urn containing "activity" or "ugcPost",
  // then grab the longest text chunk inside it.
  if (posts.length === 0) {
    try {
      const urnEls = document.querySelectorAll("[data-urn]");
      debug.push(`DOM [data-urn] elements found: ${urnEls.length}`);
      for (const el of urnEls) {
        if (posts.length >= 3) break;
        const rawUrn = el.getAttribute("data-urn") || "";
        if (!rawUrn.includes("activity") && !rawUrn.includes("ugcPost")) continue;
        const urn = cleanUrn(rawUrn); // strip fsd_update wrappers

        // Walk the element collecting all non-trivial text nodes
        const texts = [];
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const t = node.textContent?.trim();
          if (t && t.length > 20) texts.push(t);
        }
        // Pick the longest text — most likely the post body
        const text = texts.sort((a, b) => b.length - a.length)[0] ?? "";
        if (text.length > 30 && !posts.some(p => p.activityUrn === urn)) {
          posts.push({ text, activityUrn: urn, url: `https://www.linkedin.com/feed/update/${encodeURIComponent(urn)}` });
          debug.push(`DOM post[${posts.length - 1}] urn=${urn.slice(-20)} text="${text.slice(0, 40)}"`);
        }
      }
    } catch (e) { debug.push(`DOM error: ${e.message}`); }
  }

  // ── Strategy 4: Any visible text blocks near an activity URN (last resort) ──
  if (posts.length === 0) {
    try {
      // Look for any article, section, or div that contains an activity URN in HTML
      const allText = document.body.innerHTML;
      const urnMatches = [...allText.matchAll(/urn:li:activity:(\d+)/g)];
      const uniqueUrns = [...new Set(urnMatches.map(m => `urn:li:activity:${m[1]}`))].slice(0, 5);
      debug.push(`HTML urn scan found ${uniqueUrns.length} unique activity URNs`);
      // We found URNs in the HTML but can't get text reliably — record at least that posts exist
      for (const urn of uniqueUrns.slice(0, 3)) {
        if (posts.length >= 3) break;
        posts.push({ text: "[Post found — text extraction failed]", activityUrn: urn, url: `https://www.linkedin.com/feed/update/${encodeURIComponent(urn)}` });
        debug.push(`fallback urn: ${urn}`);
      }
    } catch (e) { debug.push(`urn scan error: ${e.message}`); }
  }

  debug.push(`FINAL: ${posts.length} posts`);
  return { posts, debug };
}

/**
 * sanitizeProfiles
 * ────────────────
 * Smart client-side post-filter applied after LinkedIn's own URL filters.
 * Three layers run in order — first match that drops the profile wins:
 *
 *  1. Open-to-Work / passive signals  — drops anyone whose headline signals
 *     they are between roles (not an active Founder/CEO/etc.)
 *  2. Exclude terms  — drops profiles whose headline or name contains any
 *     user-specified excluded term (comma-separated, case-insensitive)
 *  3. Title validation  — case-insensitive regex check that the headline
 *     contains the title keyword (profiles with blank headlines pass through
 *     because LinkedIn may not have surfaced their title)
 *
 * @param {Array}  profiles     Raw profile array from extractSearchResults
 * @param {Object} params
 * @param {string} params.titleFilter    Job title the user searched for
 * @param {string} params.excludeFilter  Comma-separated exclude terms
 * @returns {Array} Filtered profile array
 */
function sanitizeProfiles(profiles, { titleFilter = "", excludeFilter = "" } = {}) {
  // Pre-compile inputs once
  const titleKeyword   = titleFilter.trim().toLowerCase();
  const excludeTerms   = excludeFilter
    .split(",")
    .map(t => t.trim().toLowerCase())
    .filter(Boolean);

  // Build title regex: matches the exact keyword word-boundary-safe, case-insensitive.
  // e.g. titleKeyword="founder" matches "Co-Founder", "Founder & CEO", "Founding Partner"
  const titleRegex = titleKeyword
    ? new RegExp(titleKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
    : null;

  // Signals that strongly indicate the person is NOT currently in an active role.
  // These appear in LinkedIn headlines when someone sets "Open to Work".
  const PASSIVE_SIGNALS = [
    /open\s+to\s+work/i,
    /looking\s+for\s+(new\s+)?(opportunities|roles|position)/i,
    /seeking\s+(new\s+)?(opportunities|roles|position)/i,
    /actively\s+(looking|seeking|job\s+searching)/i,
    /available\s+for\s+(hire|work|freelance)/i,
  ];

  return profiles.filter(profile => {
    const headline  = (profile.headline  || "").toLowerCase();
    const fullName  = (profile.fullName  || "").toLowerCase();
    const summary   = (profile.summary   || "").toLowerCase(); // "Past: Founder at …"
    const haystack  = `${fullName} ${headline}`;

    // ── Layer 1: Drop Open-to-Work / passive signals ───────────────────────
    // These people matched because LinkedIn semantically linked their PAST title
    // to the search term.  We want CURRENT role holders only.
    if (PASSIVE_SIGNALS.some(rx => rx.test(headline))) {
      return false;
    }

    // Also drop if the summary field starts with "Past:" — LinkedIn uses this
    // to indicate the match is based on a historical role, not the current one.
    if (summary && /^\s*past\s*:/i.test(summary)) {
      return false;
    }

    // ── Layer 2: Exclude terms ─────────────────────────────────────────────
    if (excludeTerms.length > 0) {
      if (excludeTerms.some(term => haystack.includes(term))) {
        return false;
      }
    }

    // ── Layer 3: Title validation ──────────────────────────────────────────
    // Strict mode: if a title filter is set, we ONLY keep profiles whose
    // headline explicitly contains the keyword.  Blank-headline profiles are
    // now DROPPED — letting them pass was the main source of false positives
    // (LinkedIn matched them on some other field like a skill or past role).
    if (titleRegex) {
      if (!headline.trim() || !titleRegex.test(headline)) {
        return false;
      }
    }

    return true;
  });
}

/**
 * extractSearchResults — injected into an active LinkedIn search-results tab.
 *
 * Architecture (per confirmed account migration to GraphQL):
 *   - NO fetch() calls — all API endpoints return 400 for injected scripts.
 *   - PRIMARY:  Parse <code id="..."> hydration blobs that LinkedIn's GraphQL
 *               renderer embeds in the page after the SPA boots.
 *   - FALLBACK: Broad DOM extraction via a[href*="/in/"] — immune to CSS renames.
 *   - MutationObserver waits for blobs/results to actually appear before extracting.
 */
async function extractSearchResults(query, start, wantCount, csrfToken) {
  const profiles = [];
  const debug    = [];

  try {
    debug.push(`url=${window.location.href.slice(0, 80)}`);

    // ── Shared helpers ──────────────────────────────────────────────────────

    function parseImageUrl(pic) {
      if (!pic) return "";
      const root = pic.rootUrl ?? pic.displayImage ?? "";
      const arts  = pic.artifacts ?? [];
      if (!root || !arts.length) return root;
      const best = arts.reduce((a, b) => ((a.width ?? 0) >= (b.width ?? 0) ? a : b));
      return root + (best.fileIdentifyingUrlPathSegment ?? "");
    }

    function parseDegree(nd) {
      if (!nd) return "3rd+";
      const v = String(nd.value ?? nd.distance ?? nd ?? "");
      if (v.includes("FIRST")  || v === "DISTANCE_1" || v === "1") return "1st";
      if (v.includes("SECOND") || v === "DISTANCE_2" || v === "2") return "2nd";
      return "3rd+";
    }

    function addProfile(p) {
      if (!p.fullName || !p.profileUrl) return;
      const id = (p.profileUrl.match(/\/in\/([^/?#]+)/) ?? [])[1] ?? "";
      if (!id || id === "search" || id.length < 2) return;
      if (profiles.some(x => x.profileUrl === p.profileUrl)) return;
      profiles.push(p);
    }

    function pushMini(mini, degree) {
      if (!mini?.firstName || !mini?.publicIdentifier) return;
      addProfile({
        fullName:         `${mini.firstName} ${mini.lastName ?? ""}`.trim(),
        headline:         mini.occupation ?? mini.headline ?? "",
        summary:          "",  // MiniProfile format has no search-match summary
        profileUrl:       `https://www.linkedin.com/in/${mini.publicIdentifier}/`,
        profileUrn:       mini.entityUrn ?? "",
        profileImageUrl:  parseImageUrl(mini.picture ?? mini.profilePicture),
        connectionDegree: degree,
      });
    }

    // ── Step 1: MutationObserver — wait for hydration blobs to land ─────────
    // LinkedIn's GraphQL SPA embeds results in <code id="bpr-guid-*"> elements
    // AFTER the initial HTML load. We wait up to 15 s for them to appear.
    function pageIsReady() {
      // At least a handful of code blobs, OR profile links visible
      return document.querySelectorAll("code[id]").length >= 3 ||
             document.querySelectorAll('a[href*="/in/"]').length >= 3;
    }

    await new Promise((resolve) => {
      if (pageIsReady()) { resolve(); return; }

      const hardTimeout = setTimeout(resolve, 15000);

      const observer = new MutationObserver(() => {
        if (pageIsReady()) {
          observer.disconnect();
          clearTimeout(hardTimeout);
          resolve();
        }
      });

      observer.observe(document.body || document.documentElement,
        { childList: true, subtree: true });
    });

    // Scroll down to trigger LinkedIn's lazy-load for more results.
    // LinkedIn shows 10 per "page" but loads more as you scroll.
    // We do 3 incremental scrolls with small delays (MutationObserver already
    // confirmed the page is hydrated, so these scrolls are safe).
    try {
      for (let i = 1; i <= 3; i++) {
        window.scrollTo({ top: document.body.scrollHeight * (i / 3), behavior: "smooth" });
        await new Promise(r => setTimeout(r, 1200));
      }
      // Scroll back to top so MiniProfile blobs at the top are still parseable
      window.scrollTo({ top: 0, behavior: "instant" });
      await new Promise(r => setTimeout(r, 500));
    } catch (_) { /* scroll failure is non-fatal */ }

    const codeEls = Array.from(document.querySelectorAll("code[id]"));
    debug.push(`blobs=${codeEls.length}`);
    debug.push(`inLinks=${document.querySelectorAll('a[href*="/in/"]').length}`);

    // ── Step 2: PRIMARY — parse GraphQL hydration blobs ─────────────────────
    // LinkedIn embeds the full GraphQL response in <code id="bpr-guid-*"> tags.
    // Two formats appear depending on account/endpoint:
    //   A) Legacy MiniProfile: { firstName, lastName, publicIdentifier, occupation, picture }
    //   B) New EntityResultViewModel: { title:{text}, navigationUrl, primarySubtitle:{text}, … }
    const degreeMap = new Map(); // entityUrn → degree string

    function degreeFromText(t) {
      if (!t) return "";
      if (t.includes("1st")) return "1st";
      if (t.includes("2nd")) return "2nd";
      if (t.includes("3rd")) return "3rd+";
      return "";
    }

    // LinkedIn's GraphQL title.text often includes pronouns + degree suffix:
    // "Akshay Asp He/Him · 2nd"  →  "Akshay Asp"
    function cleanName(raw) {
      if (!raw) return "";
      return raw
        .replace(/\s*\(?(he|she|they|xe|ze)[\s/](him|her|them|hir)[^)]*\)?/gi, "")
        .replace(/\s*[·•]\s*(1st|2nd|3rd\+?)\s*$/i, "")
        .trim();
    }

    for (const el of codeEls) {
      if (profiles.length >= wantCount) break;
      const raw = el.textContent ?? "";
      // Quick bail — skip blobs with no search-profile data
      if (!raw.includes("publicIdentifier") &&
          !raw.includes("firstName") &&
          !raw.includes("navigationUrl")) continue;

      let blob;
      try { blob = JSON.parse(raw); } catch { continue; }

      const allItems = [
        ...(blob?.included        ?? []),
        ...(blob?.data?.included  ?? []),
      ].filter(Boolean);

      // First pass — build degree map from search-hit relationship objects
      for (const item of allItems) {
        const urn = item.targetUrn ?? item.memberUrn ?? item.entityUrn ?? "";
        const nd  = item.networkDistance ?? item.distance;
        if (urn && nd) degreeMap.set(urn, parseDegree(nd));
      }

      // Second pass — extract profiles
      for (const item of allItems) {
        if (profiles.length >= wantCount) break;

        // ── Format A: legacy MiniProfile ──────────────────────────────────
        if (item.firstName && item.publicIdentifier) {
          const deg = degreeMap.get(item.entityUrn) ?? parseDegree(item.networkDistance);
          pushMini(item, deg);
          continue;
        }

        // ── Format B: new GraphQL EntityResultViewModel ───────────────────
        // title.text = full name, navigationUrl = /in/vanityName
        const navUrl = item.navigationUrl ?? item.url ?? "";
        const navM   = navUrl.match(/\/in\/([^/?#]+)/);
        if (!navM) continue;
        const publicId = navM[1];
        if (publicId.length < 2 || publicId === "search") continue;

        const rawName  = item.title?.text ?? item.title ?? "";
        const fullName = cleanName(String(rawName));
        if (!fullName || fullName.length < 2) continue;

        // primarySubtitle = current role/company ("Founder at Acme")
        // secondarySubtitle = location or degree indicator
        const headline = item.primarySubtitle?.text ?? item.secondarySubtitle?.text ?? "";

        // summary / caption = LinkedIn's snippet explaining WHY this person matched.
        // When the match is based on a past role it reads "Past: Founder at XYZ".
        // We capture it so sanitizeProfiles can drop historical-match profiles.
        const summary  = item.summary?.text
                      ?? item.caption?.text
                      ?? item.summaryV2?.text
                      ?? "";

        // ── Early drop: "Past:" match — profile matched on a historical role ──
        // Drop here at extraction time rather than waiting for sanitizeProfiles,
        // so these never enter the profiles array at all.
        if (summary && /^\s*past\s*:/i.test(summary)) {
          debug.push(`dropped(past): ${fullName}`);
          continue;
        }

        const degText  = item.badgeText?.text ?? item.badge?.text
                      ?? item.insightText?.text ?? "";
        const degree   = degreeFromText(degText)
                      || degreeFromText(item.secondarySubtitle?.text ?? "")
                      || degreeMap.get(item.entityUrn) || "3rd+";

        addProfile({
          fullName:         String(fullName),
          headline:         String(headline),
          summary:          String(summary),   // passed to sanitizeProfiles
          profileUrl:       `https://www.linkedin.com/in/${publicId}/`,
          profileUrn:       item.entityUrn ?? "",
          profileImageUrl:  "", // images come from MiniProfile blobs below
          connectionDegree: degree,
        });
      }
    }

    // Third pass — backfill missing images from MiniProfile blobs
    // (EntityResultViewModel and MiniProfile are in separate <code> elements)
    if (profiles.length > 0) {
      for (const el of codeEls) {
        const raw = el.textContent ?? "";
        if (!raw.includes("picture") && !raw.includes("profilePicture")) continue;
        let blob; try { blob = JSON.parse(raw); } catch { continue; }
        const items = [...(blob?.included ?? []), ...(blob?.data?.included ?? [])].filter(Boolean);
        for (const item of items) {
          if (!item.publicIdentifier) continue;
          const target = profiles.find(
            p => p.profileUrl.includes(`/in/${item.publicIdentifier}/`) && !p.profileImageUrl
          );
          if (target) target.profileImageUrl = parseImageUrl(item.picture ?? item.profilePicture);
        }
      }
    }

    debug.push(`blobs_n=${profiles.length}`);

    // ── Step 3: FALLBACK — broad DOM extraction ─────────────────────────────
    // Only runs if blob parsing yielded nothing.
    if (profiles.length === 0) {
      const seen    = new Set();
      const anchors = Array.from(document.querySelectorAll('a[href*="/in/"]'));
      debug.push(`dom_anchors=${anchors.length}`);

      // ── Diagnostic sample: log what the first 5 anchors actually contain ──
      // This tells us the real DOM structure so we can target it correctly.
      try {
        const samples = [];
        for (const a of anchors.slice(0, 5)) {
          const tc   = (a.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
          const al   = (a.getAttribute("aria-label") ?? "").slice(0, 50);
          const ns   = a.querySelectorAll("span").length;
          const href = (a.getAttribute("href") ?? "").slice(0, 35);
          samples.push(`href:${href} tc:"${tc}" al:"${al}" spans:${ns}`);
        }
        debug.push(`dom_sample: ${samples.join(" || ")}`);
      } catch (_) {}

      // ── Name extraction from an anchor element ─────────────────────────────
      function nameFromAnchor(a) {
        // 1. aria-label: "View Akshay Asp's profile" or just "Akshay Asp"
        const aria = (a.getAttribute("aria-label") ?? "").trim();
        if (aria.length >= 2) {
          const n = cleanName(
            aria.replace(/^View\s+/i, "").replace(/[''`']s\s+profile\s*$/i, "")
          );
          if (n.length >= 2) return n;
        }

        // 2. Direct text nodes only (names sometimes rendered as bare text, not spans)
        //    e.g. <a href="/in/...">John Smith<span aria-hidden="true">Founder</span></a>
        const directText = Array.from(a.childNodes)
          .filter(n => n.nodeType === Node.TEXT_NODE)
          .map(n => (n.textContent ?? "").trim())
          .filter(t => t.length >= 2)
          .join(" ")
          .trim();
        if (directText.length >= 2 && directText.length <= 80) {
          const n = cleanName(directText);
          if (n.length >= 2 && !/^(Connect|Follow|Message|Pending|View)$/i.test(n)) return n;
        }

        // 3. aria-hidden="true" spans — LinkedIn puts the DISPLAYED name here
        //    (the visually-hidden span usually says "View X's profile")
        for (const s of Array.from(a.querySelectorAll('span[aria-hidden="true"]'))) {
          const t = (s.textContent ?? "").trim();
          if (t.length < 2 || t.length > 80) continue;
          if (/^(Connect|Follow|Message|Pending|1st|2nd|3rd)/.test(t)) continue;
          if (t.startsWith("•") || /^\d+$/.test(t)) continue;
          return cleanName(t);
        }

        // 4. First qualifying span (general fallback)
        for (const s of Array.from(a.querySelectorAll("span"))) {
          const t = (s.textContent ?? "").trim();
          if (t.length < 2 || t.length > 80)           continue;
          if (/^View\s+/i.test(t))                     continue;
          if (/[''`']s\s+profile/i.test(t))            continue;
          if (/^(Connect|Follow|Message|Pending|1st|2nd|3rd)/.test(t)) continue;
          if (t.startsWith("•") || /^\d+$/.test(t))    continue;
          return cleanName(t);
        }

        // 5. Short total textContent (only if it looks like a name, not a card dump)
        const raw = (a.textContent ?? "").trim();
        if (raw.length >= 2 && raw.length <= 80) {
          const n = cleanName(raw);
          if (n.length >= 2 &&
              !n.startsWith("•") &&
              !/^[123](st|nd|rd)\+?$/i.test(n) &&
              !/^(Connect|Follow|Message|Pending|View)$/i.test(n)) {
            return n;
          }
        }

        return "";
      }

      // ── Name extraction from a card container (when anchor itself lacks text) ──
      // Prefers multi-word candidates — real names have at least 2 words,
      // whereas job titles like "Founder" are single words.
      function nameFromCard(card) {
        const candidates = [];

        // First: look inside /in/ anchors within the card
        for (const a of card.querySelectorAll('a[href*="/in/"]')) {
          // Try aria-hidden spans inside the anchor
          for (const s of a.querySelectorAll('span[aria-hidden="true"]')) {
            const t = (s.textContent ?? "").trim();
            if (t.length < 2 || t.length > 80) continue;
            if (/^(View|Connect|Follow|Message|Pending|1st|2nd|3rd|\d|•)/.test(t)) continue;
            candidates.push(cleanName(t));
          }
          // Direct text nodes in anchor
          const direct = Array.from(a.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => (n.textContent ?? "").trim())
            .filter(t => t.length >= 2)
            .join(" ").trim();
          if (direct.length >= 2 && direct.length <= 80) candidates.push(cleanName(direct));
        }

        // Then: scan all text elements in card (spans, headings)
        for (const el of card.querySelectorAll("span, p, h3, h4, h5")) {
          const t = (el.textContent ?? "").trim();
          if (t.length < 2 || t.length > 80) continue;
          if (/^(View|Connect|Follow|Message|Pending|1st|2nd|3rd|\d|•)/.test(t)) continue;
          if (/[''`']s\s+profile/i.test(t)) continue;
          candidates.push(cleanName(t));
        }

        // Prefer multi-word candidates (names are "First Last", titles are "Founder")
        const multiWord = candidates.find(n => n.includes(" ") && n.length >= 4);
        return multiWord ?? candidates.find(n => n.length >= 2) ?? "";
      }

      // ── Headline extraction from a card container ──────────────────────────
      // LinkedIn's class names are unstable; we use multiple strategies.
      function headlineFromCard(card, nameText) {
        if (!card) return "";
        const nameLower = nameText.toLowerCase();

        // Helper: is this text a valid headline (not the name, not a UI button)?
        const isHeadline = (t) => {
          if (!t || t.length < 3 || t.length > 200) return false;
          if (t.toLowerCase() === nameLower) return false;
          if (/^(View|Connect|Follow|Message|Pending|1st|2nd|3rd|\d|•|Degree)/i.test(t)) return false;
          if (/[''`']s\s+profile/i.test(t)) return false;
          if (!/[a-zA-Z]{2}/.test(t)) return false;
          return true;
        };

        // Strategy 1: known LinkedIn subtitle class names (stable across many versions)
        for (const sel of [
          '.entity-result__primary-subtitle',
          '[class*="primary-subtitle"]',
          '[class*="entity-result__summary"]',
          '[class*="subtitle"]',
          '.search-result__snippets',
        ]) {
          const el = card.querySelector(sel);
          if (el) {
            const t = el.textContent.trim();
            if (isHeadline(t)) return t;
          }
        }

        // Strategy 2: aria-hidden spans — LinkedIn uses these for the displayed headline
        // Walk spans after the name anchor, they tend to be the subtitle/headline
        const spans = Array.from(card.querySelectorAll('span[aria-hidden="true"]'));
        for (const span of spans) {
          const t = (span.textContent ?? "").trim();
          // Skip if this is the name itself or too short
          if (!isHeadline(t)) continue;
          // Skip single-word matches that look like UI labels
          if (t.split(/\s+/).length === 1 && /^(Connect|Follow|Message|Pending)$/i.test(t)) continue;
          // This is likely the headline — it has multiple words and looks like a job title
          if (t.split(/\s+/).length >= 2 || t.includes("&") || t.includes(",") || t.includes("at ")) {
            return t;
          }
        }

        // Strategy 3: scan direct children of the card (one level deep)
        const directChildren = Array.from(card.children);
        for (const child of directChildren) {
          if (child.querySelector('img')) continue;
          for (const grandchild of Array.from(child.children)) {
            const t = (grandchild.textContent ?? "").trim();
            if (!isHeadline(t)) continue;
            if (grandchild.querySelector('a[href*="/in/"]') || grandchild.matches('a[href*="/in/"]')) continue;
            return t;
          }
        }

        // Strategy 4: any <p> or <div> inside the card that looks like a headline
        for (const el of card.querySelectorAll("p, div")) {
          const t = (el.textContent ?? "").trim();
          if (isHeadline(t) && t.split(/\s+/).length >= 2) {
            // Check it's not a container of containers (keep leaf-like nodes)
            if (el.children.length <= 2) return t;
          }
        }

        return "";
      }

      // ── Build a map of publicId → { profileUrl, card, textAnchor } ────────
      // Walking all anchors once lets us handle profiles whose only /in/ link
      // is an image link (empty textContent).
      const cardMap = new Map(); // publicId → { profileUrl, card, textAnchor }

      for (const anchor of anchors) {
        const m = (anchor.href ?? "").match(/linkedin\.com\/in\/([^/?#]+)/);
        if (!m) continue;
        const publicId = m[1];
        if (publicId.length < 2 || publicId === "search") continue;

        const profileUrl = `https://www.linkedin.com/in/${publicId}/`;
        const existing   = cardMap.get(publicId);

        // Walk up to find the best card container (up to 10 levels)
        let card = null;
        let node = anchor.parentElement;
        for (let i = 0; i < 10 && node; i++) {
          if (node.tagName === "LI" || node.tagName === "ARTICLE") { card = node; break; }
          // DIV that contains ≥2 /in/ links to the SAME profile = card wrapper
          if (node.tagName === "DIV") {
            const inLinks = Array.from(node.querySelectorAll('a[href*="/in/"]'))
              .filter(a => (a.href ?? "").includes(`/in/${publicId}`));
            if (inLinks.length >= 2) { card = node; break; }
          }
          node = node.parentElement;
        }
        // Fallback: any ancestor div with a class string
        if (!card) {
          node = anchor.parentElement;
          for (let i = 0; i < 6 && node; i++) {
            if (node.tagName === "DIV" && node.className) { card = node; break; }
            node = node.parentElement;
          }
        }

        // Prefer the anchor that actually has text content
        const hasText = (anchor.textContent ?? "").trim().length > 0;
        if (!existing) {
          cardMap.set(publicId, { profileUrl, card: card ?? anchor.parentElement, textAnchor: hasText ? anchor : null });
        } else if (hasText && !existing.textAnchor) {
          existing.textAnchor = anchor;
          if (card && !existing.card) existing.card = card;
        }
      }

      debug.push(`dom_cards=${cardMap.size}`);

      // ── Extract profiles from card map ─────────────────────────────────────
      for (const [publicId, { profileUrl, card, textAnchor }] of cardMap) {
        if (profiles.length >= wantCount) break;
        if (seen.has(profileUrl)) continue;

        // Name: try text anchor first, then scan the card container
        let fullName = textAnchor ? nameFromAnchor(textAnchor) : "";
        if (!fullName && card) fullName = nameFromCard(card);
        if (!fullName || fullName.length < 2) continue;

        const headline = headlineFromCard(card, fullName);

        const imgEl = card?.querySelector('img[src*="licdn.com"]')
                   ?? card?.querySelector('img[src*="media"]');
        const degEl = card?.querySelector('.dist-value');

        seen.add(profileUrl);
        addProfile({
          fullName,
          headline,
          summary:          "",  // DOM fallback cannot extract the search-match summary
          profileUrl,
          profileUrn:       `urn:li:member:${publicId}`,
          profileImageUrl:  imgEl?.src ?? "",
          connectionDegree: degEl?.textContent?.trim() ?? "3rd+",
        });
      }

      debug.push(`dom_n=${profiles.length}`);
    }

  } catch (outerErr) {
    debug.push(`OUTER_ERR=${outerErr.message}`);
  }

  console.log("[extractSearchResults]", debug.join(" | "));
  return { profiles: profiles.slice(0, wantCount), total: profiles.length, hasMore: false, debug };
}

// This function runs INSIDE the LinkedIn tab — has full cookie access
async function executeVoyagerCall(fnName, args) {
  const BASE = "https://www.linkedin.com/voyager/api";

  // Get JSESSIONID for csrf-token
  const csrfToken = args[args.length - 1]; // last arg is always csrfToken

  function buildHeaders(csrf) {
    return {
      "accept": "application/vnd.linkedin.normalized+json+2.1",
      "accept-language": "en-US,en;q=0.9",
      "content-type": "application/json",
      "csrf-token": csrf,
      "x-restli-protocol-version": "2.0.0",
      "x-li-lang": "en_US",
      "x-li-track": JSON.stringify({
        clientVersion: "1.13.9220",
        mpVersion: "1.13.9220",
        osName: "web",
        timezoneOffset: new Date().getTimezoneOffset() / -60,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        deviceFormFactor: "DESKTOP",
        mpName: "voyager-web",
      }),
    };
  }

  async function get(path) {
    const res = await fetch(`${BASE}${path}`, {
      method: "GET",
      credentials: "include",
      headers: buildHeaders(csrfToken),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
  }

  async function post(path, body, extraHeaders = {}) {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { ...buildHeaders(csrfToken), ...extraHeaders },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : { ok: true };
  }

  function generateTrackingId() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes));
  }

  // Strips compound fsd_update wrappers — extracts the real numeric URN.
  // urn:li:fsd_update:(urn:li:activity:XXX,FEED_DETAIL,...) → urn:li:activity:XXX
  function cleanUrn(raw) {
    if (!raw) return "";
    if (/^urn:li:(activity|ugcPost|share):\d+$/.test(raw)) return raw;
    let m = raw.match(/urn:li:ugcPost:(\d+)/);
    if (m) return `urn:li:ugcPost:${m[1]}`;
    m = raw.match(/urn:li:share:(\d+)/);
    if (m) return `urn:li:share:${m[1]}`;
    m = raw.match(/urn:li:activity:(\d+)/);
    if (m) return `urn:li:activity:${m[1]}`;
    return raw;
  }

  try {
    // ── scrapeProfile ──────────────────────────────────────────────────────
    if (fnName === "scrapeProfile") {
      const vanityName = args[0];

      // ── Strategy A: dash/profiles (current endpoint) ──────────────────────
      // LinkedIn Voyager normalised JSON: entities live in included[], data holds refs
      // Try without decorationId first (simpler, more stable), then with decoration
      let raw = null;
      const endpoints = [
        `/identity/dash/profiles?q=memberIdentity&memberIdentity=${encodeURIComponent(vanityName)}&decorationId=com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-91`,
        `/identity/dash/profiles?q=memberIdentity&memberIdentity=${encodeURIComponent(vanityName)}`,
      ];
      for (const ep of endpoints) {
        try { raw = await get(ep); break; } catch (_) {}
      }
      if (!raw) throw new Error(`dash/profiles failed for ${vanityName}`);

      // ── Parse response — try all known shapes ─────────────────────────────
      // Shape 1 (normalised): data.elements = [urnString, ...], entities in included[]
      // Shape 2 (direct):     data.elements = [{...profileObj...}, ...]
      // Shape 3 (legacy):     elements = [{...}, ...] at root
      const included = raw?.included ?? [];
      const dataElements = raw?.data?.elements ?? raw?.elements ?? [];

      // Collect candidates: inline objects from data.elements + all of included[]
      const candidates = [
        ...dataElements.filter(e => e && typeof e === "object"),
        ...included,
      ];

      // Find a profile entity that has at minimum a firstName
      const profile =
        candidates.find(i => i?.firstName && i?.lastName) ??
        candidates.find(i => i?.firstName) ??
        candidates.find(i => i?.$type?.toLowerCase().includes("profile") && (i?.firstName || i?.fullName)) ??
        // Last resort: data.elements might be URN strings; find matching entity in included by URN
        (() => {
          const refUrn = typeof dataElements[0] === "string" ? dataElements[0] : null;
          return refUrn ? included.find(i => i?.entityUrn === refUrn) : null;
        })() ??
        {};

      const firstName  = profile?.firstName ?? "";
      const lastName   = profile?.lastName  ?? "";
      const fullName   = (profile?.fullName ?? `${firstName} ${lastName}`).trim();
      const headline   = profile?.headline ?? "";
      const bio        = profile?.summary ?? profile?.description ?? "";
      const profileUrn = profile?.entityUrn ?? "";

      // memberId: look for a MiniProfile that has a numeric member URN
      // fsd_profile URN is base64, not numeric — we need urn:li:member:NUMERIC
      let memberId = "";
      const miniProfile =
        included.find(i => i?.$type?.includes("MiniProfile") && i?.entityUrn?.includes(":member:")) ??
        included.find(i => i?.$type?.includes("MiniProfile"));
      if (miniProfile?.entityUrn) {
        const m = miniProfile.entityUrn.match(/:member:(\d+)/);
        if (m) memberId = m[1];
      }
      // fallback: any numeric sequence in the profile URN
      if (!memberId && profileUrn) {
        const m = profileUrn.match(/:(\d{6,})/);
        if (m) memberId = m[1];
      }

      if (!fullName) {
        const types = candidates.map(i => i?.$type).filter(Boolean).join(", ");
        const keys  = candidates.map(i => Object.keys(i ?? {}).join("|")).join(" / ").slice(0, 200);
        throw new Error(`No name found for ${vanityName}. Types=[${types||"none"}] Keys=${keys}`);
      }

      // ── Fetch latest post ─────────────────────────────────────────────────
      let latestPost = "", latestPostUrl = "", activityUrn = "";
      const posts = [];
      const feedLog = []; // debug log visible in background.js console

      // Helper: extract readable post text from any known entity shape
      function extractText(u) {
        if (!u) return "";
        return (
          u?.commentary?.text?.text ??
          (typeof u?.commentary?.text === "string" ? u.commentary.text : null) ??
          u?.value?.["com.linkedin.voyager.feed.render.UpdateV2"]?.commentary?.text?.text ??
          u?.value?.["com.linkedin.voyager.feed.render.UpdateV2Mixin"]?.commentary?.text?.text ??
          u?.content?.text?.text ??
          u?.headerText?.text ??
          ""
        );
      }

      // Helper: strip compound fsd_update wrappers → clean urn:li:activity/ugcPost/share
      // urn:li:fsd_update:(urn:li:activity:XXX,FEED_DETAIL,...) → urn:li:activity:XXX
      function cleanUrn(raw) {
        if (!raw) return "";
        // Already a clean numeric URN
        if (/^urn:li:(activity|ugcPost|share):\d+$/.test(raw)) return raw;
        // Prefer ugcPost/share extracted from compound wrappers
        let m = raw.match(/urn:li:ugcPost:(\d+)/);
        if (m) return `urn:li:ugcPost:${m[1]}`;
        m = raw.match(/urn:li:share:(\d+)/);
        if (m) return `urn:li:share:${m[1]}`;
        m = raw.match(/urn:li:activity:(\d+)/);
        if (m) return `urn:li:activity:${m[1]}`;
        return raw; // unknown shape — leave as-is
      }

      // Helper: extract BOTH the activity URN and the ugcPost/share URN.
      // LinkedIn's official API needs ugcPost URN; Voyager uses activity URN.
      function extractUrns(u) {
        if (!u) return { activityUrn: "", shareUrn: "" };
        let activityUrn = "", shareUrn = "";
        const all = [
          u?.entityUrn,
          u?.updateMetadata?.urn,
          u?.updateMetadata?.updateUrn,
          u?.updateUrn,
        ];
        for (const v of all) {
          if (!v) continue;
          const cleaned = cleanUrn(v);
          if (cleaned.startsWith("urn:li:activity:") && !activityUrn) activityUrn = cleaned;
          if ((cleaned.startsWith("urn:li:ugcPost:") || cleaned.startsWith("urn:li:share:")) && !shareUrn) shareUrn = cleaned;
        }
        return { activityUrn, shareUrn };
      }

      // Helper: push to posts[] if valid — stores both URNs
      function tryAddPost(u) {
        if (!u || posts.length >= 3) return;
        const text = extractText(u);
        const { activityUrn: aUrn, shareUrn } = extractUrns(u);
        const urn = aUrn || shareUrn; // need at least one
        if (text.length > 10 && urn && !posts.some(p => p.activityUrn === urn)) {
          posts.push({
            text,
            activityUrn: urn,
            shareUrn,   // ← ugcPost URN for official LinkedIn API
            url: `https://www.linkedin.com/feed/update/${encodeURIComponent(urn)}`,
          });
        }
      }

      // ── Strategy 1: Voyager API (multiple endpoint variants) ──────────────
      const feedEndpoints = [
        `/feed/updates?profileId=${encodeURIComponent(profileUrn)}&q=memberShareFeed&moduleKey=member-share&count=5`,
        `/identity/dash/profileUpdates?q=memberProfileUpdates&profileUrn=${encodeURIComponent(profileUrn)}&count=5&start=0`,
        `/feed/profile-updates?profileId=${encodeURIComponent(profileUrn)}&q=memberShareFeed&moduleKey=member-share&count=5`,
        ...(memberId ? [`/feed/updates?profileId=${encodeURIComponent("urn:li:member:" + memberId)}&q=memberShareFeed&moduleKey=member-share&count=5`] : []),
      ];

      for (const ep of feedEndpoints) {
        if (posts.length >= 3) break;
        try {
          const r = await get(ep);
          const included = r?.included ?? [];
          const refList  = r?.data?.["*elements"] ?? r?.data?.elements ?? r?.elements ?? [];
          const hasData  = refList.length > 0 || included.length > 0;

          feedLog.push(`${ep.split("?")[0]}: status=OK refs=${refList.length} included=${included.length}`);

          if (!hasData) continue;

          // Resolve URN refs → entities from included[]
          const resolved = refList.map(ref =>
            typeof ref === "string" ? included.find(i => i?.entityUrn === ref) : ref
          ).filter(Boolean);

          // Primary: resolved refs; secondary: all included entities
          const pool = resolved.length > 0 ? resolved : included;
          for (const u of pool) tryAddPost(u);

        } catch (e) {
          feedLog.push(`${ep.split("?")[0]}: ERROR=${e.message.slice(0, 120)}`);
        }
      }

      // ── Strategy 2: DOM extraction (reads LinkedIn's pre-loaded page data) ─
      // LinkedIn embeds Voyager API responses in <code id="bpr-guid-*"> elements.
      // This works if the tab is already on the person's profile page.
      if (posts.length === 0) {
        try {
          const codeEls = document.querySelectorAll('code[id^="bpr-guid-"]');
          let domHits = 0;
          for (const el of codeEls) {
            if (posts.length >= 3) break;
            const raw = el.textContent || "";
            if (!raw.includes("commentary")) continue; // skip non-post blobs
            let parsed;
            try { parsed = JSON.parse(raw); } catch { continue; }
            const included = parsed?.included ?? parsed?.data?.included ?? [];
            for (const u of included) tryAddPost(u);
            if (posts.length > 0) domHits++;
          }
          feedLog.push(`DOM extraction: found ${posts.length} posts from ${domHits} blobs`);
        } catch (e) {
          feedLog.push(`DOM extraction: ERROR=${e.message}`);
        }
      }

      console.log("[scrape] Feed log for", vanityName, feedLog);

      // Populate legacy single-post fields from first post
      if (posts.length > 0) {
        latestPost    = posts[0].text;
        activityUrn   = posts[0].activityUrn;
        latestPostUrl = posts[0].url;
      }

      return { data: { fullName, headline, bio, memberId, profileUrn, latestPost, latestPostUrl, activityUrn, posts } };
    }

    // ── sendConnectionRequest ──────────────────────────────────────────────
    if (fnName === "sendConnectionRequest") {
      const [profileUrn, note] = args;
      const result = await post("/growth/normInvitations", {
        trackingId: generateTrackingId(),
        invitee: {
          "com.linkedin.voyager.growth.invitation.InviteeProfile": { profileId: profileUrn },
        },
        ...(note?.trim() ? { customMessage: note.trim().slice(0, 300) } : {}),
      });
      return { data: result };
    }

    // ── postComment ────────────────────────────────────────────────────────
    if (fnName === "postComment") {
      const [rawActivityUrn, rawObjectUrnArg, myUrn, commentText] = args;

      // Normalize — strip compound fsd_update wrappers before anything else
      const activityUrn = cleanUrn(rawActivityUrn);
      const objectUrnArg = cleanUrn(rawObjectUrnArg);

      console.log("[postComment] actor:", myUrn);
      console.log("[postComment] activityUrn (cleaned):", activityUrn, "raw:", rawActivityUrn);
      console.log("[postComment] objectUrnArg (cleaned):", objectUrnArg);
      console.log("[postComment] text:", commentText?.slice(0, 80));

      if (!myUrn) throw new Error("getMyProfile returned empty URN — cannot post comment");
      if (!activityUrn && !objectUrnArg) throw new Error("post URN is empty — re-scrape this lead");

      const commentMsg = { text: commentText.trim(), attributes: [] };

      // Build an ordered list of URNs to try, best-first.
      // /feed/socialActions/ REQUIRES a ugcPost/share URN — activity URNs return 404.
      // LinkedIn activity URNs and ugcPost URNs share the same numeric suffix,
      // so we can derive the ugcPost URN cheaply by replacing the type prefix.
      const urnsToTry = [];

      // Helper to add only if not already in list
      const addUrn = (u) => { if (u && !urnsToTry.includes(u)) urnsToTry.push(u); };

      // 1. If objectUrnArg is already a ugcPost/share URN, use it first (best case)
      if (objectUrnArg && (objectUrnArg.startsWith("urn:li:ugcPost:") || objectUrnArg.startsWith("urn:li:share:"))) {
        addUrn(objectUrnArg);
      }

      // 2. Try to resolve the canonical ugcPost URN from the activity via the API
      if (activityUrn && activityUrn.startsWith("urn:li:activity:")) {
        try {
          const updateData = await get(`/feed/updates/${activityUrn}`);
          const inc = updateData?.included ?? [];
          const found = inc.map(i =>
            cleanUrn(i?.updateMetadata?.updateUrn ?? i?.updateMetadata?.urn ?? i?.entityUrn ?? "")
          ).find(v => v.startsWith("urn:li:ugcPost:") || v.startsWith("urn:li:share:"));
          if (found) {
            addUrn(found);
            console.log("[postComment] resolved ugcPost URN via API:", found);
          }
        } catch (_) { /* continue with derived URN */ }

        // 3. Derive ugcPost URN — activity and ugcPost share the same numeric ID
        //    urn:li:activity:7455624511774699520 → urn:li:ugcPost:7455624511774699520
        addUrn(activityUrn.replace("urn:li:activity:", "urn:li:ugcPost:"));
      }

      // 4. objectUrnArg as-is (even if it's an activity URN)
      addUrn(objectUrnArg);

      // 5. Raw activity URN as last resort
      addUrn(activityUrn);

      console.log("[postComment] URNs to try:", urnsToTry);
      const failures = [];

      for (const urn of urnsToTry) {
        // Try literal URN first (LinkedIn router usually wants literal colons in path)
        try {
          const result = await post(`/feed/socialActions/${urn}/comments`, {
            actor: myUrn, message: commentMsg,
          });
          console.log("[postComment] socialActions(literal) OK with:", urn.slice(-30));
          return { data: result };
        } catch (e) {
          failures.push(`socialActions-lit(${urn.slice(-20)}):${e.message.slice(0, 200)}`);
        }

        // Try URL-encoded URN
        try {
          const result = await post(`/feed/socialActions/${encodeURIComponent(urn)}/comments`, {
            actor: myUrn, message: commentMsg,
          });
          console.log("[postComment] socialActions(encoded) OK with:", urn.slice(-30));
          return { data: result };
        } catch (e) {
          failures.push(`socialActions-enc(${urn.slice(-20)}):${e.message.slice(0, 200)}`);
        }
      }

      // Final fallback: /feed/comments with the best URN (ugcPost preferred)
      const bestUrn = urnsToTry[0] ?? activityUrn;
      try {
        const result = await post("/feed/comments", {
          actor: myUrn, object: bestUrn, message: commentMsg, commentV2: commentMsg,
        });
        console.log("[postComment] /feed/comments OK with:", bestUrn.slice(-30));
        return { data: result };
      } catch (e) {
        failures.push(`/feed/comments:${e.message.slice(0, 60)}`);
      }

      console.error("[postComment] all strategies failed:", failures.join(" | "));
      throw new Error(failures.slice(0, 4).join(" | "));
    }

    // ── getMyProfile ───────────────────────────────────────────────────────
    if (fnName === "getMyProfile") {
      // Strategy 1: use the dash/profiles "me" lookup — same endpoint as scrapeProfile
      // but with the authenticated user's own vanity name substituted by "me".
      // This reliably returns the fsd_profile URN needed as the comment actor.
      try {
        const meRaw = await get("/identity/dash/profiles?q=memberIdentity&memberIdentity=me");
        const meIncluded = meRaw?.included ?? [];
        const meProfile = meIncluded.find(i => i?.entityUrn?.includes("fsd_profile") && i?.firstName);
        if (meProfile?.entityUrn) {
          console.log("[getMyProfile] dash/profiles URN:", meProfile.entityUrn);
          return { data: meProfile.entityUrn };
        }
      } catch (_) {}

      // Strategy 2: /me endpoint — extract fsd_profile from included
      try {
        const raw = await get("/me");
        const included = raw?.included ?? [];

        const fsdProfile = included.find(i =>
          i?.entityUrn?.includes("fsd_profile") && (i?.firstName || i?.lastName)
        );
        if (fsdProfile?.entityUrn) {
          console.log("[getMyProfile] /me fsd_profile URN:", fsdProfile.entityUrn);
          return { data: fsdProfile.entityUrn };
        }

        // MiniProfile URN: urn:li:fs_miniProfile:ACoXXX → convert to urn:li:fsd_profile:ACoXXX
        // Both use the same base64 ACoXXX suffix, just different type prefixes.
        const mini = included.find(i =>
          i?.$type?.includes("MiniProfile") || (i?.firstName && i?.entityUrn)
        );
        if (mini?.entityUrn) {
          const converted = mini.entityUrn.includes("fsd_profile")
            ? mini.entityUrn
            : mini.entityUrn.replace(/^urn:li:[^:]+:/, "urn:li:fsd_profile:");
          console.log("[getMyProfile] Converted MiniProfile URN:", converted);
          return { data: converted };
        }

        const fallback = raw?.data?.entityUrn ?? "";
        console.warn("[getMyProfile] fallback entityUrn:", fallback);
        return { data: fallback };
      } catch (e) {
        throw new Error(`getMyProfile failed: ${e.message}`);
      }
    }

    // ── searchPeople ───────────────────────────────────────────────────────
    // args: [keywordsFilter, start, count, titleFilter, networkCodes,
    //        companySizes, excludeFilter, csrfToken]
    if (fnName === "searchPeople") {
      const [
        query,          // keywords (supports LinkedIn boolean AND/OR/NOT)
        start,
        count,
        titleFilter,    // maps to currentTitle in Voyager filter
        networkCodes,   // ["F","S"] — connection degree
        companySizes,   // ["B","C"] — company size codes
        excludeFilter,  // comma-separated terms to exclude client-side
      ] = args;
      const wantCount = count ?? 30;

      // ── Shared helpers ────────────────────────────────────────────────────
      function parseImageUrl(picture) {
        if (!picture) return "";
        const rootUrl   = picture.rootUrl ?? picture.displayImage ?? "";
        const artifacts = picture.artifacts ?? [];
        if (!rootUrl || !artifacts.length) return rootUrl;
        const best = artifacts.reduce((a, b) => ((a.width ?? 0) >= (b.width ?? 0) ? a : b));
        return rootUrl + (best.fileIdentifyingUrlPathSegment ?? "");
      }

      function parseDegree(nd) {
        if (!nd) return "3rd+";
        const v = String(nd.value ?? nd.distance ?? nd ?? "");
        if (v.includes("FIRST")  || v === "DISTANCE_1" || v === "1") return "1st";
        if (v.includes("SECOND") || v === "DISTANCE_2" || v === "2") return "2nd";
        return "3rd+";
      }

      function pushProfile(list, mini, degree) {
        if (!mini?.firstName) return;
        const fullName   = `${mini.firstName} ${mini.lastName ?? ""}`.trim();
        const profileUrn = mini.entityUrn ?? "";
        if (!fullName || !profileUrn || list.some(p => p.profileUrn === profileUrn)) return;
        const publicId = mini.publicIdentifier ?? "";
        list.push({
          fullName,
          headline:         mini.occupation ?? mini.headline ?? "",
          profileUrl:       publicId ? `https://www.linkedin.com/in/${publicId}/` : "",
          profileUrn,
          profileImageUrl:  parseImageUrl(mini.picture ?? mini.profilePicture),
          connectionDegree: degree,
        });
      }

      // ── Build keyword string ──────────────────────────────────────────────
      // Rules (LinkedIn help/answer/a524335): AND, OR, NOT uppercase; "quotes" for exact.
      // IMPORTANT: Do NOT put NOT/exclusion terms here — they make the keyword
      // search so narrow it returns 0. Exclusions are applied client-side.
      // Title goes into keywords so LinkedIn searches for it across the profile.
      const kwParts = [];
      if (titleFilter?.trim()) kwParts.push(titleFilter.trim()); // e.g. "Founder"
      if (query?.trim())       kwParts.push(query.trim());       // e.g. "Clothing"
      const keywordsString = kwParts.join(" AND ") || "";
      // Exclusion terms (applied client-side after results arrive, NOT sent to API)
      const excludeTerms = (excludeFilter ?? "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);

      // ── API filter string ─────────────────────────────────────────────────
      // ONLY include filter keys that LinkedIn's /search/blended actually accepts.
      // Wrong keys return HTTP 400 and kill ALL results.
      // Confirmed working: resultType, network
      // NOT working in this endpoint: companySize (causes 400) — omitted
      const filterParts = ["resultType->(PEOPLE)"];
      if (Array.isArray(networkCodes) && networkCodes.length > 0) {
        filterParts.push(`network->(${networkCodes.join(",")})`);
      }
      const filtersParam = `List(${filterParts.join(",")})`;

      let profiles = [];
      let total = 0, hasMore = false;
      const debugLog = [`kw="${keywordsString}" filters="${filtersParam}"`];

      // ── Strategy 1: /search/blended (Voyager REST API) ───────────────────
      try {
        const url =
          `https://www.linkedin.com/voyager/api/search/blended` +
          `?count=${wantCount}` +
          `&filters=${filtersParam}` +
          `&keywords=${encodeURIComponent(keywordsString)}` +
          `&origin=GLOBAL_SEARCH_HEADER` +
          `&q=all` +
          `&queryContext=List(spellCorrectionEnabled->true,relatedSearchesEnabled->true)` +
          `&start=${start ?? 0}`;

        const res = await fetch(url, { credentials: "include", headers: buildHeaders(csrfToken) });
        debugLog.push(`blended_status=${res.status}`);
        if (res.status === 429) throw new Error("rate_limited");
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          throw new Error(`blended_${res.status}: ${errText.slice(0, 100)}`);
        }

        const d = await res.json();

        const paging = d?.data?.paging ?? d?.paging ?? {};
        total   = paging.total ?? 0;
        hasMore = (Number(paging.start ?? start ?? 0) + Number(paging.count ?? wantCount)) < total;
        debugLog.push(`paging_total=${total}`);

        const clusters = d?.data?.elements ?? d?.elements ?? [];
        const degreeMap = new Map();
        debugLog.push(`clusters=${clusters.length} included=${(d?.included ?? []).length}`);

        for (const cluster of clusters) {
          for (const hit of (cluster?.elements ?? [])) {
            const sp = hit?.hitInfo?.["com.linkedin.voyager.search.SearchProfile"];
            if (!sp?.miniProfile) continue;
            const degree = parseDegree(sp.networkDistance);
            degreeMap.set(sp.miniProfile.entityUrn, degree);
            pushProfile(profiles, sp.miniProfile, degree);
          }
        }

        const included = d?.included ?? [];
        for (const item of included) {
          if (!item?.firstName || !item?.publicIdentifier) continue;
          const degree = degreeMap.get(item.entityUrn) ?? parseDegree(item.networkDistance);
          pushProfile(profiles, item, degree);
        }

        debugLog.push(`blended_profiles=${profiles.length}`);
      } catch (blendedErr) {
        if (blendedErr.message === "rate_limited") throw blendedErr;
        debugLog.push(`blended_err=${blendedErr.message.slice(0, 80)}`);
      }

      // ── Strategy 2: GraphQL (fallback if blended returned nothing) ───────
      if (profiles.length === 0) {
        try {
          const qParams = [`(key:resultType,value:List(PEOPLE))`];
          if (Array.isArray(networkCodes) && networkCodes.length > 0) {
            qParams.push(`(key:network,value:List(${networkCodes.join(",")}))`);
          }

          const variables =
            `(start:${start ?? 0},origin:GLOBAL_SEARCH_HEADER,` +
            `query:(keywords:${JSON.stringify(keywordsString)},flagshipSearchIntent:SEARCH_SRP,` +
            `queryParameters:List(${qParams.join(",")}),includeFiltersInResponse:false))`;

          const gqlRes = await fetch(
            `https://www.linkedin.com/voyager/api/graphql` +
            `?variables=${encodeURIComponent(variables)}` +
            `&queryId=voyagerSearchDashClusters.866b5dc4e4ddf0c40701dd0b2b25e5df`,
            { credentials: "include", headers: buildHeaders(csrfToken) }
          );

          debugLog.push(`graphql_status=${gqlRes.status}`);
          if (gqlRes.ok) {
            const gql      = await gqlRes.json();
            const included = gql?.included ?? [];
            debugLog.push(`graphql_included=${included.length}`);
            for (const item of included) {
              if (item?.firstName && item?.publicIdentifier) {
                pushProfile(profiles, item, parseDegree(item.networkDistance));
              }
            }
            if (!total) total = profiles.length;
            debugLog.push(`graphql_profiles=${profiles.length}`);
          }
        } catch (gqlErr) {
          debugLog.push(`graphql_err=${gqlErr.message.slice(0, 60)}`);
        }
      }

      // ── Client-side title filter ──────────────────────────────────────────
      // Verify headline contains the title keyword. Empty headlines pass through.
      if (titleFilter?.trim()) {
        const tl = titleFilter.trim().toLowerCase();
        const before = profiles.length;
        profiles = profiles.filter(p =>
          !p.headline.trim() || p.headline.toLowerCase().includes(tl)
        );
        debugLog.push(`title_filter="${titleFilter}" kept=${profiles.length}/${before}`);
      }

      // ── Client-side exclude filter ────────────────────────────────────────
      if (excludeTerms.length > 0) {
        const before = profiles.length;
        profiles = profiles.filter(p => {
          const hay = `${p.fullName} ${p.headline}`.toLowerCase();
          return !excludeTerms.some(t => hay.includes(t));
        });
        debugLog.push(`exclude_filter kept=${profiles.length}/${before}`);
      }

      return { data: { profiles, total: profiles.length, hasMore, debug: debugLog } };
    }

    // ── getRelatedProfiles ("People Also Viewed" organic fallback) ─────────
    // Called when /search/blended is rate-limited.
    // Extracts sidebar profiles from a standard profile page via Voyager API
    // or from LinkedIn's embedded <code id="bpr-*"> JSON blobs.
    if (fnName === "getRelatedProfiles") {
      function parseImageUrl(picture) {
        if (!picture) return "";
        const rootUrl   = picture.rootUrl ?? "";
        const artifacts = picture.artifacts ?? [];
        if (!rootUrl || !artifacts.length) return "";
        const best = artifacts.reduce((a, b) => ((a.width ?? 0) >= (b.width ?? 0) ? a : b));
        return rootUrl + (best.fileIdentifyingUrlPathSegment ?? "");
      }

      const profiles = [];

      function pushMini(mini) {
        if (!mini?.firstName) return;
        const fullName   = `${mini.firstName} ${mini.lastName ?? ""}`.trim();
        const profileUrn = mini.entityUrn ?? "";
        if (!fullName || !profileUrn || profiles.some(p => p.profileUrn === profileUrn)) return;
        const publicId = mini.publicIdentifier ?? "";
        profiles.push({
          fullName,
          headline:        mini.occupation ?? mini.headline ?? "",
          profileUrl:      publicId ? `https://www.linkedin.com/in/${publicId}/` : "",
          profileUrn,
          profileImageUrl: parseImageUrl(mini.picture),
          connectionDegree: "2nd",   // related profiles are typically 2nd-degree
        });
      }

      // Strategy A: Voyager relatedProfiles API
      try {
        const r = await fetch(
          "https://www.linkedin.com/voyager/api/identity/profiles/me/relatedProfiles?count=20",
          { credentials: "include", headers: buildHeaders(csrfToken) }
        );
        if (r.ok) {
          const d = await r.json();
          (d?.included ?? d?.elements ?? [])
            .filter(i => i?.firstName)
            .forEach(pushMini);
        }
      } catch (_) {}

      // Strategy B: DOM — LinkedIn's embedded JSON blobs contain sidebar MiniProfiles
      if (profiles.length < 5) {
        const codeEls = document.querySelectorAll("code[id]");
        for (const el of codeEls) {
          if (profiles.length >= 20) break;
          const raw = el.textContent ?? "";
          if (!raw.includes("miniProfile") && !raw.includes("firstName")) continue;
          let blob; try { blob = JSON.parse(raw); } catch { continue; }
          (blob?.included ?? [])
            .filter(i => i?.$type?.includes("MiniProfile") && i?.firstName)
            .forEach(pushMini);
        }
      }

      return { data: { profiles } };
    }

    return { error: `Unknown function: ${fnName}` };
  } catch (e) {
    return { error: e.message };
  }
}

// ─── Tab helpers ──────────────────────────────────────────────────────────────

async function getOrCreateLinkedInTab() {
  // Search both www and non-www LinkedIn (LinkedIn sometimes redirects to linkedin.com)
  const [wwwTabs, noWwwTabs] = await Promise.all([
    chrome.tabs.query({ url: "https://www.linkedin.com/*" }),
    chrome.tabs.query({ url: "https://linkedin.com/*"     }),
  ]);
  const existing = [...wwwTabs, ...noWwwTabs][0];
  if (existing) {
    // Make the tab active so Chrome grants the activeTab permission for injection.
    // Without this, injecting into a background tab can fail with a host-access
    // error even when the URL matches host_permissions.
    await chrome.tabs.update(existing.id, { active: true });
    // Brief pause to let Chrome register the active-tab grant.
    await new Promise(r => setTimeout(r, 150));
    return existing;
  }

  // No LinkedIn tab found — open the feed and make it active.
  const tab = await chrome.tabs.create({
    url:    "https://www.linkedin.com/feed/",
    active: true,   // must be active for activeTab grant to apply
  });

  await waitForTabLoad(tab.id);
  // Extra buffer for LinkedIn's SPA hydration
  await new Promise(r => setTimeout(r, 1500));
  return tab;
}

function waitForTabLoad(tabId) {
  // MV3 service workers must NOT rely on long setTimeout calls — the worker can
  // be suspended mid-wait and the timer never fires.  Instead we use the Chrome
  // event API (onUpdated) which keeps the service worker alive, plus an alarm-
  // based safety timeout via chrome.alarms.  For simplicity we poll with a short
  // recursive setTimeout (250ms) which Chrome keeps alive because an event is
  // outstanding, with a 20-second hard cap.
  return new Promise((resolve) => {
    const deadline = Date.now() + 20_000;

    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);

    // Fallback: check directly in case the "complete" event already fired
    // before we attached the listener, and poll until deadline.
    function checkDone() {
      if (Date.now() > deadline) {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
        return;
      }
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) { resolve(); return; } // tab was closed
        if (tab?.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        } else {
          setTimeout(checkDone, 250);
        }
      });
    }
    setTimeout(checkDone, 250);
  });
}

// ─── Status helpers ───────────────────────────────────────────────────────────

async function postCommentFromLinkedInPage(commentText) {
  const sleep   = ms => new Promise(r => setTimeout(r, ms));
  const visible = el => {
    const r = el?.getBoundingClientRect?.();
    return r && r.width > 0 && r.height > 0;
  };
  const waitFor = async (finder, timeout = 20000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const found = finder();
      if (found) return found;
      await sleep(400);
    }
    return null;
  };

  try {
    // ── 1. Wait for the post card to be visible ──────────────────────────
    // The feed/update/ page is a SPA — main article loads after JS hydration.
    await waitFor(() => document.querySelector(".feed-shared-update-v2, article, [data-urn]"), 15000);
    window.scrollTo({ top: 300, behavior: "smooth" }); // scroll past sticky nav
    await sleep(1200);

    // ── 2. Open the comment box ──────────────────────────────────────────
    // LinkedIn renders a "Start a comment…" placeholder button OR the full
    // contenteditable is already open on detail pages.
    const openCommentBox = async () => {
      // Check if editor is already open
      const existing = [...document.querySelectorAll('[contenteditable="true"]')]
        .filter(visible)
        .find(el => {
          const label = (el.getAttribute("aria-label") || el.getAttribute("data-placeholder") || "").toLowerCase();
          return label.includes("comment") || !!el.closest(".comments-comment-box, .comments-comment-texteditor, .comments-comment-box__form");
        });
      if (existing) return existing;

      // Find and click the "Comment" action button to open the editor
      const commentBtn = [...document.querySelectorAll("button")]
        .filter(visible)
        .find(btn => {
          const label = (btn.getAttribute("aria-label") || btn.innerText || "").toLowerCase().trim();
          // Match "Comment" button but not "X comments" count links
          return (label === "comment" || label.startsWith("comment ") || label === "add a comment")
              && !label.includes("comments on") && !label.includes("view");
        });

      if (!commentBtn) {
        // Fallback: look for the placeholder div LinkedIn uses sometimes
        const placeholder = [...document.querySelectorAll('[data-placeholder*="comment" i], [placeholder*="comment" i]')]
          .filter(visible)[0];
        if (placeholder) { placeholder.click(); await sleep(800); }
        return null;
      }

      commentBtn.click();
      await sleep(1000);
      return null; // will be re-found on next waitFor tick
    };

    // First attempt to open, then wait for the editor to appear
    await openCommentBox();
    const editor = await waitFor(async () => {
      await openCommentBox();
      return [...document.querySelectorAll('[contenteditable="true"]')]
        .filter(visible)
        .find(el => {
          const label = (el.getAttribute("aria-label") || el.getAttribute("data-placeholder") || "").toLowerCase();
          return label.includes("comment") || !!el.closest(".comments-comment-box, .comments-comment-texteditor, .comments-comment-box__form");
        });
    }, 15000);

    if (!editor) throw new Error("Comment editor did not open — could not find contenteditable[aria-label*=comment]");

    // ── 3. Type the comment text ─────────────────────────────────────────
    editor.focus();
    await sleep(300);

    // Clear any existing text
    document.execCommand("selectAll", false, null);
    document.execCommand("delete", false, null);
    await sleep(200);

    // Insert the comment text
    document.execCommand("insertText", false, commentText.trim());

    // Fire input events so LinkedIn's React state picks up the change
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: commentText.trim() }));
    editor.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(800);

    // ── 4. Find and click the Post / Submit button ───────────────────────
    // The submit button is INSIDE the comment editor container.
    const submitButton = await waitFor(() => {
      const container = editor.closest(
        ".comments-comment-box, .comments-comment-texteditor, .comments-comment-box__form, form"
      ) ?? document;

      return [...container.querySelectorAll("button")]
        .filter(visible)
        .find(btn => {
          if (btn.disabled) return false;
          const label = (btn.getAttribute("aria-label") || btn.innerText || "").toLowerCase().trim();
          return label === "post" || label === "post comment" || label === "submit" ||
                 label.includes("post comment") || (label.includes("post") && !label.includes("post a job"));
        });
    }, 10000);

    if (!submitButton) throw new Error("Post/Submit button not found or still disabled — was text inserted?");

    submitButton.click();
    await sleep(3000); // wait for the network request to complete

    // Verify the comment appeared (optional — look for our text in the DOM)
    const appeared = [...document.querySelectorAll(".comments-comment-item__main-content, .feed-shared-text")]
      .some(el => el.textContent?.includes(commentText.trim().slice(0, 30)));

    console.log("[postCommentFromLinkedInPage] comment submitted, appeared in DOM:", appeared);
    return { ok: true, appeared };
  } catch (e) {
    console.error("[postCommentFromLinkedInPage] error:", e.message);
    return { error: e.message };
  }
}

async function setStatus(text) {
  await chrome.storage.local.set({ status: text, statusAt: Date.now() });
}
