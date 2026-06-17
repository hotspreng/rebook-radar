/**
 * AUTOMATED live-search diagnostic for southwest.com.
 *
 * Unlike test-southwest-search.mjs (which has YOU drive the search), this script
 * runs the same automated steps the app's PlaywrightSouthwestClient.runSearch
 * uses — but with a visible browser and verbose, NON-swallowed logging at every
 * step, plus a selector probe of the booking form. This tells us exactly which
 * step fails (form selectors / autocomplete / fare toggle / date / submit / bot
 * challenge) instead of silently doing nothing.
 *
 * Run from the desktop workspace (it has Playwright installed):
 *
 *   cd C:\Users\jospreng\southwest-rebooker\desktop
 *   node ..\scripts\test-southwest-auto.mjs ROC MDW 2026-10-08
 *
 * Output (HTML + screenshots): <userData>\@swr\desktop\debug\
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const [, , origin = 'ROC', destination = 'MDW', date = '2026-10-08'] = process.argv;
const debugDir = join(homedir(), 'AppData', 'Roaming', '@swr', 'desktop', 'debug');
try {
  mkdirSync(debugDir, { recursive: true });
} catch {
  /* ignore */
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
let stepNo = 0;
function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}
async function shot(page, label) {
  stepNo += 1;
  const base = join(debugDir, `${stamp}_auto-${String(stepNo).padStart(2, '0')}-${label}`);
  try {
    await page.screenshot({ path: `${base}.png`, fullPage: true });
    log(`  saved screenshot: ${base}.png`);
  } catch (e) {
    log(`  screenshot failed: ${e}`);
  }
}

/** Report whether a selector exists / is visible and (optionally) its value. */
async function probe(page, label, selector) {
  const loc = page.locator(selector);
  const count = await loc.count().catch(() => 0);
  let visible = false;
  let value = '';
  if (count > 0) {
    visible = await loc.first().isVisible().catch(() => false);
    value = (await loc.first().inputValue().catch(() => '')) || '';
  }
  log(`  probe ${label.padEnd(14)} ${selector.padEnd(48)} count=${count} visible=${visible}${value ? ` value="${value}"` : ''}`);
  return { count, visible, value };
}

async function main() {
  log(`=== Southwest AUTOMATED diagnostic: ${origin} -> ${destination} @ ${date} ===`);
  log(`Output dir: ${debugDir}`);

  const launchArgs = {
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  };
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', ...launchArgs });
    log('Launched installed Chrome.');
  } catch (err) {
    log(`Chrome channel failed (${err}); trying Edge...`);
    try {
      browser = await chromium.launch({ channel: 'msedge', ...launchArgs });
      log('Launched installed Edge.');
    } catch (err2) {
      log(`Edge failed (${err2}); using bundled Chromium.`);
      browser = await chromium.launch(launchArgs);
    }
  }

  const context = await browser.newContext({
    viewport: { width: 1360, height: 950 },
    locale: 'en-US',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/149.0.0.0 Safari/537.36',
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    // eslint-disable-next-line no-undef
    window.chrome = window.chrome || { runtime: {} };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);

  log('STEP 1: navigate to /air/booking/ and wait for the form to render');
  async function loadForm() {
    await page
      .goto('https://www.southwest.com/air/booking/', { waitUntil: 'domcontentloaded', timeout: 45_000 })
      .catch((e) => log(`  nav warning: ${e}`));
    // Wait for the real form field instead of a fixed delay (handles slow loads).
    return page
      .waitForSelector('#originationAirportCode', { timeout: 30_000, state: 'visible' })
      .then(() => true, () => false);
  }
  let formReady = await loadForm();
  if (!formReady) {
    log('  form not visible; reloading once...');
    formReady = await loadForm();
  }
  log(`  url now: ${page.url()} (form ready: ${formReady})`);
  await shot(page, 'booking-loaded');

  log('STEP 2: probe form selectors');
  await probe(page, 'origin', '#originationAirportCode');
  await probe(page, 'origin(alt)', 'input[aria-label*="Depart"]');
  await probe(page, 'dest', '#destinationAirportCode');
  await probe(page, 'dest(alt)', 'input[aria-label*="Arrive"]');
  await probe(page, 'date', '#departureDate');
  await probe(page, 'submit', '#flightBookingSubmit');
  await probe(page, 'submit(alt)', '[data-test="submitField"]');
  const oneWay = await page.getByRole('radio', { name: /one-?way/i }).count().catch(() => 0);
  log(`  probe one-way radio count=${oneWay}`);
  const fareUSD = await page.locator('input[name="fareType"][value="USD"]').count().catch(() => 0);
  const farePTS = await page.locator('input[name="fareType"][value="POINTS"]').count().catch(() => 0);
  log(`  probe fareType USD=${fareUSD} POINTS=${farePTS}`);

  log('STEP 2b: dismiss cookie banner if present');
  await page
    .getByRole('button', { name: /reject all cookies/i })
    .click({ timeout: 3000 })
    .then(
      () => log('  cookies rejected'),
      () => log('  no cookie banner (or already dismissed)'),
    );
  await page.waitForTimeout(300);

  log('STEP 3: choose one-way via the Trip type dropdown');
  // Trip type is a custom dropdown: a combobox trigger showing "Round-trip" with
  // a hidden <li role="option">One-way</li> list. Open it ONCE, then click the
  // option when it becomes visible (a second trigger click would toggle it shut).
  let oneWayDone = false;
  const owLi = page.locator('li[role="option"]', { hasText: /^one-?way$/i }).first();
  const tripTrigger = page.getByRole('combobox', { name: 'Trip type options' }).first();
  for (let attempt = 0; attempt < 2 && !oneWayDone; attempt += 1) {
    await tripTrigger.click({ timeout: 5000 }).catch((e) => log(`  trigger click warn: ${e}`));
    const visible = await owLi.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false);
    if (visible) {
      await owLi.click().then(
        () => { oneWayDone = true; log('  clicked One-way option'); },
        (e) => log(`  One-way click FAILED: ${e}`),
      );
    } else {
      log(`  One-way option not visible after open (attempt ${attempt + 1})`);
    }
  }
  await page.waitForTimeout(500);
  const returnGone = (await page.locator('#returnDate, input[aria-label*="Return"]').count().catch(() => 0)) === 0;
  log(`  one-way set: ${oneWayDone} (return-date field gone: ${returnGone})`);

  log(`STEP 4: type origin "${origin}" and click the "- ${origin}" option`);
  const oInput = page.locator('#originationAirportCode');
  await oInput.click().then(() => log('  origin click OK'), (e) => log(`  origin click FAILED: ${e}`));
  await oInput.fill('').catch(() => undefined);
  await page.keyboard.type(origin, { delay: 90 });
  await page.waitForTimeout(1500);
  await shot(page, 'origin-typed');
  // Click the airport option whose visible text ends with "- ROC" (unique code).
  const oOpt = page.getByRole('option', { name: new RegExp(`-\\s*${origin}\\b`, 'i') }).first();
  await oOpt.click().then(
    () => log(`  clicked origin option for ${origin}`),
    (e) => log(`  origin option click FAILED: ${e}`),
  );
  await page.waitForTimeout(500);
  await probe(page, 'origin-after', '#originationAirportCode');

  log(`STEP 5: type destination "${destination}" and click the "- ${destination}" option`);
  const dInput = page.locator('#destinationAirportCode');
  await dInput.click().then(() => log('  dest click OK'), (e) => log(`  dest click FAILED: ${e}`));
  await dInput.fill('').catch(() => undefined);
  await page.keyboard.type(destination, { delay: 90 });
  await page.waitForTimeout(1500);
  await shot(page, 'dest-typed');
  const dOpt = page.getByRole('option', { name: new RegExp(`-\\s*${destination}\\b`, 'i') }).first();
  await dOpt.click().then(
    () => log(`  clicked dest option for ${destination}`),
    (e) => log(`  dest option click FAILED: ${e}`),
  );
  await page.waitForTimeout(500);
  await probe(page, 'dest-after', '#destinationAirportCode');

  log('STEP 6: set fare type = POINTS (click label, not the tabindex=-1 radio)');
  // The radio is tabindex=-1; clicking it doesn't toggle. Click its label.
  const ptsRadio = page.locator('input[name="fareType"][value="POINTS"]').first();
  const labelledBy = await ptsRadio.getAttribute('aria-labelledby').catch(() => null);
  let pointsDone = false;
  if (labelledBy) {
    await page.locator(`#${labelledBy}`).click().then(
      () => { pointsDone = true; },
      (e) => log(`  POINTS label click FAILED: ${e}`),
    );
  }
  if (!pointsDone) {
    // Fallback: click the visible "Points" toggle text.
    await page.getByText(/^points$/i).first().click().then(
      () => { pointsDone = true; },
      (e) => log(`  POINTS text click FAILED: ${e}`),
    );
  }
  const ptsChecked = await ptsRadio.getAttribute('aria-checked').catch(() => null);
  log(`  POINTS set: ${pointsDone} aria-checked=${ptsChecked}`);

  log(`STEP 7: type date ${date} then close the calendar`);
  const [, mm = '', dd = ''] = date.split('-');
  const dateInput = page.locator('#departureDate');
  await dateInput.click().then(() => log('  date click OK'), (e) => log(`  date click FAILED: ${e}`));
  await dateInput.fill('').catch(() => undefined);
  await page.keyboard.type(`${mm}${dd}`, { delay: 60 });
  await page.waitForTimeout(400);
  // Close the date picker so it stops covering the Search button.
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(300);
  await probe(page, 'date-after', '#departureDate');
  await shot(page, 'form-filled');

  log('STEP 8: submit search (REAL mouse click — generates Akamai sensor data)');
  // Akamai Bot Manager fingerprints behavior: a programmatic el.click() with no
  // mouse movement gets the results page soft-blocked (renders blank). A real
  // Playwright click moves the mouse to the element and dispatches trusted
  // events. The calendar is already closed by now, so nothing intercepts it.
  const submitBtn = page.locator('#flightBookingSubmit').first();
  // Nudge the mouse around first so the sensor sees human-like movement.
  await page.mouse.move(400, 300, { steps: 8 }).catch(() => undefined);
  await page.mouse.move(700, 500, { steps: 12 }).catch(() => undefined);
  await submitBtn.scrollIntoViewIfNeeded().catch(() => undefined);
  await submitBtn.click({ timeout: 8000 }).then(
    () => log('  submit real-click OK'),
    async (e) => {
      log(`  submit real-click FAILED (${e}); retrying with force`);
      await submitBtn.click({ force: true, timeout: 8000 }).catch((e2) => log(`  force click FAILED: ${e2}`));
    },
  );

  log('STEP 9: wait for results, up to 90s (broad selector set)');
  // Try several candidate result containers — the class may have changed.
  const resultSelectors = [
    '.air-booking-select-detail',
    '[data-test="fare-button--basic"]',
    'li[class*="air-booking-select-card"]',
    '[class*="select-detail"]',
    '[aria-label*="Information for flight number"]',
  ];
  let got = false;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && !got) {
    for (const sel of resultSelectors) {
      const n = await page.locator(sel).count().catch(() => 0);
      if (n > 0) {
        got = true;
        log(`  results appeared via "${sel}" (count=${n})`);
        break;
      }
    }
    if (!got) await page.waitForTimeout(2000);
  }
  log(`  results appeared: ${got}`);
  await page.waitForTimeout(1500);
  log(`  url now: ${page.url()}`);
  await shot(page, 'after-submit');

  // Report counts for every candidate so we can pick the live selector.
  for (const sel of resultSelectors) {
    const n = await page.locator(sel).count().catch(() => 0);
    log(`  count ${sel} = ${n}`);
  }

  // Save final HTML for selector tuning.
  try {
    const html = await page.content();
    const f = join(debugDir, `${stamp}_auto-final.html`);
    writeFileSync(f, html, 'utf8');
    log(`  saved final HTML: ${f}`);
  } catch (e) {
    log(`  HTML save failed: ${e}`);
  }

  log('Leaving browser open 60s so you can inspect. Ctrl+C to exit early.');
  await page.waitForTimeout(60_000);
  await browser.close();
  log('Done.');
}

main().catch((err) => {
  console.error('Diagnostic failed:', err);
  process.exit(1);
});
