/**
 * api.js — LinkedEngage backend API calls
 * The extension talks to the Next.js backend to:
 *   1. Register itself and store an auth token
 *   2. Poll for pending jobs
 *   3. Report job completion or failure
 */

const BACKEND_URL = "http://localhost:3000"; // Change to prod URL when deployed

// ─── Storage helpers ──────────────────────────────────────────────────────────

export async function getStoredToken() {
  const { extensionToken } = await chrome.storage.local.get("extensionToken");
  return extensionToken ?? null;
}

export async function storeToken(token) {
  await chrome.storage.local.set({ extensionToken: token });
}

export async function getStoredUserId() {
  const { userId } = await chrome.storage.local.get("userId");
  return userId ?? null;
}

// ─── Backend calls ────────────────────────────────────────────────────────────

/**
 * Register the extension with the backend using the user's API token.
 * The user copies this token from their Settings page and pastes it
 * into the extension popup.
 */
export async function registerExtension(userApiToken) {
  const res = await fetch(`${BACKEND_URL}/api/extension/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: userApiToken }),
  });
  if (!res.ok) throw new Error(`Registration failed: ${res.status}`);
  const data = await res.json();
  await storeToken(data.extensionToken);
  await chrome.storage.local.set({ userId: data.userId });
  return data;
}

/**
 * Poll the backend for the next pending job for this user.
 * Returns null if no jobs are queued.
 */
export async function fetchNextJob() {
  const token = await getStoredToken();
  if (!token) return null;

  const res = await fetch(`${BACKEND_URL}/api/extension/jobs`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 204) return null; // No content = no pending jobs
  if (!res.ok) {
    console.error("[api] fetchNextJob failed:", res.status);
    return null;
  }
  return res.json();
}

/**
 * Report a successfully completed job back to the backend.
 * @param {string} jobId
 * @param {object} result — scraped data or action confirmation
 */
export async function completeJob(jobId, result) {
  const token = await getStoredToken();
  const res = await fetch(`${BACKEND_URL}/api/extension/jobs/${jobId}/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ result }),
  });
  if (!res.ok) throw new Error(`completeJob failed: ${res.status}`);
  return res.json();
}

/**
 * Report a failed job to the backend so it can update the lead status.
 * @param {string} jobId
 * @param {string} error — error message
 */
export async function failJob(jobId, error) {
  const token = await getStoredToken();
  await fetch(`${BACKEND_URL}/api/extension/jobs/${jobId}/fail`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ error }),
  });
}
