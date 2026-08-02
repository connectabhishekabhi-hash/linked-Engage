/**
 * research.js — Fully local research engine v2
 * Google search (with pagination) → scrape websites → find founders via LinkedIn company page →
 * check Google Ads Transparency → check Facebook Ads Library → CSV export
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

async function openAndExtract(url, extractFn, timeoutMs = 25000) {
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
    await sleep(1200 + Math.random() * 1300);
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

// ── Step 1: Google Search (with pagination for more results) ────────────────

function generateQueries(industry, location, keywords, exclude) {
  const excl = exclude.length ? " " + exclude.map(e => `-"${e}"`).join(" ") : "";
  const queries = [
    `${industry} companies in ${location}${excl}`,
    `best ${industry} ${location}${excl}`,
    `${industry} services ${location}${excl}`,
    `top ${industry} businesses ${location}${excl}`,
    `${industry} near ${location}${excl}`,
    `${industry} providers ${location}${excl}`,
    `${industry} contractors ${location}${excl}`,
    `local ${industry} ${location}${excl}`,
    `${industry} specialists ${location}${excl}`,
    `${industry} ${location} reviews${excl}`,
  ];
  for (const kw of keywords.slice(0, 4)) {
    queries.push(`${kw} ${industry} ${location}${excl}`);
    queries.push(`best ${kw} ${industry} ${location}${excl}`);
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
    "thumbtack.com","angi.com","homeadvisor.com","nextdoor.com",
    "enfsolar.com","dnb.com","manta.com","mapquest.com","foursquare.com",
    "hotfrog.com","cylex.com","superpages.com","whitepages.com",
    "comparably.com","owler.com","builtwith.com","similarweb.com",
    "g2.com","capterra.com","getapp.com","softwareadvice.com",
    "ea.govt.nz","govt.nz","gov.au","gov.uk","gov.in"];

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

  const allLinks = [...document.querySelectorAll("a[href]")].map(a => a.href);
  const socials = { linkedin: null, facebook: null, instagram: null, twitter: null, youtube: null, tiktok: null };
  let fbPageName = null;
  let igUsername = null;

  for (const href of allLinks) {
    if (!socials.linkedin && /linkedin\.com\/company\//i.test(href)) {
      socials.linkedin = href.split("?")[0];
    }
    if (!socials.facebook && /facebook\.com\/(?!sharer|share|tr|ads|plugins|dialog)/i.test(href)) {
      socials.facebook = href.split("?")[0];
      const fbMatch = href.match(/facebook\.com\/([a-zA-Z0-9._-]+)/);
      if (fbMatch) fbPageName = fbMatch[1];
    }
    if (!socials.instagram && /instagram\.com\//i.test(href) && !/\/(p|explore|accounts|reel)/i.test(href)) {
      socials.instagram = href.split("?")[0];
      const igMatch = href.match(/instagram\.com\/([a-zA-Z0-9._]+)/);
      if (igMatch) igUsername = igMatch[1];
    }
    if (!socials.twitter && /(twitter\.com|x\.com)\//i.test(href) && !/\/intent\//i.test(href)) socials.twitter = href.split("?")[0];
    if (!socials.youtube && /youtube\.com\/(channel|c|@|user)\//i.test(href)) socials.youtube = href.split("?")[0];
    if (!socials.tiktok && /tiktok\.com\/@/i.test(href)) socials.tiktok = href.split("?")[0];
  }

  // Also check for LinkedIn personal profiles as fallback
  if (!socials.linkedin) {
    for (const href of allLinks) {
      if (/linkedin\.com\/in\//i.test(href)) {
        socials.linkedin = href.split("?")[0];
        break;
      }
    }
  }

  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emails = [...new Set(html.match(emailRegex) || [])]
    .filter(e => !e.endsWith(".png") && !e.endsWith(".jpg") && !e.endsWith(".svg")
      && !e.includes("example") && !e.includes("wixpress") && !e.includes("sentry")
      && !e.includes("wordpress") && !e.includes("gravatar"))
    .slice(0, 5);

  const telLinks = allLinks.filter(h => h.startsWith("tel:")).map(h => h.replace("tel:", "").trim());
  const phoneRegex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g;
  const textPhones = (text.match(phoneRegex) || []).filter(p => p.replace(/\D/g, "").length >= 7 && p.replace(/\D/g, "").length <= 15);
  const phones = [...new Set([...telLinks, ...textPhones])].slice(0, 3);

  let address = null;
  const addrMatch = text.match(/(\d+[^,\n]{3,40},\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,?\s*[A-Z]{2}\s*\d{4,5})/);
  if (addrMatch) address = addrMatch[1].trim();
  if (!address) {
    const locMatch = text.match(/(?:located|based|serving)\s+(?:in|at)\s+([^.\n]{3,50})/i);
    if (locMatch) address = locMatch[1].trim();
  }

  return { title, socials, emails, phones, address, fbPageName, igUsername };
}

// ── Step 3: Find Founder via LinkedIn Company People Page ───────────────────

function extractLinkedInCompanyPeople() {
  const results = [];

  // On LinkedIn company/people page, extract people cards
  // LinkedIn renders employee cards with name, title, and profile link
  document.querySelectorAll("a[href*='/in/']").forEach(a => {
    const card = a.closest("[data-view-name]") || a.closest("li") || a.closest("div");
    if (!card) return;

    const nameEl = card.querySelector("span[dir='ltr']") || card.querySelector("[class*='name']") || a;
    const name = nameEl?.textContent?.trim() || "";
    if (name.length < 2 || name.length > 60) return;

    const titleEl = card.querySelector("[class*='subtitle']") || card.querySelector("[class*='title']");
    let title = titleEl?.textContent?.trim() || "";

    // Also check all text content for title patterns
    if (!title) {
      const allText = card.textContent || "";
      const titleMatch = allText.match(/(?:Founder|Co-founder|CEO|Owner|Director|Managing|Chief|President|CTO|COO|CFO)[^,\n]*/i);
      if (titleMatch) title = titleMatch[0].trim();
    }

    const profileUrl = a.href?.split("?")[0] || "";
    if (profileUrl.includes("/in/") && name) {
      results.push({ name: name.split("\n")[0].trim(), title, linkedin: profileUrl });
    }
  });

  // Deduplicate by LinkedIn URL
  const seen = new Set();
  return results.filter(r => {
    if (seen.has(r.linkedin)) return false;
    seen.add(r.linkedin);
    return true;
  });
}

function extractLinkedInPeopleFromGoogle() {
  const results = [];

  document.querySelectorAll("div.g").forEach(item => {
    const a = item.querySelector("a[href*='linkedin.com/in/']");
    const h3 = item.querySelector("h3");
    if (!a || !h3) return;
    const fullText = h3.textContent.trim();
    const parts = fullText.split(/\s*[-–|]\s*/);
    results.push({
      name: (parts[0] || "").trim(),
      title: (parts[1] || "").trim(),
      linkedin: a.href.split("?")[0],
    });
  });

  if (results.length === 0) {
    document.querySelectorAll("a[href*='linkedin.com/in/']").forEach(a => {
      const container = a.closest("[data-hveid]") || a.parentElement;
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
  const priority = [/founder/i, /co-?founder/i, /\bceo\b/i, /\bowner\b/i, /\bpresident\b/i, /\bdirector\b/i, /managing\s*director/i, /\bchief\b/i, /\bcto\b/i, /\bcoo\b/i];
  for (const pat of priority) {
    const m = candidates.find(c => pat.test(c.title));
    if (m) return m;
  }
  return candidates[0];
}

// ── Step 4: Check Google Ads Transparency ───────────────────────────────────

function extractGoogleAdsTransparency() {
  const text = document.body?.innerText || "";
  // The page shows advertiser info if ads exist, or "no results" if none
  if (/no ads found|no results|didn't find any|0 results/i.test(text)) return false;
  // Check for ad entries / advertiser cards
  const hasAds = document.querySelectorAll("[class*='creative-preview'], [class*='ad-card'], [role='listitem']").length > 0;
  if (hasAds) return true;
  // Check for any ad content indicators
  if (/ads? ran|advertiser|creative|this advertiser/i.test(text) && !/no ads/i.test(text)) return true;
  return false;
}

// ── Step 5: Check Facebook Ads Library ──────────────────────────────────────

function extractFacebookAdsLibrary() {
  const text = document.body?.innerText || "";
  // No results messaging
  if (/no ads match|no results|0 results|didn't find/i.test(text)) return false;
  // Look for ad cards or results
  const adCards = document.querySelectorAll("[class*='_7jvw'], [class*='xrvj5dj'], div[role='article']");
  if (adCards.length > 0) return true;
  // Alternative: any mention of "started running" which indicates active ads
  if (/started running|active/i.test(text) && !/no ads/i.test(text)) return true;
  return false;
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

  // ── Phase 1: Google Search with pagination ──
  const queries = generateQueries(industry, location, keywords, exclude);
  const seenDomains = new Set();

  for (let i = 0; i < queries.length; i++) {
    if (shouldStop) break;
    if (seenDomains.size >= maxCompanies) break;

    // Each query gets page 1 and page 2 (start=0, start=10)
    for (let page = 0; page < 2; page++) {
      if (shouldStop || seenDomains.size >= maxCompanies) break;

      const pageLabel = page === 0 ? "" : " (page 2)";
      setStatus(`Searching Google (${i + 1}/${queries.length})${pageLabel}...`);
      setProgress(i * 2 + page, queries.length * 2, "Google Search");

      const start = page * 10;
      const url = `https://www.google.com/search?q=${encodeURIComponent(queries[i])}&num=10&start=${start}`;
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
            fbPageName: null,
            igUsername: null,
          });
        }
      }

      stats.found = companies.length;
      updateStats();
      renderTable();
      await sleep(800 + Math.random() * 1200);
    }
  }

  setProgress(1, 1, "Google Search — Complete");

  // ── Phase 2: Scrape websites (extract socials, emails, phones, fb/ig usernames) ──
  const BATCH_SIZE = 3;
  for (let i = 0; i < companies.length; i += BATCH_SIZE) {
    if (shouldStop) break;

    const batch = companies.slice(i, Math.min(i + BATCH_SIZE, companies.length));
    setStatus(`Scraping websites (${Math.min(i + BATCH_SIZE, companies.length)}/${companies.length})...`);
    setProgress(i, companies.length, "Website Scraping");

    const promises = batch.map(async (co) => {
      try {
        const data = await openAndExtract(co.website, scrapeWebsite);
        if (data) {
          co.socials = data.socials || {};
          co.emails = data.emails || [];
          co.phones = data.phones || [];
          co.location = data.address || null;
          co.fbPageName = data.fbPageName || null;
          co.igUsername = data.igUsername || null;
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

  setProgress(1, 1, "Website Scraping — Complete");

  // ── Phase 3: Find founders via LinkedIn company people page ──
  for (let i = 0; i < companies.length; i++) {
    if (shouldStop) break;

    const co = companies[i];
    setStatus(`Finding founders (${i + 1}/${companies.length}) — ${co.name}...`);
    setProgress(i, companies.length, "Founder Search");

    try {
      let founderFound = false;

      // Strategy 1: If we have the company LinkedIn URL, visit its /people/ page
      if (co.socials?.linkedin && co.socials.linkedin.includes("/company/")) {
        const companyUrl = co.socials.linkedin.replace(/\/$/, "");
        const peopleUrl = companyUrl + "/people/";
        const people = await openAndExtract(peopleUrl, extractLinkedInCompanyPeople, 30000);
        if (people?.length) {
          co.founder = pickBestFounder(people);
          if (co.founder) {
            stats.founders++;
            founderFound = true;
          }
        }
      }

      // Strategy 2: Google search for "[company] founder/CEO site:linkedin.com/in"
      if (!founderFound) {
        const cleanName = co.name.replace(/[|\\\/\-–:].*/g, "").replace(/\s+(Ltd|Inc|LLC|Pty|Limited|Corp)\.?$/i, "").trim();
        const q = `"${cleanName}" (founder OR CEO OR "co-founder" OR owner OR director) site:linkedin.com/in`;
        const candidates = await openAndExtract(
          `https://www.google.com/search?q=${encodeURIComponent(q)}&num=10`,
          extractLinkedInPeopleFromGoogle
        );
        if (candidates?.length) {
          co.founder = pickBestFounder(candidates);
          if (co.founder) {
            stats.founders++;
            founderFound = true;
          }
        }
      }

      // Strategy 3: Search Google for "[company] [location] founder OR CEO linkedin"
      if (!founderFound) {
        const cleanName = co.name.replace(/[|\\\/\-–:].*/g, "").trim();
        const q = `${cleanName} ${location} founder OR CEO OR owner linkedin`;
        const candidates = await openAndExtract(
          `https://www.google.com/search?q=${encodeURIComponent(q)}&num=10`,
          extractLinkedInPeopleFromGoogle
        );
        if (candidates?.length) {
          co.founder = pickBestFounder(candidates);
          if (co.founder) stats.founders++;
        }
      }
    } catch (err) {
      console.error(`[research] Founder search failed for ${co.name}:`, err);
    }

    updateStats();
    renderTable();
    if (i < companies.length - 1) await sleep(500 + Math.random() * 800);
  }

  setProgress(1, 1, "Founder Search — Complete");

  // ── Phase 4: Check Google Ads Transparency Center ──
  for (let i = 0; i < companies.length; i += BATCH_SIZE) {
    if (shouldStop) break;

    const batch = companies.slice(i, Math.min(i + BATCH_SIZE, companies.length));
    setStatus(`Checking Google Ads (${Math.min(i + BATCH_SIZE, companies.length)}/${companies.length})...`);
    setProgress(i, companies.length, "Google Ads Check");

    const promises = batch.map(async (co) => {
      try {
        const domain = co.domain;
        const url = `https://adstransparency.google.com/?domain=${encodeURIComponent(domain)}`;
        const hasAds = await openAndExtract(url, extractGoogleAdsTransparency, 20000);
        co.googleAds = hasAds ? "YES" : "NO";
      } catch (err) {
        console.error(`[research] Google Ads check failed for ${co.domain}:`, err);
        co.googleAds = "NO";
      }
    });

    await Promise.all(promises);
    updateStats();
    renderTable();
  }

  setProgress(1, 1, "Google Ads Check — Complete");

  // ── Phase 5: Check Facebook Ads Library ──
  for (let i = 0; i < companies.length; i += BATCH_SIZE) {
    if (shouldStop) break;

    const batch = companies.slice(i, Math.min(i + BATCH_SIZE, companies.length));
    setStatus(`Checking Meta Ads (${Math.min(i + BATCH_SIZE, companies.length)}/${companies.length})...`);
    setProgress(i, companies.length, "Meta Ads Check");

    const promises = batch.map(async (co) => {
      try {
        // Use Facebook page name or Instagram username to search Ads Library
        const searchTerm = co.fbPageName || co.igUsername || co.name.replace(/[|\\\/\-–:].*/g, "").trim();
        const url = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&q=${encodeURIComponent(searchTerm)}`;
        const hasAds = await openAndExtract(url, extractFacebookAdsLibrary, 20000);
        co.metaAds = hasAds ? "YES" : "NO";
      } catch (err) {
        console.error(`[research] Meta Ads check failed for ${co.name}:`, err);
        co.metaAds = "NO";
      }
    });

    await Promise.all(promises);
    updateStats();
    renderTable();
  }

  setProgress(1, 1, "Meta Ads Check — Complete");

  // ── Done ──
  running = false;
  startBtn.style.display = "inline-block";
  stopBtn.style.display = "none";
  setStatus(`Done! ${companies.length} companies researched.`);

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
