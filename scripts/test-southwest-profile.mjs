/**
 * Persistent-profile live-search test for southwest.com.
 *
 * Southwest's Akamai Bot Manager blocks a fully-automated Search submit when the
 * browser context is "cold" (no trusted _abck/bm_sz cookies). The fix: drive a
 * DEDICATED persistent Chrome profile (its own user-data-dir, NOT your everyday
 * Chrome profile). You warm it once by doing a single manual search; Akamai then
 * trusts the profile, and subsequent AUTOMATED searches in the same profile are
 * allowed.
 *
 * Run from the desktop workspace (it has Playwright installed):
 *
 *   # 1) Warm the profile (do ONE manual search, solve any Press & Hold):
 *   node ..\scripts\test-southwest-profile.mjs warmup
 *
 *   # 2) Then test fully-automated search reusing the warmed profile:
 *   node ..\scripts\test-southwest-profile.mjs auto ROC MDW 2026-10-08
 *
 * Profile dir:  <userData>\@swr\desktop\scraper-profile
 * Output dir:   <userData>\@swr\desktop\debug
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import readline from 'node:readline';

const mode = (process.argv[2] || 'auto').toLowerCase();
const [, , , origin = 'ROC', destination = 'MDW', date = '2026-10-08'] = process.argv;

const baseDir = join(homedir(), 'AppData', 'Roaming', '@swr', 'desktop');
const profileDir = join(baseDir, 'scraper-profile');
const debugDir = join(baseDir, 'debug');
for (const d of [profileDir, debugDir]) {
  try {
    mkdirSync(d, { recursive: true });
  } catch {
    /* ignore */
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
let stepNo = 0;
function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}
async function shot(page, label) {
  stepNo += 1;
  const base = join(debugDir, `${stamp}_profile-${String(stepNo).padStart(2, '0')}-${label}`);
  try {
    await page.screenshot({ path: `${base}.png`, fullPage: true });
    log(`  saved screenshot: ${base}.png`);
  } catch (e) {
    log(`  screenshot failed: ${e}`);
  }
}
function waitForEnter(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, () => { rl.close(); resolve(); }));
}

/** Launch the dedicated persistent profile (installed Chrome, anti-detection). */
async function launchProfile(headless) {
  const launchArgs = {
    headless,
    viewport: { width: 1360, height: 950 },
    locale: 'en-US',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/149.0.0.0 Safari/537.36',
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  };
  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, { channel: 'chrome', ...launchArgs });
    log('Launched installed Chrome (persistent profile).');
  } catch (err) {
    log(`Chrome channel failed (${err}); trying Edge...`);
    try {
      context = await chromium.launchPersistentContext(profileDir, { channel: 'msedge', ...launchArgs });
      log('Launched installed Edge (persistent profile).');
    } catch (err2) {
      log(`Edge failed (${err2}); using bundled Chromium.`);
      context = await chromium.launchPersistentContext(profileDir, launchArgs);
    }
  }
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    // eslint-disable-next-line no-undef
    window.chrome = window.chrome || { runtime: {} };
  });
  return context;
}

async function fillForm(page) {
  // STEP: trip type One-way
  const owLi = page.locator('li[role="option"]', { hasText: /^one-?way$/i }).first();
  const tripTrigger = page.getByRole('combobox', { name: 'Trip type options' }).first();
  let oneWayDone = false;
  for (let attempt = 0; attempt < 2 && !oneWayDone; attempt += 1) {
    await tripTrigger.click({ timeout: 5000 }).catch(() => undefined);
    const visible = await owLi.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false);
    if (visible) await owLi.click().then(() => { oneWayDone = true; }, () => undefined);
  }
  log(`  one-way set: ${oneWayDone}`);

  // STEP: origin
  const oInput = page.locator('#originationAirportCode');
  await oInput.click().catch(() => undefined);
  await oInput.fill('').catch(() => undefined);
  await page.keyboard.type(origin, { delay: 90 });
  await page.waitForTimeout(1500);
  await page.getByRole('option', { name: new RegExp(`-\\s*${origin}\\b`, 'i') }).first().click().catch(() => undefined);

  // STEP: destination
  const dInput = page.locator('#destinationAirportCode');
  await dInput.click().catch(() => undefined);
  await dInput.fill('').catch(() => undefined);
  await page.keyboard.type(destination, { delay: 90 });
  await page.waitForTimeout(1500);
  await page.getByRole('option', { name: new RegExp(`-\\s*${destination}\\b`, 'i') }).first().click().catch(() => undefined);

  // STEP: fare = POINTS (click label of the tabindex=-1 radio)
  const ptsRadio = page.locator('input[name="fareType"][value="POINTS"]').first();
  const labelledBy = await ptsRadio.getAttribute('aria-labelledby').catch(() => null);
  if (labelledBy) await page.locator(`#${labelledBy}`).click().catch(() => undefined);
  const ptsChecked = await ptsRadio.getAttribute('aria-checked').catch(() => null);
  log(`  POINTS aria-checked=${ptsChecked}`);

  // STEP: date MMDD, then close calendar
  const [, mm = '', dd = ''] = date.split('-');
  const dateInput = page.locator('#departureDate');
  await dateInput.click().catch(() => undefined);
  await dateInput.fill('').catch(() => undefined);
  await page.keyboard.type(`${mm}${dd}`, { delay: 60 });
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(300);
}

async function waitForResults(page, ms) {
  const selectors = [
    '.air-booking-select-detail',
    '[data-test="fare-button--basic"]',
    'li[class*="air-booking-select-card"]',
    '[class*="select-detail"]',
    '[aria-label*="Information for flight number"]',
  ];
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      const n = await page.locator(sel).count().catch(() => 0);
      if (n > 0) {
        log(`  results via "${sel}" count=${n}`);
        return sel;
      }
    }
    await page.waitForTimeout(2000);
  }
  return null;
}

async function main() {
  log(`=== Persistent-profile test (mode=${mode}) ===`);
  log(`Profile: ${profileDir}`);

  if (mode === 'warmup') {
    const context = await launchProfile(false);
    const page = context.pages()[0] ?? (await context.newPage());
    page.setDefaultTimeout(20_000);
    await page.goto('https://www.southwest.com/air/booking/', { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    console.log('\n>>> WARM-UP: in the Chrome window, do ONE search by hand:');
    console.log(`    One-way, ${origin} -> ${destination}, Points, any near date.`);
    console.log('    Solve any "Press & Hold" challenge and let the flight list load.');
    console.log('    This stores Akamai trust cookies in the dedicated profile.\n');
    await waitForEnter('Press ENTER once you SEE the flight prices (then it saves & closes)... ');
    await shot(page, 'warmup-results');
    await context.close();
    log('Profile warmed. Now run: node ..\\scripts\\test-southwest-profile.mjs auto ROC MDW 2026-10-08');
    return;
  }

  // AUTO mode: fully automated search reusing the warmed profile.
  const context = await launchProfile(false); // headful so we can watch; set true to test headless later
  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(12_000);

  log('Navigating to /air/booking/');
  await page.goto('https://www.southwest.com/air/booking/', { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch((e) => log(`  nav warn: ${e}`));
  const formReady = await page.waitForSelector('#originationAirportCode', { timeout: 30_000, state: 'visible' }).then(() => true, () => false);
  log(`  form ready: ${formReady}`);
  // Dismiss cookie banner if present.
  await page.getByRole('button', { name: /reject all cookies/i }).click({ timeout: 3000 }).catch(() => undefined);

  log('Filling form...');
  await fillForm(page);
  await shot(page, 'form-filled');

  log('Submitting (real mouse click)...');
  const submitBtn = page.locator('#flightBookingSubmit').first();
  await page.mouse.move(400, 300, { steps: 8 }).catch(() => undefined);
  await page.mouse.move(700, 500, { steps: 12 }).catch(() => undefined);
  await submitBtn.scrollIntoViewIfNeeded().catch(() => undefined);
  await submitBtn.click({ timeout: 8000 }).catch(async () => {
    await submitBtn.click({ force: true, timeout: 8000 }).catch(() => undefined);
  });

  log('Waiting for results (up to 90s)...');
  const sel = await waitForResults(page, 90_000);
  await page.waitForTimeout(1500);
  log(`  url now: ${page.url()}`);
  await shot(page, 'after-submit');
  log(`  RESULT: ${sel ? `RENDERED via ${sel}` : 'BLOCKED / blank (no results)'}`);

  try {
    const html = await page.content();
    const f = join(debugDir, `${stamp}_profile-final.html`);
    writeFileSync(f, html, 'utf8');
    log(`  saved final HTML: ${f}`);
  } catch (e) {
    log(`  HTML save failed: ${e}`);
  }

  log('Leaving browser open 30s. Ctrl+C to exit early.');
  await page.waitForTimeout(30_000);
  await context.close();
  log('Done.');
}

main().catch((err) => {
  console.error('Profile test failed:', err);
  process.exit(1);
});
