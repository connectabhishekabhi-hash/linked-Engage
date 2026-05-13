/**
 * auth.js — Cookie extraction utilities
 * Reads li_at and JSESSIONID from the user's active LinkedIn session.
 * The JSESSIONID value (e.g. "ajax:1234567890123456") is used directly
 * as the csrf-token header on every Voyager request.
 */

/**
 * Get all LinkedIn auth cookies needed for Voyager requests.
 * @returns {{ liAt: string, csrfToken: string } | null}
 */
export async function getLinkedInAuth() {
  const cookies = await chrome.cookies.getAll({ domain: ".linkedin.com" });

  const liAt = cookies.find((c) => c.name === "li_at")?.value ?? null;
  // JSESSIONID looks like: ajax:XXXXXXXXXXXXXXXX
  const jsessionid = cookies.find((c) => c.name === "JSESSIONID")?.value ?? null;

  if (!liAt || !jsessionid) {
    console.warn("[auth] Missing LinkedIn cookies — user may not be logged in.");
    return null;
  }

  // Strip surrounding quotes if present (Chrome sometimes wraps them)
  const csrfToken = jsessionid.replace(/^"|"$/g, "");

  return { liAt, csrfToken };
}

/**
 * Build the standard headers required by every LinkedIn Voyager API call.
 * @param {string} csrfToken — the raw JSESSIONID value
 * @returns {HeadersInit}
 */
export function buildVoyagerHeaders(csrfToken) {
  return {
    "accept": "application/vnd.linkedin.normalized+json+2.1",
    "accept-language": "en-US,en;q=0.9",
    "content-type": "application/json",
    "csrf-token": csrfToken,
    "x-restli-protocol-version": "2.0.0",
    "x-li-lang": "en_US",
    "x-li-track": JSON.stringify({
      clientVersion: "1.13.9220",
      mpVersion: "1.13.9220",
      osName: "web",
      timezoneOffset: 5.5,
      timezone: "Asia/Kolkata",
      deviceFormFactor: "DESKTOP",
      mpName: "voyager-web",
    }),
  };
}
