import { BrowserContext } from "playwright";
import { chromium as stealthChromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { getProxy } from "@/lib/proxy";

stealthChromium.use(StealthPlugin());

export { stealthChromium };

interface ActionPayload {
  liAt: string;
  type: "COMMENT" | "CONNECTION_REQUEST" | "DIRECT_MESSAGE";
  content: string;
  targetUrl: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function buildAuthenticatedContext(liAt: string): Promise<BrowserContext> {
  const proxy = getProxy();

  const browser = await stealthChromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
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

  return context;
}

export async function executeLinkedInAction(payload: ActionPayload): Promise<void> {
  const context = await buildAuthenticatedContext(payload.liAt);
  const page = await context.newPage();

  try {
    if (payload.type === "COMMENT") {
      await executeComment(page, payload.targetUrl, payload.content);
    } else if (payload.type === "CONNECTION_REQUEST") {
      await executeConnectionRequest(page, payload.targetUrl, payload.content);
    }
  } finally {
    await context.browser()?.close();
  }
}

// ─── Comment ──────────────────────────────────────────────────────────────────
async function executeComment(page: any, postUrl: string, content: string) {
  console.log("[execute] Navigating to post:", postUrl);
  await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await sleep(3000);

  // Try multiple comment button selectors
  const commentBtnSelectors = [
    '[aria-label*="Comment"]',
    'button:has-text("Comment")',
    '[data-control-name="comment"]',
  ];

  let clicked = false;
  for (const sel of commentBtnSelectors) {
    const btn = page.locator(sel).first();
    const count = await btn.count();
    if (count > 0) {
      await btn.click();
      clicked = true;
      console.log("[execute] Clicked comment button:", sel);
      break;
    }
  }
  if (!clicked) throw new Error("Could not find the Comment button on the post page.");

  await sleep(1500);

  // Type into the comment editor
  const editorSelectors = [
    ".ql-editor",
    "[contenteditable='true']",
    ".comments-comment-box__form [contenteditable]",
  ];
  let editor: any = null;
  for (const sel of editorSelectors) {
    const el = page.locator(sel).first();
    if ((await el.count()) > 0) {
      editor = el;
      break;
    }
  }
  if (!editor) throw new Error("Could not find comment editor.");

  await editor.click();
  await sleep(500);

  // Type character by character for human-like behaviour
  for (const char of content) {
    await page.keyboard.type(char, { delay: 40 + Math.random() * 60 });
  }
  await sleep(800 + Math.random() * 500);

  // Submit
  const submitSelectors = [
    'button[type="submit"]:has-text("Post")',
    'button:has-text("Post comment")',
    'button.comments-comment-box__submit-button',
  ];
  for (const sel of submitSelectors) {
    const btn = page.locator(sel).first();
    if ((await btn.count()) > 0) {
      await btn.click();
      console.log("[execute] Comment submitted");
      await sleep(2000);
      return;
    }
  }
  throw new Error("Could not find the Post/Submit button for the comment.");
}

// ─── Connection Request ───────────────────────────────────────────────────────
async function executeConnectionRequest(page: any, profileUrl: string, note: string) {
  console.log("[execute] Navigating to profile:", profileUrl);
  await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await sleep(3500);

  // Save screenshot for debugging
  await page.screenshot({ path: "debug-connect.png" }).catch(() => {});

  // ── Step 1: Find and click the Connect button ─────────────────────────────
  // LinkedIn layouts vary: direct button, "More" dropdown, or bottom banner
  const connectSelectors = [
    'button:has-text("Connect")',
    '[aria-label="Connect"]',
    '[aria-label*="Invite"][aria-label*="connect"]',
  ];

  let connectClicked = false;

  // Try direct Connect button first
  for (const sel of connectSelectors) {
    const btn = page.locator(sel).first();
    if ((await btn.count()) > 0) {
      console.log("[execute] Found direct Connect button:", sel);
      await btn.click({ force: true });
      connectClicked = true;
      break;
    }
  }

  // Fallback: open "More" dropdown and find Connect inside it
  if (!connectClicked) {
    console.log("[execute] No direct Connect — trying More dropdown");
    const moreBtn = page.locator('button:has-text("More")').first();
    await moreBtn.waitFor({ timeout: 10_000 });
    await moreBtn.click({ force: true });
    await sleep(1200);

    await page.screenshot({ path: "debug-more-menu.png" }).catch(() => {});

    // Log visible items in dropdown
    const menuItems = await page.evaluate(`
      Array.from(document.querySelectorAll('[role="menuitem"], .artdeco-dropdown__item'))
        .map(el => el.innerText.trim())
        .filter(t => t.length > 0)
    `);
    console.log("[execute] More menu items:", JSON.stringify(menuItems));

    // Click Connect inside the dropdown
    const connectInMenu = page.locator(
      '[role="menuitem"]:has-text("Connect"), .artdeco-dropdown__item:has-text("Connect")'
    ).first();
    if ((await connectInMenu.count()) > 0) {
      await connectInMenu.click({ force: true });
      connectClicked = true;
    } else {
      throw new Error(`Connect not found in More menu. Menu items: ${JSON.stringify(menuItems)}`);
    }
  }

  console.log("[execute] Clicked Connect — waiting for modal");
  await sleep(2500);

  // ── Step 2: Handle the "Add a note?" modal ────────────────────────────────
  await page.screenshot({ path: "debug-connect-modal.png" }).catch(() => {});

  // Log all visible buttons so we can debug unknown modal states
  const allButtons = await page.evaluate(`
    Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter(el => el.offsetParent !== null)
      .map(el => el.innerText.trim())
      .filter(t => t.length > 0)
  `);
  console.log("[execute] Visible buttons after Connect click:", JSON.stringify(allButtons));

  // Log all dialog text
  const dialogText = await page.evaluate(`
    var d = document.querySelector('[role="dialog"], .artdeco-modal, .send-invite');
    d ? d.innerText.trim().slice(0, 500) : "NO DIALOG FOUND"
  `);
  console.log("[execute] Dialog text:", dialogText);

  // Try to find "Add a note" button (multiple selectors for LinkedIn's changing UI)
  const addNoteSelectors = [
    'button:has-text("Add a note")',
    '[aria-label="Add a note"]',
    'button:has-text("add a note")',
  ];

  let foundAddNote = false;
  for (const sel of addNoteSelectors) {
    const btn = page.locator(sel).first();
    if ((await btn.count()) > 0) {
      await btn.click();
      foundAddNote = true;
      console.log("[execute] Clicked Add a note:", sel);
      break;
    }
  }

  if (!foundAddNote) {
    // Modal may not have appeared or skipped straight to send
    // Try to find the textarea directly
    const textarea = page.locator('textarea[name="message"], textarea[placeholder*="note"]').first();
    const textareaCount = await textarea.count();
    if (textareaCount > 0) {
      foundAddNote = true;
      console.log("[execute] Found textarea directly — skipping Add a note click");
    } else {
      // Just send without a note
      console.log("[execute] No 'Add a note' button found — sending without note");
      const sendWithoutNote = page.locator('button:has-text("Send without a note")').first();
      if ((await sendWithoutNote.count()) > 0) {
        await sendWithoutNote.click();
        await sleep(1500);
        console.log("[execute] Connection request sent without note");
        return;
      }
      // Last resort: look for Send button
      const sendBtn = page.locator('button:has-text("Send")').first();
      if ((await sendBtn.count()) > 0) {
        await sendBtn.click();
        await sleep(1500);
        return;
      }
      throw new Error("Could not find connection request buttons in the modal.");
    }
  }

  await sleep(1000);

  // ── Step 3: Type the note ─────────────────────────────────────────────────
  const textareaSelectors = [
    'textarea[name="message"]',
    'textarea[placeholder*="note"]',
    'textarea[placeholder*="Add"]',
    ".connect-button-send-invite__custom-message",
  ];

  let typed = false;
  for (const sel of textareaSelectors) {
    const ta = page.locator(sel).first();
    if ((await ta.count()) > 0) {
      await ta.click();
      await sleep(300);
      // Trim note to 300 chars (LinkedIn limit)
      const trimmed = note.slice(0, 300);
      for (const char of trimmed) {
        await page.keyboard.type(char, { delay: 40 + Math.random() * 60 });
      }
      typed = true;
      console.log("[execute] Typed note into textarea:", sel);
      break;
    }
  }

  if (!typed) {
    console.warn("[execute] Could not find note textarea — sending without note text");
  }

  await sleep(600 + Math.random() * 400);

  // ── Step 4: Send ──────────────────────────────────────────────────────────
  const sendSelectors = [
    'button:has-text("Send")',
    'button[aria-label="Send invitation"]',
    'button[aria-label*="Send"]',
  ];

  for (const sel of sendSelectors) {
    const btn = page.locator(sel).first();
    if ((await btn.count()) > 0) {
      await btn.click();
      console.log("[execute] Connection request sent ✓");
      await sleep(1500);
      return;
    }
  }

  throw new Error("Could not find the Send button to submit the connection request.");
}
