/**
 * lib/linkedin-api.ts
 * Server-side helpers for the official LinkedIn REST API (v2).
 * These use an OAuth Bearer token — no browser cookies required.
 */

const LI_BASE = "https://api.linkedin.com/v2";

function apiHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "X-Restli-Protocol-Version": "2.0.0",
  };
}

/**
 * Post a comment on a LinkedIn activity via the official API.
 * activityUrn e.g. "urn:li:activity:7455262119505158144"
 * memberId    e.g. "ACoXXX..." (the `sub` from OpenID Connect / userinfo)
 */
export async function postCommentOfficial(
  accessToken: string,
  memberId: string,
  postUrn: string,       // should be urn:li:ugcPost:XXX or urn:li:share:XXX
  commentText: string
): Promise<void> {
  // The official API requires a ugcPost or share URN — NOT an activity URN.
  // activity URNs come from Voyager; ugcPost URNs are the real content identifiers.
  if (postUrn.includes("urn:li:activity:")) {
    throw new Error(
      `Cannot post comment: URN "${postUrn}" is an activity URN. ` +
      "Re-scrape this lead so the extension captures the ugcPost URN needed for the official API."
    );
  }

  const encodedUrn = encodeURIComponent(postUrn);
  const url = `${LI_BASE}/socialActions/${encodedUrn}/comments`;

  console.log("[linkedin-api] postComment url:", url);
  console.log("[linkedin-api] actor:", `urn:li:person:${memberId}`);

  const res = await fetch(url, {
    method: "POST",
    headers: apiHeaders(accessToken),
    body: JSON.stringify({
      actor: `urn:li:person:${memberId}`,
      message: { text: commentText.trim() },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LinkedIn API ${res.status}: ${body.slice(0, 300)}`);
  }
}

/**
 * Send a connection request via the official API.
 * profileUrn should be "urn:li:fsd_profile:ACoXXX..."
 * note is optional (max 300 chars)
 */
export async function sendConnectionOfficial(
  accessToken: string,
  memberId: string,
  profileUrn: string,
  note?: string
): Promise<void> {
  const url = `${LI_BASE}/invitations`;

  const body: Record<string, unknown> = {
    invitee: {
      "com.linkedin.voyager.growth.invitation.InviteeProfile": {
        profileId: profileUrn,
      },
    },
    ...(note?.trim() ? { message: note.trim().slice(0, 300) } : {}),
  };

  const res = await fetch(url, {
    method: "POST",
    headers: apiHeaders(accessToken),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`LinkedIn API ${res.status}: ${errBody.slice(0, 300)}`);
  }
}

/**
 * Fetch the authenticated member's profile ID from LinkedIn's userinfo endpoint.
 * Returns the `sub` claim — used as urn:li:person:{sub} in API calls.
 */
export async function getLinkedInMemberId(accessToken: string): Promise<string> {
  const res = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`userinfo ${res.status}`);
  const data = await res.json();
  return data.sub as string;
}

/**
 * Create a text post on LinkedIn via the official UGC Posts API.
 * Returns the URN of the newly created post (e.g. "urn:li:ugcPost:XXX").
 */
export async function publishPost(
  accessToken: string,
  memberId: string,
  content: string
): Promise<string> {
  const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: apiHeaders(accessToken),
    body: JSON.stringify({
      author: `urn:li:person:${memberId}`,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: content.trim() },
          shareMediaCategory: "NONE",
        },
      },
      visibility: {
        "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LinkedIn API ${res.status}: ${body.slice(0, 300)}`);
  }

  // LinkedIn returns the new post URN in the X-RestLi-Id response header
  return res.headers.get("x-restli-id") ?? res.headers.get("X-RestLi-Id") ?? "";
}

/**
 * Fetch basic share statistics for a ugcPost URN.
 * Returns impressions + engagement counts.
 */
export async function fetchPostStats(
  accessToken: string,
  postUrn: string
): Promise<{ impressions: number; clicks: number; reactions: number; comments: number; shares: number }> {
  const encoded = encodeURIComponent(postUrn);
  const url = `https://api.linkedin.com/v2/socialMetadata/${encoded}`;

  const res = await fetch(url, { headers: apiHeaders(accessToken) });

  if (!res.ok) return { impressions: 0, clicks: 0, reactions: 0, comments: 0, shares: 0 };

  const data = await res.json();
  const s = data?.totalShareStatistics ?? data ?? {};
  return {
    impressions: s.impressionCount  ?? 0,
    clicks:      s.clickCount       ?? 0,
    reactions:   s.likeCount        ?? 0,
    comments:    s.commentCount     ?? 0,
    shares:      s.shareCount       ?? 0,
  };
}

export interface LinkedInPost {
  postUrn:     string;
  postUrl:     string;
  content:     string;
  createdAt:   number; // epoch ms
}

/**
 * Fetch the signed-in user's most recent posts via the versioned LinkedIn REST API.
 * Endpoint: GET /rest/posts?q=author&author=urn:li:person:{memberId}
 * Requires: w_member_social (works for reading your own posts with the versioned API).
 *
 * Falls back to the legacy /v2/ugcPosts endpoint if the versioned call fails.
 * Throws if both fail — caller should handle by falling back to local DB records.
 */
export async function getMyRecentPosts(
  accessToken: string,
  memberId:    string,
  count = 15
): Promise<LinkedInPost[]> {
  const authorUrn = `urn:li:person:${memberId}`;

  // ── Strategy 1: versioned /rest/posts (LinkedIn API 2023+) ──────────────────
  // This endpoint works with w_member_social for the authenticated user's own posts.
  const versionedUrl =
    `https://api.linkedin.com/rest/posts` +
    `?q=author&author=${encodeURIComponent(authorUrn)}` +
    `&count=${count}&sortBy=LAST_MODIFIED`;

  const vRes = await fetch(versionedUrl, {
    headers: {
      Authorization:                  `Bearer ${accessToken}`,
      "LinkedIn-Version":             "202401",
      "X-Restli-Protocol-Version":    "2.0.0",
    },
  });

  if (vRes.ok) {
    const data = await vRes.json();
    return parsePostElements(data?.elements ?? []);
  }

  // ── Strategy 2: legacy /v2/ugcPosts (requires r_ugcpost — will 403 without it) ─
  const legacyUrl =
    `${LI_BASE}/ugcPosts?q=authors` +
    `&authors=List(${encodeURIComponent(authorUrn)})` +
    `&count=${count}&sortBy=LAST_MODIFIED`;

  const lRes = await fetch(legacyUrl, {
    headers: { ...apiHeaders(accessToken), "LinkedIn-Version": "202304" },
  });

  if (lRes.ok) {
    const data = await lRes.json();
    return parsePostElements(data?.elements ?? []);
  }

  // Both failed — surface the versioned-API error
  const errBody = await vRes.text().catch(() => "(unreadable)");
  throw new Error(
    `LinkedIn post-list API returned ${vRes.status}. ` +
    `Your OAuth token may not have the required scope to list posts. ` +
    `Raw: ${errBody.slice(0, 200)}`
  );
}

function parsePostElements(elements: Record<string, unknown>[]): LinkedInPost[] {
  return elements.map((el: any) => {
    // versioned API uses "id", legacy uses "id" too
    const urn: string = el.id ?? el.ugcPostUrn ?? "";
    const postUrl = `https://www.linkedin.com/feed/update/${encodeURIComponent(urn)}/`;

    // versioned API: commentary field; legacy: specificContent.*.shareCommentary.text
    const content: string =
      el.commentary ??
      el?.specificContent?.["com.linkedin.ugc.ShareContent"]?.shareCommentary?.text ??
      "";

    const createdAt: number =
      el.publishedAt ??
      el.firstPublishedAt ??
      el?.created?.time ??
      Date.now();

    return { postUrn: urn, postUrl, content, createdAt };
  });
}

/**
 * Fetch social-action counts for a single ugcPost/share URN.
 * Tries /v2/socialActions first; falls back to /v2/socialMetadata.
 */
export async function getPostSocialStats(
  accessToken: string,
  postUrn: string
): Promise<{ impressions: number; clicks: number; reactions: number; comments: number; shares: number }> {
  const encoded = encodeURIComponent(postUrn);

  // Primary: socialActions endpoint (gives likes, comments, reposts)
  const actionsRes = await fetch(
    `${LI_BASE}/socialActions/${encoded}`,
    { headers: apiHeaders(accessToken) }
  );

  let reactions = 0, comments = 0, shares = 0;
  if (actionsRes.ok) {
    const d = await actionsRes.json();
    reactions = d?.likesSummary?.totalLikes   ?? d?.likes?.paging?.total    ?? 0;
    comments  = d?.commentsSummary?.totalFirstLevelComments ??
                d?.comments?.paging?.total   ?? 0;
    shares    = d?.sharesSummary?.totalShares ?? d?.reposts?.paging?.total  ?? 0;
  }

  // Secondary: socialMetadata for impressions + clicks
  const metaRes = await fetch(
    `${LI_BASE}/socialMetadata/${encoded}`,
    { headers: apiHeaders(accessToken) }
  );

  let impressions = 0, clicks = 0;
  if (metaRes.ok) {
    const m = await metaRes.json();
    const s  = m?.totalShareStatistics ?? m ?? {};
    impressions = s.impressionCount ?? 0;
    clicks      = s.clickCount      ?? 0;
    // Use API counts if our socialActions call failed
    if (!actionsRes.ok) {
      reactions = s.likeCount    ?? 0;
      comments  = s.commentCount ?? 0;
      shares    = s.shareCount   ?? 0;
    }
  }

  return { impressions, clicks, reactions, comments, shares };
}
