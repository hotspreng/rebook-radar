/**
 * Interactive live-search capture for southwest.com.
 *
 * Southwest's form is a custom React widget that errors on deep-link prefills
 * and is fragile to automate blind. So this harness opens a real Chrome window
 * on the booking page and lets YOU run the search by hand (you know the site).
 * When the flight prices are on screen you press ENTER, and it captures the
 * rendered results (HTML + screenshot) and probes candidate selectors so we can
 * wire the real scraper to the live DOM.
 *
 * Run from the desktop workspace (it has Playwright installed):
 *
 *   cd C:\Users\jospreng\southwest-rebooker\desktop
 *   node ..\scripts\test-southwest-search.mjs
 *
 * Optional args (only used to name the output file): <origin> <destination> <date>
 *
 * Output: <userData>\@swr\desktop\debug\
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import readline from 'node:readline';

const [, , origin = 'ROC', destination = 'MDW', date = '2026-10-08'] = process.argv;

const debugDir = join(homedir(), 'AppData', 'Roaming', '@swr', 'desktop', 'debug');
try {
  mkdirSync(debugDir, { recursive: true });
} catch {
  /* ignore */
}

/** Candidate selectors to probe so we can see which ones the live page uses. */
const CANDIDATE_FARE_SELECTORS = [
  '[data-qa="fare-button"]',
  '.fare-button',
  '.air-booking-select-detail',
  '[class*="fare-button"]',
  '[class*="select-detail"]',
  'button[aria-label*="Wanna Get Away"]',
  'button[aria-label*="points"]',
  'li[class*="air-booking-select-card"]',
];
const CANDIDATE_PRICE_SELECTORS = [
  '.currency',
  '[data-qa="price"]',
  '.points',
  '[data-qa="points"]',
  '[class*="currency"]',
  '[class*="price"]',
  'span[aria-label*="points"]',
];

function waitForEnter(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, () => { rl.close(); resolve(); }));
}

async function main() {
  console.log(`\n=== Southwest interactive capture ===`);
  console.log(`Output: ${debugDir}\n`);

  let browser;
  // Anti-detection: hide the automation flags Akamai/Bot-Manager keys on.
  const launchArgs = {
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
    // Removing this default arg drops the "Chrome is being controlled by
    // automated test software" banner and the navigator.webdriver=true signal.
    ignoreDefaultArgs: ['--enable-automation'],
  };
  try {
    browser = await chromium.launch({ channel: 'chrome', ...launchArgs });
  } catch (err) {
    console.warn(`Chrome channel failed (${err}); trying Edge...`);
    try {
      browser = await chromium.launch({ channel: 'msedge', ...launchArgs });
    } catch (err2) {
      console.warn(`Edge failed too (${err2}); falling back to bundled Chromium.`);
      browser = await chromium.launch(launchArgs);
    }
  }

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/149.0.0.0 Safari/537.36',
  });
  // Mask the remaining automation fingerprints before any page script runs.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    // A couple of properties headless/automated Chrome commonly lacks.
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    // eslint-disable-next-line no-undef
    window.chrome = window.chrome || { runtime: {} };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);

  console.log('Opening the Southwest booking page...');
  await page
    .goto('https://www.southwest.com/air/booking/', { waitUntil: 'domcontentloaded' })
    .catch((e) => console.warn('Navigation warning:', String(e)));

  console.log('\n>>> In the Chrome window, run the search YOURSELF:');
  console.log(`    - One-way, ${origin} -> ${destination}, depart ${date}`);
  console.log('    - Set the fare toggle to "Points"');
  console.log('    - Click Search and solve any "Press & Hold" challenge');
  console.log('    - Wait until the flight list with points prices is visible');
  console.log('    Then come back here and press ENTER to capture.\n');
  await waitForEnter('Press ENTER once the flight prices are on screen... ');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = join(debugDir, `${stamp}_results_${origin}-${destination}`);

  try {
    const html = await page.content();
    writeFileSync(`${base}.html`, html, 'utf8');
    console.log(`Saved HTML:       ${base}.html`);
  } catch (e) {
    console.warn('Could not save HTML:', String(e));
  }
  try {
    await page.screenshot({ path: `${base}.png`, fullPage: true });
    console.log(`Saved screenshot: ${base}.png`);
  } catch (e) {
    console.warn('Could not save screenshot:', String(e));
  }

  console.log(`\n--- Selector probe (fare containers) ---`);
  for (const sel of CANDIDATE_FARE_SELECTORS) {
    const count = await page.locator(sel).count().catch(() => 0);
    if (count > 0) console.log(`  [${count}]  ${sel}`);
  }
  console.log(`--- Selector probe (price text) ---`);
  for (const sel of CANDIDATE_PRICE_SELECTORS) {
    const count = await page.locator(sel).count().catch(() => 0);
    if (count > 0) {
      const sample = (await page.locator(sel).first().textContent().catch(() => '') || '').trim();
      console.log(`  [${count}]  ${sel}   e.g. "${sample.slice(0, 40)}"`);
    }
  }

  // Dump any text that looks like a price or points value, with a nearby label.
  console.log(`\n--- Text matches that look like fares ---`);
  const fareTexts = await page
    .$$eval('*', (nodes) => {
      const out = [];
      const re = /(\$\s?\d{1,4}(?:\.\d{2})?|\b\d{1,3}(?:,\d{3})*\s*(?:pts|points)\b)/i;
      for (const n of nodes) {
        if (n.children.length === 0) {
          const t = (n.textContent || '').trim();
          if (t && re.test(t) && t.length < 30) out.push(t);
        }
      }
      return Array.from(new Set(out)).slice(0, 40);
    })
    .catch(() => []);
  for (const t of fareTexts) console.log(`  ${t}`);

  console.log(`\nDone. Inspect the HTML/screenshot above to tune selectors.`);
  await waitForEnter('Press ENTER to close the browser... ');
  await browser.close();
}

main().catch((err) => {
  console.error('Harness failed:', err);
  process.exit(1);
});
