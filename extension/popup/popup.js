/**
 * popup.js — Extension popup UI logic
 * Communicates with background.js via chrome.runtime.sendMessage
 * Persists AI comment preferences to chrome.storage.local
 */

const BACKEND_URL = "http://localhost:3000";

const statusEl   = document.getElementById("status");
const tokenInput = document.getElementById("tokenInput");
const saveBtn    = document.getElementById("saveBtn");
const pollBtn    = document.getElementById("pollBtn");
const messageEl  = document.getElementById("message");

// AI preference elements
const aiLengthEl      = document.getElementById("aiLength");
const aiToneEl        = document.getElementById("aiTone");
const aiEmojisEl      = document.getElementById("aiEmojis");
const aiAskQuestionEl = document.getElementById("aiAskQuestion");

function showMessage(text, type = "error") {
  messageEl.textContent = text;
  messageEl.className   = type;
}

// ── Load persisted status + preferences on open ──────────────────────────────
async function loadStatus() {
  try {
    const data = await chrome.storage.local.get([
      "status", "extensionToken",
      "aiLength", "aiTone", "aiEmojis", "aiAskQuestion",
    ]);
    statusEl.textContent = data.status ?? "Not connected";

    if (data.extensionToken) {
      tokenInput.value    = "••••••••••••••";
      saveBtn.textContent = "Reconnect";
    }

    // Restore AI preferences
    if (data.aiLength)      aiLengthEl.value      = data.aiLength;
    if (data.aiTone)        aiToneEl.value         = data.aiTone;
    if (data.aiEmojis !== undefined)      aiEmojisEl.checked      = !!data.aiEmojis;
    if (data.aiAskQuestion !== undefined) aiAskQuestionEl.checked = !!data.aiAskQuestion;
  } catch (e) {
    statusEl.textContent = "Error loading status";
    console.error(e);
  }
}

// ── Persist AI preferences on change ─────────────────────────────────────────
function savePrefs() {
  chrome.storage.local.set({
    aiLength:      aiLengthEl.value,
    aiTone:        aiToneEl.value,
    aiEmojis:      aiEmojisEl.checked,
    aiAskQuestion: aiAskQuestionEl.checked,
  });
}

aiLengthEl.addEventListener("change", savePrefs);
aiToneEl.addEventListener("change", savePrefs);
aiEmojisEl.addEventListener("change", savePrefs);
aiAskQuestionEl.addEventListener("change", savePrefs);

// ── Connect button ───────────────────────────────────────────────────────────
saveBtn.addEventListener("click", async () => {
  const token = tokenInput.value.trim();
  if (!token || token === "••••••••••••••") {
    showMessage("Please paste your API token from the dashboard Settings.", "error");
    return;
  }

  saveBtn.disabled    = true;
  saveBtn.textContent = "Connecting…";
  showMessage("");

  try {
    const res = await fetch(`${BACKEND_URL}/api/extension/register`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ token }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? `Server error ${res.status}`);
    }

    const data = await res.json();

    await chrome.storage.local.set({
      extensionToken: data.extensionToken,
      userId:         data.userId,
      status:         "✅ Connected — idle",
    });

    showMessage("✅ Connected successfully!", "success");
    statusEl.textContent = "✅ Connected — idle";
    saveBtn.textContent  = "Reconnect";
    tokenInput.value     = "••••••••••••••";

    // Kick off first poll immediately
    chrome.runtime.sendMessage({ type: "POLL_NOW" });

  } catch (e) {
    showMessage(`Connection failed: ${e.message}`, "error");
    saveBtn.textContent = "Connect";
  } finally {
    saveBtn.disabled = false;
  }
});

// ── Poll Now button ──────────────────────────────────────────────────────────
pollBtn.addEventListener("click", () => {
  pollBtn.disabled     = true;
  pollBtn.textContent  = "Polling…";
  statusEl.textContent = "⚙️ Checking for jobs…";
  showMessage("");
  console.log("[popup] Sending POLL_NOW to service worker…");

  chrome.runtime.sendMessage({ type: "POLL_NOW" }, (response) => {
    console.log("[popup] POLL_NOW response:", response);
    if (chrome.runtime.lastError) {
      console.error("[popup] sendMessage error:", chrome.runtime.lastError.message);
      showMessage("Service worker not responding: " + chrome.runtime.lastError.message, "error");
    }
    pollBtn.disabled    = false;
    pollBtn.textContent = "Poll Now";
    loadStatus();
  });
});

// ── Init ─────────────────────────────────────────────────────────────────────
loadStatus();
setInterval(loadStatus, 3000);
