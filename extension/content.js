/**
 * content.js — LinkedEngage Inline Commenting  v5
 * ─────────────────────────────────────────────────
 * Injected into linkedin.com pages.
 *
 * Detection strategy:
 *   LinkedIn's Comment button contains an SVG with id="comment-small".
 *   We find every such SVG, walk up to the clickable <button> or <a>,
 *   and inject our "⚡ Draft with AI" button right after it in the
 *   social action bar.
 */

(() => {
  "use strict";

  const TAG = "[le-content]";
  const BTN_ATTR = "data-le-draft";
  const SCAN_INTERVAL = 3000;

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function toast(text, isError = false) {
    document.querySelectorAll(".le-toast").forEach((t) => t.remove());
    const el = document.createElement("div");
    el.className = `le-toast${isError ? " le-error" : ""}`;
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ── Post-context extraction ────────────────────────────────────────────────

  function extractPostContext(startEl) {
    // ── Find the feed card container ────────────────────────────────────
    // LinkedIn uses hashed CSS classes, so we can't match on class names.
    // Instead: walk up from the comment button and look for a container
    // that has both a profile link and substantial <p> text content.
    let container = null;
    let walk = startEl;
    for (let i = 0; i < 25 && walk; i++) {
      walk = walk.parentElement;
      if (!walk) break;

      // Classic LinkedIn: data-urn attribute
      if (walk.hasAttribute("data-urn")) { container = walk; break; }

      // New LinkedIn: find a container with a profile link + text paragraphs
      const hasProfileLink = walk.querySelector('a[href*="/in/"]');
      const paragraphs = walk.querySelectorAll("p");
      let hasSubstantialText = false;
      for (const p of paragraphs) {
        if ((p.innerText?.trim() || "").length > 20) { hasSubstantialText = true; break; }
      }
      const hasCommentSvg = walk.querySelector('svg[id="comment-small"]');

      if (hasProfileLink && hasSubstantialText && hasCommentSvg) {
        container = walk;
        break;
      }
    }

    if (!container) {
      console.warn(TAG, "Could not find post container");
      return null;
    }

    console.log(TAG, "Found container:", container.tagName, (container.className || "").slice(0, 40));

    // ── Author name ─────────────────────────────────────────────────────
    // Strategy: find the first <a href="/in/..."> and get its text
    let authorName = "Unknown";
    const profileLinks = container.querySelectorAll('a[href*="/in/"]');
    for (const link of profileLinks) {
      // Get the visible text from spans inside the link
      const spans = link.querySelectorAll("span");
      for (const sp of spans) {
        const t = sp.textContent?.trim();
        if (t && t.length > 2 && t.length < 60 && !t.includes("/in/") && !t.includes("http")) {
          authorName = t;
          break;
        }
      }
      // Or try the link's own text
      if (authorName === "Unknown") {
        const t = link.textContent?.trim();
        if (t && t.length > 2 && t.length < 60 && !t.includes("/in/")) {
          authorName = t;
        }
      }
      if (authorName !== "Unknown") break;
    }

    // ── Author headline ─────────────────────────────────────────────────
    // The headline is typically the first <p> that looks like a job title
    // (shorter text, near the top, near the author link)
    let authorHeadline = "";
    const allPs = container.querySelectorAll("p");
    for (const p of allPs) {
      const t = p.innerText?.trim() ?? "";
      // Headline heuristic: 10-150 chars, contains "|" or job-like words,
      // or is the first moderately-sized <p>
      if (t.length >= 10 && t.length <= 150 && (
        t.includes("|") || t.includes("Manager") || t.includes("Engineer") ||
        t.includes("Founder") || t.includes("CEO") || t.includes("Director") ||
        t.includes("Developer") || t.includes("Designer") || t.includes("Lead") ||
        t.includes("Helping") || t.includes("at ") || t.includes("@")
      )) {
        authorHeadline = t;
        break;
      }
    }

    // ── Post text ───────────────────────────────────────────────────────
    // Strategy: find the longest <p> element in the container.
    // The post body is almost always the longest paragraph.
    // Skip paragraphs that look like the headline (already captured above).
    let postText = "";
    let longestLen = 0;

    for (const p of allPs) {
      const t = p.innerText?.trim() ?? "";
      // Skip very short text, the headline, and action bar text
      if (t.length < 15) continue;
      if (t === authorHeadline) continue;
      if (t === authorName) continue;
      // Skip if it's inside a comment (existing comments below the post)
      const inComment = p.closest("section.comment, .comment__text");
      if (inComment) continue;

      if (t.length > longestLen) {
        longestLen = t.length;
        postText = t;
      }
    }

    // Fallback: try span[dir="ltr"] or .break-words
    if (!postText) {
      const fallbacks = container.querySelectorAll('span[dir="ltr"], .break-words');
      for (const el of fallbacks) {
        const t = el.innerText?.trim() ?? "";
        if (t.length > longestLen) { longestLen = t.length; postText = t; }
      }
    }

    const urn = container.getAttribute("data-urn") ?? "";
    console.log(TAG, "Extracted:", { authorName, postText: postText.slice(0, 60), authorHeadline: authorHeadline.slice(0, 40) });
    return { authorName, authorHeadline, postText, activityUrn: urn };
  }

  // ── React-safe paste ───────────────────────────────────────────────────────

  function pasteIntoEditor(editor, text) {
    editor.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    sel.removeAllRanges();
    sel.addRange(range);

    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    editor.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt })
    );

    setTimeout(() => {
      if ((editor.innerText?.trim() || "").length < 3) {
        console.log(TAG, "Paste fallback → execCommand");
        editor.focus();
        document.execCommand("selectAll", false, null);
        document.execCommand("insertText", false, text);
      }
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    }, 200);
  }

  // ── Wait for editor ────────────────────────────────────────────────────────

  function waitForEditor(root, timeoutMs = 6000) {
    return new Promise((resolve) => {
      const check = () =>
        root.querySelector('[contenteditable="true"]') ??
        root.querySelector('[role="textbox"]') ??
        root.querySelector(".ql-editor");

      const existing = check();
      if (existing) return resolve(existing);

      const obs = new MutationObserver(() => {
        const ed = check();
        if (ed) { obs.disconnect(); resolve(ed); }
      });
      obs.observe(root, { childList: true, subtree: true, attributes: true });
      setTimeout(() => { obs.disconnect(); resolve(null); }, timeoutMs);
    });
  }

  // ── Core click handler ─────────────────────────────────────────────────────

  async function handleDraftClick(btn, commentBtnEl) {
    if (btn.classList.contains("le-loading")) return;
    btn.classList.add("le-loading");
    btn.innerHTML = '<span class="le-spinner"></span> Drafting…';

    try {
      // 1. Extract post context
      const ctx = extractPostContext(commentBtnEl);
      if (!ctx || !ctx.postText) {
        toast("Could not read the post. Scroll so the full post is visible.", true);
        return;
      }
      console.log(TAG, "Context:", ctx.authorName, "|", ctx.postText.slice(0, 60));

      // 2. Click the Comment button to expand the editor
      commentBtnEl.click();
      console.log(TAG, "Clicked Comment button, waiting for editor…");
      await sleep(300);

      // 3. Find the feed card and wait for editor
      let feedCard = null;
      let w = commentBtnEl;
      for (let i = 0; i < 30 && w; i++) {
        w = w.parentElement;
        if (!w) break;
        if (w.querySelector('[contenteditable="true"]') || w.hasAttribute("data-urn")) {
          feedCard = w;
          break;
        }
        // Also check if it's a large container with the social bar
        if (w.querySelector('.social-action-bar, svg[id="comment-small"]') &&
            w.querySelector('.break-words, .attributed-text-segment-list__container')) {
          feedCard = w;
          break;
        }
      }

      const searchRoot = feedCard ?? document.body;
      console.log(TAG, "Searching for editor in:", searchRoot.tagName, (searchRoot.className || "").slice(0, 40));

      let editor = await waitForEditor(searchRoot, 6000);

      // Fallback: global search
      if (!editor) {
        await sleep(500);
        editor =
          document.querySelector('[contenteditable="true"]:focus') ??
          document.querySelector('[contenteditable="true"][data-placeholder]') ??
          document.querySelector('[contenteditable="true"]');
      }

      if (!editor) {
        toast("Comment editor didn't open. Try clicking Comment first, then Draft.", true);
        return;
      }

      console.log(TAG, "Editor found:", editor.tagName);

      // 4. Send to background.js → backend → Gemini
      //    background.js reads popup preferences from chrome.storage
      //    (content scripts can lose chrome.storage access after extension reload)
      toast("Generating AI comment…");

      const response = await chrome.runtime.sendMessage({
        type: "GENERATE_COMMENT",
        payload: {
          authorName:     ctx.authorName,
          authorHeadline: ctx.authorHeadline,
          postText:       ctx.postText,
          activityUrn:    ctx.activityUrn,
        },
      });

      if (response?.error) { toast(response.error, true); return; }

      if (response?.comment) {
        pasteIntoEditor(editor, response.comment);
        toast("Draft pasted! Review and hit Post.");
      } else {
        toast("No comment returned. Check extension connection.", true);
      }
    } catch (err) {
      console.error(TAG, "Draft error:", err);
      toast(`Draft failed: ${err.message}`, true);
    } finally {
      btn.classList.remove("le-loading");
      btn.innerHTML = '<span class="le-icon">&#9889;</span> Draft with AI';
    }
  }

  // ── Find the clickable comment button from the SVG icon ────────────────────

  function getCommentButton(svgEl) {
    // Walk up from the SVG to find the <button> or <a> that is clickable
    let el = svgEl;
    for (let i = 0; i < 5 && el; i++) {
      el = el.parentElement;
      if (!el) return null;
      if (el.tagName === "BUTTON" || el.tagName === "A") return el;
    }
    return null;
  }

  // ── Scan & inject ──────────────────────────────────────────────────────────

  function scanAndInject() {
    let injected = 0;

    // Strategy 1: Find SVG icons with id="comment-small" (most reliable)
    const commentSvgs = document.querySelectorAll('svg[id="comment-small"]');
    commentSvgs.forEach((svg) => {
      const commentBtn = getCommentButton(svg);
      if (!commentBtn) return;
      if (commentBtn.getAttribute(BTN_ATTR)) return;
      commentBtn.setAttribute(BTN_ATTR, "scanned");

      const btn = createButton(commentBtn);

      // Insert after the comment button's container
      // The action bar is typically the parent of the button
      const actionItem = commentBtn.parentElement;
      if (actionItem) {
        actionItem.insertAdjacentElement("afterend", btn);
      } else {
        commentBtn.insertAdjacentElement("afterend", btn);
      }
      injected++;
    });

    // Strategy 2: Fallback — a[aria-label="Comment"]
    const ariaLinks = document.querySelectorAll('a[aria-label="Comment"]');
    ariaLinks.forEach((link) => {
      if (link.getAttribute(BTN_ATTR)) return;
      link.setAttribute(BTN_ATTR, "scanned");

      const btn = createButton(link);
      link.insertAdjacentElement("afterend", btn);
      injected++;
    });

    // Strategy 3: Fallback — button[aria-label="Comment"]
    const ariaBtns = document.querySelectorAll('button[aria-label="Comment"]');
    ariaBtns.forEach((b) => {
      if (b.getAttribute(BTN_ATTR)) return;
      b.setAttribute(BTN_ATTR, "scanned");

      const btn = createButton(b);
      b.insertAdjacentElement("afterend", btn);
      injected++;
    });

    if (injected > 0) {
      console.log(TAG, `Injected ${injected} Draft button(s)`);
    }
  }

  function createButton(commentBtnEl) {
    const btn = document.createElement("button");
    btn.setAttribute(BTN_ATTR, "true");
    btn.className = "le-draft-btn";
    btn.type = "button";
    btn.innerHTML = '<span class="le-icon">&#9889;</span> Draft with AI';

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleDraftClick(btn, commentBtnEl);
    });

    return btn;
  }

  // ── MutationObserver ───────────────────────────────────────────────────────

  let scanTimer = null;
  function debouncedScan() {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(scanAndInject, 500);
  }

  const observer = new MutationObserver(() => debouncedScan());
  observer.observe(document.body, { childList: true, subtree: true });

  // Initial scans + periodic
  setTimeout(scanAndInject, 800);
  setTimeout(scanAndInject, 2500);
  setTimeout(scanAndInject, 5000);
  setInterval(scanAndInject, SCAN_INTERVAL);

  console.log(TAG, "LinkedEngage content script loaded v7");

  // ── Diagnostic ────────────────────────────────────────────────────────────
  setTimeout(() => {
    const diag = {
      commentSvgs:      document.querySelectorAll('svg[id="comment-small"]').length,
      ariaCommentLinks:  document.querySelectorAll('a[aria-label="Comment"]').length,
      ariaCommentBtns:   document.querySelectorAll('button[aria-label="Comment"]').length,
      draftButtons:      document.querySelectorAll(`[${BTN_ATTR}="true"]`).length,
    };
    console.log(TAG, "Diagnostic:", JSON.stringify(diag));
  }, 3000);
})();
