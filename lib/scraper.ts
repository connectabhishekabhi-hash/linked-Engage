import "dotenv/config";
import { stealthChromium } from "./playwright-runner";
import { getProxy } from "./proxy";

export interface ScrapedProfile {
  fullName: string;
  headline: string;
  bio: string;
  latestPost: string;
  latestPostUrl: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (base: number, extra = 2000) => base + Math.random() * extra;

export async function scrapeLinkedInProfile(
  liAt: string,
  profileUrl: string
): Promise<ScrapedProfile> {
  const proxy = getProxy();

  const browser = await stealthChromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--window-size=1440,900",
    ],
    ...(proxy && {
      proxy: { server: proxy.server, username: proxy.username, password: proxy.password },
    }),
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    timezoneId: "Asia/Kolkata",
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
  });

  await context.addCookies([
    {
      name: "li_at",
      value: liAt,
      domain: ".linkedin.com",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "None",
    },
  ]);

  const page = await context.newPage();

  try {
    // ── 1. Navigate to profile ─────────────────────────────────────────────
    console.log(`[scraper] Navigating to: ${profileUrl}`);
    await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await sleep(jitter(3000, 3000));

    const currentUrl = page.url();
    const pageTitle = await page.title();
    console.log(`[scraper] URL: ${currentUrl}`);
    console.log(`[scraper] Title: ${pageTitle}`);

    // ── 2. Guard: login/CAPTCHA redirects ─────────────────────────────────
    if (
      currentUrl.includes("/login") ||
      currentUrl.includes("/checkpoint") ||
      currentUrl.includes("/authwall") ||
      currentUrl.includes("/uas/login")
    ) {
      throw new Error(
        "LinkedIn redirected to login — your li_at cookie is invalid or expired. Go to Settings and paste a fresh cookie."
      );
    }

    const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    if (
      bodyText.toLowerCase().includes("security check") ||
      bodyText.toLowerCase().includes("verify you") ||
      bodyText.toLowerCase().includes("captcha")
    ) {
      throw new Error(
        "LinkedIn showed a CAPTCHA — try again in a few minutes or add a residential proxy."
      );
    }

    // ── 3. Scroll to trigger lazy-loading ─────────────────────────────────
    await page.evaluate("window.scrollTo(0, 400)");
    await sleep(1500);
    await page.evaluate("window.scrollTo(0, 900)");
    await sleep(1200);

    // Save screenshot for debugging
    await page.screenshot({ path: "debug-profile.png", fullPage: false }).catch(() => {});

    // ── 4. Wait for any h1 to have text (up to 25s) ───────────────────────
    try {
      await page.waitForFunction(
        "document.querySelector('h1') && document.querySelector('h1').innerText.trim().length > 1",
        { timeout: 25_000 }
      );
    } catch {
      console.warn("[scraper] h1 never appeared — will use page title fallback");
    }

    // ── 5. Extract name + headline + bio as strings (no helper fns) ────────
    // Written as a string to avoid esbuild __name injection
    const profileData = await page.evaluate(`(function() {
      var nameSelectors = ["h1", ".pv-text-details__left-panel h1", ".top-card-layout__title"];
      var headlineSelectors = [
        ".text-body-medium.break-words",
        ".pv-text-details__left-panel .text-body-medium",
        ".top-card-layout__headline"
      ];
      var bioSelectors = [
        "#about ~ div .full-width span[aria-hidden='true']",
        "#about ~ div span[aria-hidden='true']",
        "#about + div span[aria-hidden='true']",
        ".pv-about-section .pv-about__summary-text",
        ".pv-shared-text-with-see-more span[aria-hidden='true']"
      ];

      function pick(selectors) {
        for (var i = 0; i < selectors.length; i++) {
          var el = document.querySelector(selectors[i]);
          if (el && el.innerText && el.innerText.trim().length > 1) {
            return el.innerText.trim();
          }
        }
        return "";
      }

      return {
        fullName: pick(nameSelectors),
        headline: pick(headlineSelectors),
        bio: pick(bioSelectors)
      };
    })()`);

    const data = profileData as { fullName: string; headline: string; bio: string };

    // ── 6. Fallback: parse name from page title ────────────────────────────
    let fullName = data.fullName;
    const headline = data.headline;
    const bio = data.bio;

    if (!fullName && pageTitle) {
      const m = pageTitle.match(/^([^|–\-]{2,})/);
      if (m) {
        fullName = m[1].trim();
        console.log(`[scraper] Name from title: ${fullName}`);
      }
    }

    if (!fullName) {
      await page.screenshot({ path: "debug-noname.png", fullPage: true }).catch(() => {});
      throw new Error(`Could not find profile name. URL: ${currentUrl} | Title: ${pageTitle}`);
    }

    console.log(`[scraper] ✓ Name: ${fullName}`);
    console.log(`[scraper] Headline: ${headline}`);
    console.log(`[scraper] Bio: ${bio.length} chars`);

    // ── 7. Navigate to activity feed ──────────────────────────────────────
    const cleanUrl = profileUrl.replace(/\/?(\?.*)?$/, "");
    const activityUrl = `${cleanUrl}/recent-activity/all/`;
    console.log(`[scraper] Activity: ${activityUrl}`);

    await page.goto(activityUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await sleep(jitter(3000, 2000));
    await page.evaluate("window.scrollTo(0, 600)");
    await sleep(1500);

    await page.screenshot({ path: "debug-activity.png", fullPage: false }).catch(() => {});

    // ── 8. Extract latest post (string-based evaluate, no __name) ─────────
    const postData = await page.evaluate(`(function() {
      var containers = [
        ".feed-shared-update-v2",
        ".occludable-update",
        "[data-urn*='ugcPost']",
        "[data-urn*='activity']",
        ".feed-shared-update"
      ];
      var textSels = [
        ".feed-shared-text span[dir='ltr']",
        ".break-words span[dir='ltr']",
        ".attributed-text-segment-list__content",
        ".update-components-text span[dir='ltr']",
        "span[dir='ltr']"
      ];
      var linkSels = [
        "a[href*='/feed/update/']",
        "a[href*='/posts/']"
      ];

      for (var c = 0; c < containers.length; c++) {
        var items = document.querySelectorAll(containers[c]);
        if (!items.length) continue;
        var first = items[0];

        var text = "";
        for (var t = 0; t < textSels.length; t++) {
          var tel = first.querySelector(textSels[t]);
          if (tel && tel.innerText && tel.innerText.trim().length > 10) {
            text = tel.innerText.trim();
            break;
          }
        }

        var href = "";
        for (var l = 0; l < linkSels.length; l++) {
          var lel = first.querySelector(linkSels[l]);
          if (lel && lel.href) {
            href = lel.href.split("?")[0];
            break;
          }
        }

        if (text || href) return { text: text, href: href };
      }
      return { text: "", href: "" };
    })()`);

    const post = postData as { text: string; href: string };
    const latestPost = post.text;
    const latestPostUrl = post.href
      ? post.href.startsWith("http")
        ? post.href
        : `https://www.linkedin.com${post.href}`
      : "";

    console.log(`[scraper] Post: ${latestPost.length} chars | URL: ${latestPostUrl || "none"}`);

    return { fullName, headline, bio, latestPost, latestPostUrl };
  } finally {
    await browser.close();
  }
}
