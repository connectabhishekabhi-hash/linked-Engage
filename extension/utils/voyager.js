/**
 * voyager.js — LinkedIn Voyager API fetch functions
 *
 * Uses `credentials: "include"` so the browser attaches li_at + JSESSIONID
 * automatically — identical to a real LinkedIn browser session.
 */

import { buildVoyagerHeaders } from "./auth.js";

const BASE = "https://www.linkedin.com/voyager/api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateTrackingId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

async function voyagerGet(path, csrfToken) {
  const url = `${BASE}${path}`;
  console.log("[voyager] GET", url);

  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    headers: buildVoyagerHeaders(csrfToken),
  });

  const text = await res.text();
  console.log(`[voyager] ${res.status} — ${text.slice(0, 300)}`);

  if (!res.ok) {
    throw new Error(`Voyager GET ${path} → HTTP ${res.status}: ${text.slice(0, 150)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Voyager GET ${path} → invalid JSON response`);
  }
}

async function voyagerPost(path, csrfToken, body) {
  const url = `${BASE}${path}`;
  console.log("[voyager] POST", url, body);

  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: buildVoyagerHeaders(csrfToken),
    body: JSON.stringify(body),
  });

  const text = await res.text();
  console.log(`[voyager] ${res.status} — ${text.slice(0, 300)}`);

  if (!res.ok) {
    throw new Error(`Voyager POST ${path} → HTTP ${res.status}: ${text.slice(0, 150)}`);
  }

  if (!text) return { status: res.status };
  try { return JSON.parse(text); } catch { return { status: res.status }; }
}

// ─── A) Scrape Profile ────────────────────────────────────────────────────────

/**
 * Try multiple Voyager endpoints — LinkedIn changes APIs frequently.
 * Returns { fullName, headline, bio, memberId, profileUrn, latestPost, latestPostUrl, activityUrn }
 */
export async function scrapeProfile(vanityName, csrfToken) {

  // ── Strategy 1: Basic profile endpoint (most stable) ──────────────────────
  let fullName = "", headline = "", bio = "", memberId = "", profileUrn = "";

  try {
    const data = await voyagerGet(`/identity/profiles/${vanityName}`, csrfToken);

    // Response can be the profile directly OR wrapped in data.data
    const profile = data?.data ?? data;

    fullName   = `${profile?.firstName ?? ""} ${profile?.lastName ?? ""}`.trim();
    headline   = profile?.headline ?? "";
    bio        = profile?.summary  ?? "";
    profileUrn = profile?.entityUrn ?? profile?.miniProfile?.entityUrn ?? "";
    memberId   = profileUrn.split(":").pop() ?? "";

  } catch (e1) {
    console.warn("[voyager] Strategy 1 failed:", e1.message);

    // ── Strategy 2: Dash API (newer LinkedIn layout) ─────────────────────────
    try {
      const data2 = await voyagerGet(
        `/identity/dash/profiles?q=memberIdentity&memberIdentity=${vanityName}&decorationId=com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-91`,
        csrfToken
      );

      const el = data2?.elements?.[0] ?? data2?.data?.elements?.[0];
      if (el) {
        fullName   = el?.fullName ?? `${el?.firstName ?? ""} ${el?.lastName ?? ""}`.trim();
        headline   = el?.headline ?? "";
        bio        = el?.summary  ?? "";
        profileUrn = el?.entityUrn ?? "";
        memberId   = profileUrn.split(":").pop() ?? "";
      }
    } catch (e2) {
      console.warn("[voyager] Strategy 2 failed:", e2.message);
      throw new Error(`Could not fetch profile "${vanityName}". Both Voyager strategies failed. Check your LinkedIn session.`);
    }
  }

  if (!fullName) {
    throw new Error(`Profile "${vanityName}" returned no name — cookie may be expired.`);
  }

  console.log(`[voyager] ✓ Profile: ${fullName} | URN: ${profileUrn}`);

  // ── Fetch activity feed for latest post ───────────────────────────────────
  let latestPost = "", latestPostUrl = "", activityUrn = "";

  try {
    // Use memberId if we have it, otherwise try vanityName-based query
    const feedParam = memberId
      ? `profileId=urn:li:member:${memberId}`
      : `profileId=urn:li:fs_miniProfile:${vanityName}`;

    const feed = await voyagerGet(
      `/feed/updates?${feedParam}&q=memberShareFeed&moduleKey=member-share&count=5`,
      csrfToken
    );

    // Voyager returns updates in data.elements or directly in elements
    const updates = feed?.data?.elements ?? feed?.elements ?? [];

    for (const update of updates) {
      // Handle both old and new Voyager response shapes
      const inner =
        update?.value?.["com.linkedin.voyager.feed.render.UpdateV2"] ??
        update?.value?.["com.linkedin.voyager.feed.render.UpdateV2Mixin"] ??
        update;

      const text =
        inner?.commentary?.text?.text ??
        inner?.commentary?.text ??
        inner?.content?.contentEntities?.[0]?.description ??
        "";

      const urn = update?.updateMetadata?.urn ?? update?.entityUrn ?? "";

      if (text && text.length > 10) {
        latestPost    = text;
        activityUrn   = urn;
        latestPostUrl = urn ? `https://www.linkedin.com/feed/update/${urn}` : "";
        break;
      }
    }

    console.log(`[voyager] Post found: ${latestPost.length} chars`);
  } catch (e) {
    console.warn("[voyager] Activity feed failed (non-fatal):", e.message);
  }

  return { fullName, headline, bio, memberId, profileUrn, latestPost, latestPostUrl, activityUrn };
}

// ─── B) Send Connection Request ───────────────────────────────────────────────

export async function sendConnectionRequest(profileUrn, note, csrfToken) {
  const body = {
    trackingId: generateTrackingId(),
    invitee: {
      "com.linkedin.voyager.growth.invitation.InviteeProfile": {
        profileId: profileUrn,
      },
    },
    ...(note?.trim() ? { customMessage: note.trim().slice(0, 300) } : {}),
  };

  return voyagerPost("/growth/normInvitations", csrfToken, body);
}

// ─── C) Post Comment ─────────────────────────────────────────────────────────

export async function postComment(activityUrn, myProfileUrn, commentText, csrfToken) {
  return voyagerPost("/feed/comments", csrfToken, {
    actor: myProfileUrn,
    object: activityUrn,
    message: { text: commentText.trim() },
  });
}

// ─── D) Get My Profile URN ───────────────────────────────────────────────────

export async function getMyProfile(csrfToken) {
  try {
    const data = await voyagerGet("/me", csrfToken);
    // Try several paths LinkedIn uses for the miniProfile URN
    const urn =
      data?.data?.["*miniProfile"] ??
      data?.included?.find((i) => i?.$type?.includes("MiniProfile"))?.entityUrn ??
      data?.data?.entityUrn ??
      "";
    console.log("[voyager] My URN:", urn);
    return urn;
  } catch (e) {
    console.warn("[voyager] getMyProfile failed:", e.message);
    return "";
  }
}
