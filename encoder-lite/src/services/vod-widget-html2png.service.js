/**
 * Render editor text widgets to PNG via headless Chromium (same family as user preview).
 * Shared browser instance with refcount — pair ref/unref around encode segments that need HTML.
 */

/** @type {import("playwright").Browser | null} */
let browserInstance = null;
let browserRefCount = 0;
/** Serialize launch/close so concurrent encode jobs cannot corrupt shared state. */
let browserGate = Promise.resolve();

function chromiumLaunchOptions() {
  const exe = process.env.PLAYWRIGHT_CHROMIUM_PATH?.trim();
  const launchTimeout = Math.max(
    5000,
    parseInt(process.env.PLAYWRIGHT_BROWSER_LAUNCH_TIMEOUT_MS || "120000", 10) || 120000,
  );
  return {
    headless: true,
    executablePath: exe || undefined,
    timeout: launchTimeout,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-background-networking",
      "--mute-audio",
    ],
  };
}

/**
 * Default timeout for widget HTML → PNG steps (setContent / screenshot). Env: PLAYWRIGHT_WIDGET_STEP_TIMEOUT_MS
 */
function widgetStepTimeoutMs() {
  return Math.max(5000, parseInt(process.env.PLAYWRIGHT_WIDGET_STEP_TIMEOUT_MS || "25000", 10) || 25000);
}

/**
 * Increment refcount and ensure Chromium is running.
 * @returns {Promise<import("playwright").Browser>}
 */
export async function widgetRenderBrowserRef() {
  const p = browserGate.then(async () => {
    if (!browserInstance) {
      const { chromium } = await import("playwright");
      browserInstance = await chromium.launch(chromiumLaunchOptions());
    }
    browserRefCount += 1;
  });
  browserGate = p.catch(() => {});
  await p;
  return /** @type {import("playwright").Browser} */ (browserInstance);
}

/**
 * Decrement refcount; closes browser when zero.
 */
export async function widgetRenderBrowserUnref() {
  const p = browserGate.then(async () => {
    browserRefCount = Math.max(0, browserRefCount - 1);
    if (browserRefCount === 0 && browserInstance) {
      await browserInstance.close().catch(() => {});
      browserInstance = null;
    }
  });
  browserGate = p.catch(() => {});
  await p;
}

/**
 * @param {string} html
 * @returns {string}
 */
function widgetPlainText(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Matches editor preview: empty or default "New text" copy.
 * @param {string} html
 */
export function isTextWidgetPlaceholderHtml(html) {
  const t = widgetPlainText(html);
  return t === "" || t === "New text";
}

/**
 * @param {string} color
 * @returns {string}
 */
function cssSafeColor(color) {
  const s = String(color || "").trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{8})$/i.test(s)) {
    return s;
  }
  return "#ffffff";
}

/**
 * Font size in px for overlay, matching `TextWidgetBody` in editor-clip-widgets-overlay.tsx
 * (`Math.max(12, Math.min(96, (fontSizePx * viewportH) / 720))`).
 *
 * @param {number} fontSizePx
 * @param {number} viewportH
 */
export function previewFontSizePx(fontSizePx, viewportH) {
  const H = Number(viewportH) || 720;
  const fs = Number(fontSizePx) || 28;
  return Math.max(12, Math.min(96, Math.round((fs * H) / 720)));
}

/**
 * Design-space font size scaled to the output frame WITHOUT the legacy [12,96] cap, so large
 * sizes actually render large in the encode. Overflow is handled by shrink-to-fit at render time.
 * @param {number} fontSizePx
 * @param {number} viewportH
 */
export function overlayStartFontPx(fontSizePx, viewportH) {
  const H = Number(viewportH) || 720;
  const fs = Number(fontSizePx) || 28;
  return Math.max(6, Math.round((fs * H) / 720));
}

/**
 * Renders one text widget box to a transparent PNG (size = boxW × boxH).
 *
 * @param {object} opts
 * @param {import("playwright").Browser} opts.browser
 * @param {string} opts.html
 * @param {string} opts.color
 * @param {number} opts.fontSizePx design-time px (720p reference)
 * @param {number} opts.viewportH output frame height (same as editor widget viewport)
 * @param {number} opts.boxW
 * @param {number} opts.boxH
 * @param {string} opts.destPath absolute .png path
 */
export async function renderTextWidgetToPng(opts) {
  const { browser, html, color, fontSizePx, viewportH, boxW, boxH, destPath } = opts;
  const W = Math.max(2, Math.round(Number(boxW) || 2));
  const H = Math.max(2, Math.round(Number(boxH) || 2));
  const startFontPx = overlayStartFontPx(fontSizePx, viewportH);
  const c = cssSafeColor(color);
  const placeholder = isTextWidgetPlaceholderHtml(html);
  const payloadHtml = placeholder ? "<span>New text</span>" : String(html || "");

  const stepMs = widgetStepTimeoutMs();

  const shell = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      background: transparent;
      overflow: hidden;
    }
    .outer {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 12px;
      color: ${c};
      font-size: ${startFontPx}px;
      font-weight: 700;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial,
        "Noto Sans", "Liberation Sans", "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif;
      line-height: 1.375;
      text-align: center;
    }
    .inner {
      min-width: 0;
      max-width: 100%;
      word-break: break-word;
    }
    .inner * {
      max-width: 100%;
      color: inherit !important;
      font-size: inherit !important;
      font-family: inherit !important;
      line-height: inherit !important;
    }
    .inner img.emoji { height: 1em; width: 1em; vertical-align: -0.125em; }
  </style>
</head>
<body>
  <div class="outer"><div class="inner" id="content"></div></div>
</body>
</html>`;

  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  context.setDefaultTimeout(stepMs);
  context.setDefaultNavigationTimeout(stepMs);

  const page = await context.newPage();
  try {
    // User-supplied HTML may reference remote images/fonts/CDN — those fetches often stall headless Chrome in Docker.
    await page.route("**/*", (route) => {
      try {
        const u = route.request().url();
        if (/^(data:|blob:|about:)/i.test(u)) return route.continue();
      } catch {
        /* ignore */
      }
      return route.abort();
    });

    await page.setContent(shell, { waitUntil: "commit", timeout: stepMs });
    // Inject text, then shrink-to-fit so it is NEVER clipped by the box (matches editor intent).
    await page.evaluate(
      ({ h, startPx, minPx }) => {
        const outer = document.querySelector(".outer");
        const inner = document.getElementById("content");
        if (!outer || !inner) return;
        inner.innerHTML = h;
        const availW = Math.max(1, outer.clientWidth - 24);
        const availH = Math.max(1, outer.clientHeight - 24);
        let fs = startPx;
        outer.style.fontSize = fs + "px";
        for (let i = 0; i < 40; i++) {
          const ow = inner.scrollWidth;
          const oh = inner.scrollHeight;
          if ((ow <= availW && oh <= availH) || fs <= minPx) break;
          const ratio = Math.min(availW / Math.max(1, ow), availH / Math.max(1, oh));
          const next = Math.max(minPx, Math.floor(fs * Math.min(0.96, ratio || 0.96)));
          if (next === fs) break;
          fs = next;
          outer.style.fontSize = fs + "px";
        }
      },
      { h: payloadHtml, startPx: startFontPx, minPx: 6 },
    );
    await new Promise((r) => setTimeout(r, 80));
    await page.screenshot({
      path: destPath,
      type: "png",
      omitBackground: true,
      timeout: stepMs,
    });
  } finally {
    await context.close();
  }
}
