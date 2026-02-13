const path = require("path");
const fs = require("fs/promises");
const fsSync = require("fs");
const { pathToFileURL } = require("url");
let chromium;
try {
  // Prefer full Playwright if installed (it bundles browsers).
  ({ chromium } = require("playwright"));
} catch {
  // Fallback to playwright-core (requires a system browser/channel).
  ({ chromium } = require("playwright-core"));
}

const breakpoints = [320, 768, 1024, 1440];
const pageArg = process.argv[2] || "index.html";
const baseName = path.basename(pageArg, path.extname(pageArg));
const outArg = process.argv[3] || `renders/${baseName}`;

const baseDir = path.dirname(__filename);
const pagePath = path.resolve(baseDir, pageArg);
const outDir = path.resolve(baseDir, outArg);
const fileUrl = pathToFileURL(pagePath).href;

// WSL/CI environments may miss shared libs required by Playwright's bundled
// chromium_headless_shell. If we have a local lib bundle, prepend it.
const localLibDir = path.resolve(
  baseDir,
  ".tmp/playwright-libs/usr/lib/x86_64-linux-gnu",
);
if (fsSync.existsSync(localLibDir)) {
  const existing = process.env.LD_LIBRARY_PATH || "";
  process.env.LD_LIBRARY_PATH = existing ? `${localLibDir}:${existing}` : localLibDir;
}

const render = async () => {
  await fs.mkdir(outDir, { recursive: true });
  let browser;
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
  } catch {
    browser = await chromium.launch({ headless: true });
  }
  const context = await browser.newContext();

  for (const width of breakpoints) {
    const page = await context.newPage();
    await page.setViewportSize({ width, height: 900 });
    await page.goto(fileUrl, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    await page.addStyleTag({
      content: "body::before, body::after { display: none !important; }",
    });
    await page.screenshot({
      path: path.join(outDir, `${baseName}-${width}.png`),
      fullPage: true,
    });
    await page.close();
  }

  await browser.close();
};

const shouldWatch = process.argv.includes("--watch");
if (shouldWatch) {
  let running = false;
  let pending = false;
  let timer = null;
  const watchExts = new Set([
    ".html",
    ".css",
    ".js",
    ".png",
    ".jpg",
    ".jpeg",
    ".svg",
  ]);

  const trigger = () => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    render()
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        running = false;
        if (pending) {
          pending = false;
          trigger();
        }
      });
  };

  const onChange = (filename) => {
    if (!filename) return;
    const ext = path.extname(filename);
    if (!watchExts.has(ext)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(trigger, 250);
  };

  fsSync.watch(baseDir, { recursive: true }, onChange);
  trigger();
} else {
  render().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
