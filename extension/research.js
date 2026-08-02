/**
 * research.js — Fully local research engine
 * Runs entirely in the browser, no server dependency.
 * Google search → scrape websites → find founders → check ads → CSV export
 */

// ── State ────────────────────────────────────────────────────────────────────
let companies = [];
let running = false;
let shouldStop = false;
let stats = { found: 0, scraped: 0, founders: 0 };

// ── DOM refs ─────────────────────────────────────────────────────────────────
const startBtn     = document.getElementById("startBtn");
const stopBtn      = document.getElementById("stopBtn");
const exportBtn    = document.getElementById("exportBtn");
const clearBtn     = document.getElementById("clearBtn");
const statusText   = document.getElementById("statusText");
const progressBar  = document.getElementById("progressBar");
const progressFill = document.getElementById("progressFill");
const progressText = document.getElementById("progressText");
const resultsCard  = document.getElementById("resultsCard");
const resultsBody  = document.getElementById("resultsBody");
const resultCount  = document.getElementById("resultCount");
const statFound    = document.getElementById("statFound");
const statScraped  = document.getElementById("statScraped");
const statFounders = document.getElementById("statFounders");

// ── UI helpers ───────────────────────────────────────────────────────────────

function setStatus(text) { statusText.textContent = text; }

function setProgress(current, total, label) {
  progressBar.style.display = "block";
  progressText.style.display = "block";
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  progressFill.style.width = pct + "%";
  progressText.textContent = `${label} — ${current}/${total} (${pct}%)`;
}

function updateStats() {
  statFound.textContent = stats.found;
  statScraped.textContent = stats.scraped;
  statFounders.textContent = stats.founders;
}

function renderRow(co, idx) {
  const socialLinks = [];
  if (co.socials?.linkedin) socialLinks.push(`<a href="${esc(co.socials.linkedin)}" target="_blank" class="social-li" title="LinkedIn">Li</a>`);
  if (co.socials?.facebook) socialLinks.push(`<a href="${esc(co.socials.facebook)}" target="_blank" class="social-fb" title="Facebook">Fb</a>`);
  if (co.socials?.instagram) socialLinks.push(`<a href="${esc(co.socials.instagram)}" target="_blank" class="social-ig" title="Instagram">Ig</a>`);
  if (co.socials?.twitter) socialLinks.push(`<a href="${esc(co.socials.twitter)}" target="_blank" class="social-tw" title="Twitter">Tw</a>`);

  const adsTag = (status) => {
    if (status === "YES") return '<span class="tag-yes">Yes</span>';
    if (status === "NO") return '<span class="tag-no">No</span>';
    return '<span class="tag-unknown">--</span>';
  };

  return `<tr>
    <td>${idx + 1}</td>
    <td><strong>${esc(co.name)}</strong></td>
    <td><a href="${esc(co.website)}" target="_blank">${esc(co.domain)}</a></td>
    <td><div class="social-links">${socialLinks.join("") || "--"}</div></td>
    <td class="truncate">${esc(co.emails?.[0] || "--")}</td>
    <td>${esc(co.phones?.[0] || "--")}</td>
    <td>${esc(co.founder?.name || "--")}${co.founder?.title ? `<br><span style="color:#9ca3af;font-size:10px">${esc(co.founder.title)}</span>` : ""}</td>
    <td>${co.founder?.linkedin ? `<a href="${esc(co.founder.linkedin)}" target="_blank">Profile</a>` : "--"}</td>
    <td>${adsTag(co.googleAds)}</td>
    <td>${adsTag(co.metaAds)}</td>
    <td class="truncate">${esc(co.location || "--")}</td>
  </tr>`;
}

function renderTable() {
  resultsBody.innerHTML = companies.map((co, i) => renderRow(co, i)).join("");
  resultCount.textContent = companies.length;
  resultsCard.style.display = companies.length > 0 ? "block" : "none";
  exportBtn.style.display = companies.length > 0 ? "inline-block" : "none";
  clearBtn.style.display = companies.length > 0 ? "inline-block" : "none";
}

function esc(str) {
  if (!str) return "";
  return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ── Tab helper: open → wait for load → extract → close ──────────────────────

async function openAndExtract(url, extractFn, timeoutMs = 20000) {
  let tab;
  try {
    tab = await chrome.tabs.create({ url, active: false });
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, timeoutMs);
      const listener = (tabId, info) => {
        if (tabId === tab.id && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          clearTimeout(timeout);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
    await sleep(1000 + Math.random() * 1500);
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractFn,
    });
    return results[0]?.result ?? null;
  } catch (err) {
    console.error(`[research] Extract failed for ${url}:`, err);
    return null;
  } finally {
    if (tab?.id) try { await chrome.tabs.remove(tab.id); } catch {}
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Step 1: Google Search ────────────────────────────────────────────────────

function generateQueries(industry, location, keywords, exclude) {
  const excl = exclude.length ? " " + exclude.map(e => `-"${e}"`).join(" ") : "";
  const queries = [
    `${industry} companies in ${location}${excl}`,
    `best ${industry} ${location}${excl}`,
    `${industry} services ${location}${excl}`,
    `top ${industry} businesses ${location}${excl}`,
    `${industry} near ${location}${excl}`,
  ];
  for (const kw of keywords.slice(0, 3)) {
    queries.push(`${kw} ${industry} ${location}${excl}`);
  }
  return queries;
}

function extractGoogleResults() {
  const results = [];
  const blocked = ["google.com","youtube.com","wikipedia.org","facebook.com",
    "linkedin.com","twitter.com","instagram.com","tiktok.com","reddit.com",
    "pinterest.com","amazon.com","yelp.com","bbb.org","glassdoor.com",
    "indeed.com","crunchbase.com","tripadvisor.com","tripadvisor.in",
    "lusha.com","yellowpages.com","trustpilot.com","bloomberg.com",
    "zoominfo.com","apollo.io","bing.com","canstar.co.nz","bark.com",
    "thumbtack.com","angi.com","homeadvisor.com","nextdoor.com"];

  // Strategy 1: div.g organic results
  document.querySelectorAll("div.g").forEach(item => {
    const a = item.querySelector("a[href^='http']");
    const h3 = item.querySelector("h3");
    if (!a || !h3) return;
    try {
      const hostname = new URL(a.href).hostname.replace(/^www\./, "");
      if (blocked.some(b => hostname.endsWith(b))) return;
      results.push({ name: h3.textContent.trim(), url: a.href, domain: hostname });
    } catch {}
  });

  // Strategy 2: any link with h3
  if (results.length < 5) {
    document.querySelectorAll("a[href^='http']").forEach(a => {
      const h3 = a.closest("[data-hveid]")?.querySelector("h3") || a.querySelector("h3");
      if (!h3) return;
      try {
        const hostname = new URL(a.href).hostname.replace(/^www\./, "");
        if (blocked.some(b => hostname.endsWith(b))) return;
        if (results.some(r => r.domain === hostname)) return;
        results.push({ name: h3.textContent.trim(), url: a.href, domain: hostname });
      } catch {}
    });
  }

  // Strategy 3: all external links
  if (results.length < 5) {
    document.querySelectorAll("a[href^='http']").forEach(a => {
      try {
        const hostname = new URL(a.href).hostname.replace(/^www\./, "");
        if (blocked.some(b => hostname.endsWith(b))) return;
        if (hostname.includes("google")) return;
        if (results.some(r => r.domain === hostname)) return;
        const text = a.textContent?.trim();
        if (text && text.length > 2 && text.length < 80) {
          results.push({ name: text, url: a.href, domain: hostname });
        }
      } catch {}
    });
  }

  // Deduplicate
  const seen = new Set();
  return results.filter(r => {
    if (seen.has(r.domain)) return false;
    seen.add(r.domain);
    return true;
  }).slice(0, 20);
}

// ── Step 2: Scrape Website ───────────────────────────────────────────────────

function scrapeWebsite() {
  const html = document.documentElement?.innerHTML || "";
  const text = document.body?.innerText?.slice(0, 5000) || "";
  const title = document.title || "";

  // Social links
  const allLinks = [...document.querySelectorAll("a[href]")].map(a => a.href);
  const socials = { linkedin: null, facebook: null, instagram: null, twitter: null, youtube: null, tiktok: null };

  for (const href of allLinks) {
    if (!socials.linkedin && /linkedin\.com\/(company|in)\//i.test(href)) socials.linkedin = href.split("?")[0];
    if (!socials.facebook && /facebook\.com\/(?!sharer|share|tr|ads)/i.test(href)) socials.facebook = href.split("?")[0];
    if (!socials.instagram && /instagram\.com\//i.test(href) && !/\/(p|explore|accounts)/i.test(href)) socials.instagram = href.split("?")[0];
    if (!socials.twitter && /(twitter\.com|x\.com)\//i.test(href) && !/\/intent\//i.test(href)) socials.twitter = href.split("?")[0];
    if (!socials.youtube && /youtube\.com\/(channel|c|@|user)\//i.test(href)) socials.youtube = href.split("?")[0];
    if (!socials.tiktok && /tiktok\.com\/@/i.test(href)) socials.tiktok = href.split("?")[0];
  }

  // Emails
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emails = [...new Set(html.match(emailRegex) || [])]
    .filter(e => !e.endsWith(".png") && !e.endsWith(".jpg") && !e.endsWith(".svg")
      && !e.includes("example") && !e.includes("wixpress") && !e.includes("sentry"))
    .slice(0, 5);

  // Phones
  const telLinks = allLinks.filter(h => h.startsWith("tel:")).map(h => h.replace("tel:", "").trim());
  const phoneRegex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g;
  const textPhones = (text.match(phoneRegex) || []).filter(p => p.replace(/\D/g, "").length >= 7 && p.replace(/\D/g, "").length <= 15);
  const phones = [...new Set([...telLinks, ...textPhones])].slice(0, 3);

  // Ad signals
  const hasGoogleAds = /googleads|google_conversion|AW-\d+|gtag.*conversion/i.test(html);
  const hasGTM = /googletagmanager|GTM-[A-Z0-9]+/i.test(html);
  const hasMetaPixel = /fbq\(|facebook\.com\/tr|Meta Pixel/i.test(html);

  // Address
  let address = null;
  const addrMatch = text.match(/(\d+[^,\n]{3,40},\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,?\s*[A-Z]{2}\s*\d{4,5})/);
  if (addrMatch) address = addrMatch[1].trim();
  if (!address) {
    const locMatch = text.match(/(?:located|based|serving)\s+(?:in|at)\s+([^.\n]{3,50})/i);
    if (locMatch) address = locMatch[1].trim();
  }

  return { title, socials, emails, phones, googleAds: hasGoogleAds || hasGTM, metaAds: hasMetaPixel, address };
}

// ── Step 3: Find Founder ─────────────────────────────────────────────────────

function extractLinkedInPeople() {
  const results = [];

  document.querySelectorAll("div.g").forEach(item => {
    const a = item.querySelector("a[href*='linkedin.com/in/']");
    const h3 = item.querySelector("h3");
    if (!a || !h3) return;
    const parts = h3.textContent.trim().split(/\s*[-–|]\s*/);
    results.push({
      name: (parts[0] || "").trim(),
      title: (parts[1] || "").trim(),
      linkedin: a.href.split("?")[0],
    });
  });

  if (results.length === 0) {
    document.querySelectorAll("a[href*='linkedin.com/in/']").forEach(a => {
      const container = a.closest("[data-hveid]");
      const text = container?.querySelector("h3")?.textContent || a.textContent?.trim() || "";
      if (text.length < 3) return;
      const parts = text.split(/\s*[-–|]\s*/);
      results.push({
        name: (parts[0] || "").trim(),
        title: (parts[1] || "").trim(),
        linkedin: a.href.split("?")[0],
      });
    });
  }

  return results.filter(r => r.name.length > 1);
}

function pickBestFounder(candidates) {
  if (!candidates.length) return null;
  const priority = [/founder/i, /co-founder/i, /ceo/i, /owner/i, /president/i, /director/i, /managing/i, /chief/i];
  for (const pat of priority) {
    const m = candidates.find(c => pat.test(c.title));
    if (m) return m;
  }
  return candidates[0];
}

// ── Main research flow ──────────────────────────────────────────────────────

async function runResearch() {
  const industry = document.getElementById("industry").value.trim();
  const location = document.getElementById("location").value.trim();
  const maxCompanies = parseInt(document.getElementById("maxCompanies").value) || 30;
  const keywords = document.getElementById("keywords").value.split(",").map(s => s.trim()).filter(Boolean);
  const exclude = document.getElementById("exclude").value.split(",").map(s => s.trim()).filter(Boolean);

  if (!industry || !location) { setStatus("Please enter industry and location"); return; }

  running = true;
  shouldStop = false;
  companies = [];
  stats = { found: 0, scraped: 0, founders: 0 };
  startBtn.style.display = "none";
  stopBtn.style.display = "inline-block";
  renderTable();
  updateStats();

  // ── Phase 1: Google Search ──
  const queries = generateQueries(industry, location, keywords, exclude);
  const seenDomains = new Set();

  for (let i = 0; i < queries.length; i++) {
    if (shouldStop) break;
    if (seenDomains.size >= maxCompanies) break;

    setStatus(`Searching Google (${i + 1}/${queries.length})...`);
    setProgress(i, queries.length, "Google Search");

    const url = `https://www.google.com/search?q=${encodeURIComponent(queries[i])}&num=20`;
    const results = await openAndExtract(url, extractGoogleResults);

    if (results?.length) {
      for (const r of results) {
        if (seenDomains.has(r.domain)) continue;
        if (seenDomains.size >= maxCompanies) break;
        seenDomains.add(r.domain);
        companies.push({
          name: r.name,
          domain: r.domain,
          website: `https://${r.domain}`,
          socials: {},
          emails: [],
          phones: [],
          founder: null,
          googleAds: null,
          metaAds: null,
          location: null,
        });
      }
    }

    stats.found = companies.length;
    updateStats();
    renderTable();

    if (i < queries.length - 1) await sleep(800 + Math.random() * 1200);
  }

  setProgress(queries.length, queries.length, "Google Search");

  // ── Phase 2: Scrape websites + check ads (in same visit) ──
  const BATCH_SIZE = 3;
  for (let i = 0; i < companies.length; i += BATCH_SIZE) {
    if (shouldStop) break;

    const batch = companies.slice(i, Math.min(i + BATCH_SIZE, companies.length));
    setStatus(`Scraping websites (${i + 1}-${Math.min(i + BATCH_SIZE, companies.length)}/${companies.length})...`);
    setProgress(i, companies.length, "Website Scraping + Ads Check");

    const promises = batch.map(async (co) => {
      try {
        const data = await openAndExtract(co.website, scrapeWebsite);
        if (data) {
          co.socials = data.socials || {};
          co.emails = data.emails || [];
          co.phones = data.phones || [];
          co.googleAds = data.googleAds ? "YES" : "NO";
          co.metaAds = data.metaAds ? "YES" : "NO";
          co.location = data.address || null;
          if (data.title && (co.name.includes("|") || co.name.includes("..."))) {
            co.name = data.title.split(/[|\-–]/)[0].trim() || co.name;
          }
          stats.scraped++;
        }
      } catch (err) {
        console.error(`[research] Scrape failed for ${co.domain}:`, err);
      }
    });

    await Promise.all(promises);
    updateStats();
    renderTable();
  }

  setProgress(companies.length, companies.length, "Website Scraping");

  // ── Phase 3: Find founders (Google search for LinkedIn) ──
  for (let i = 0; i < companies.length; i += BATCH_SIZE) {
    if (shouldStop) break;

    const batch = companies.slice(i, Math.min(i + BATCH_SIZE, companies.length));
    setStatus(`Finding founders (${i + 1}-${Math.min(i + BATCH_SIZE, companies.length)}/${companies.length})...`);
    setProgress(i, companies.length, "Founder Search");

    const promises = batch.map(async (co) => {
      try {
        const cleanName = co.name.replace(/[|\\\/\-].*/g, "").trim();
        const q = `"${cleanName}" founder OR CEO OR owner site:linkedin.com/in`;
        const candidates = await openAndExtract(
          `https://www.google.com/search?q=${encodeURIComponent(q)}&num=5`,
          extractLinkedInPeople
        );
        if (candidates?.length) {
          co.founder = pickBestFounder(candidates);
          if (co.founder) stats.founders++;
        }
      } catch (err) {
        console.error(`[research] Founder search failed for ${co.name}:`, err);
      }
    });

    await Promise.all(promises);
    updateStats();
    renderTable();

    if (i + BATCH_SIZE < companies.length) await sleep(500 + Math.random() * 1000);
  }

  setProgress(companies.length, companies.length, "Founder Search");

  // ── Done ──
  running = false;
  startBtn.style.display = "inline-block";
  stopBtn.style.display = "none";
  setStatus(`Done! ${companies.length} companies researched.`);

  // Save to chrome.storage
  chrome.storage.local.set({ researchResults: companies, researchDate: new Date().toISOString() });
}

// ── CSV Export ────────────────────────────────────────────────────────────────

function exportCSV() {
  const csvEsc = (val) => {
    if (!val) return "";
    return `"${String(val).replace(/"/g, '""')}"`;
  };

  const headers = [
    "Company", "Website", "LinkedIn", "Facebook", "Instagram", "Twitter",
    "Email", "Phone", "Founder Name", "Founder Title", "Founder LinkedIn",
    "Google Ads", "Meta Ads", "Location",
  ];

  const rows = companies.map(co => [
    csvEsc(co.name),
    csvEsc(co.website),
    csvEsc(co.socials?.linkedin),
    csvEsc(co.socials?.facebook),
    csvEsc(co.socials?.instagram),
    csvEsc(co.socials?.twitter),
    csvEsc(co.emails?.join("; ")),
    csvEsc(co.phones?.join("; ")),
    csvEsc(co.founder?.name),
    csvEsc(co.founder?.title),
    csvEsc(co.founder?.linkedin),
    csvEsc(co.googleAds || ""),
    csvEsc(co.metaAds || ""),
    csvEsc(co.location),
  ].join(","));

  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `research_${document.getElementById("industry").value.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Event listeners ──────────────────────────────────────────────────────────

startBtn.addEventListener("click", () => {
  if (!running) runResearch();
});

stopBtn.addEventListener("click", () => {
  shouldStop = true;
  setStatus("Stopping...");
  stopBtn.disabled = true;
});

exportBtn.addEventListener("click", exportCSV);

clearBtn.addEventListener("click", () => {
  companies = [];
  stats = { found: 0, scraped: 0, founders: 0 };
  updateStats();
  renderTable();
  progressBar.style.display = "none";
  progressText.style.display = "none";
  setStatus("");
  chrome.storage.local.remove(["researchResults", "researchDate"]);
});

// Load previous results if any
chrome.storage.local.get(["researchResults"], (data) => {
  if (data.researchResults?.length) {
    companies = data.researchResults;
    stats.found = companies.length;
    stats.scraped = companies.filter(c => c.emails?.length || Object.values(c.socials || {}).some(Boolean)).length;
    stats.founders = companies.filter(c => c.founder).length;
    updateStats();
    renderTable();
  }
});
