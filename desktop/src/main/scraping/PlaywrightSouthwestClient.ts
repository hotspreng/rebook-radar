import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AccountCredentials,
  FlightSearchQuery,
  RawFareOption,
  RawTrip,
  SouthwestClientSession,
  SouthwestScraperClient,
} from '@swr/core';
import { logger, PurchaseType } from '@swr/core';

// Types are imported lazily to keep playwright optional at runtime.
type Browser = import('playwright').Browser;
type BrowserContext = import('playwright').BrowserContext;
type Page = import('playwright').Page;

const log = logger.child('playwright');

export interface PlaywrightClientOptions {
  baseUrl: string;
  headful: boolean;
  timeoutMs: number;
  /**
   * Browser channel to use, e.g. 'chrome' or 'msedge'. When set, Playwright
   * drives the user's installed browser instead of the bundled Chromium build.
   * A real Chrome/Edge is less likely to trip Southwest's bot defenses and
   * avoids the large `playwright install` download.
   */
  channel?: 'chrome' | 'msedge';
  /** Directory for debug screenshots/HTML dumps. */
  debugDir?: string;
  /**
   * Dedicated persistent browser-profile directory. When set, searches run in a
   * long-lived profile (its own user-data-dir, NOT the user's everyday Chrome)
   * so Southwest's Akamai bot manager keeps its trust cookies across runs and
   * doesn't block automated searches. Warm it once with a manual search.
   */
  profileDir?: string;
  /** When true, capture screenshots + HTML at each step for selector tuning. */
  debugMode?: boolean;
  /**
   * When true (recommended with headful), the user completes login + any
   * "Press & Hold" bot challenge manually; automation waits until it detects a
   * logged-in state before continuing. Avoids tripping Southwest's bot defense.
   */
  assistedLogin?: boolean;
  /** How long (ms) to wait for the user to finish an assisted login. */
  assistedLoginTimeoutMs?: number;
}

interface InternalSession {
  context: BrowserContext;
  page: Page;
}

/**
 * Playwright-backed {@link SouthwestScraperClient}.
 *
 * ⚠️  IMPORTANT / LEGAL & RELIABILITY NOTES
 *  - Southwest does not offer a public API. This automates the website on the
 *    user's behalf using their own credentials. Automated access may violate
 *    Southwest's Terms of Use and can break at any time when the site changes.
 *  - The CSS selectors below are best-effort and WILL need maintenance. They are
 *    centralized in `SELECTORS` so they are easy to update.
 *  - Never log credentials. Page text is only used to detect CAPTCHA / failures.
 *
 * If Playwright or its browsers are not installed, construction/usage throws and
 * the app falls back to the FakeSouthwestScraperClient.
 */
export class PlaywrightSouthwestClient implements SouthwestScraperClient {
  private browser: Browser | null = null;
  private persistentContext: BrowserContext | null = null;
  private readonly sessions = new Map<string, InternalSession>();
  /** Epoch ms of the last search submit, used to pace back-to-back searches so
   * Southwest's Akamai sensor doesn't flag rapid automated requests. */
  private lastSearchAt = 0;
  /** Minimum gap between consecutive search submits (ms). */
  private static readonly MIN_SEARCH_GAP_MS = 6000;

  constructor(private readonly options: PlaywrightClientOptions) {}

  private static readonly SELECTORS = {
    // Login
    loginButton: 'button[aria-label="Log in"], #login-form, a[href*="login"]',
    usernameInput: 'input[name="userNameOrAccountNumber"], #userNameOrAccountNumber',
    passwordInput: 'input[name="password"], #password',
    submitLogin: 'button#login-form--submit-button, button[type="submit"]',
    // My Trips
    tripCard: '[data-qa="trip-card"], .trip-card, li.air-reservation',
    tripConfirmation: '[data-qa="confirmation-number"], .confirmation-number',
    tripRoute: '[data-qa="trip-route"], .trip-route',
    // Search
    originInput: 'input#originationAirportCode, input[aria-label*="Depart"]',
    destInput: 'input#destinationAirportCode, input[aria-label*="Arrive"]',
    dateInput: 'input#departureDate, input[aria-label*="Depart date"]',
    searchSubmit: 'button#form-mixin--submit-button, button[type="submit"]',
    fareCard: '[data-qa="fare-button"], .fare-button, .air-booking-select-detail',
    fareCash: '.currency, [data-qa="price"]',
    farePoints: '.points, [data-qa="points"]',
  };

  /** Cached, stealth-enabled chromium (shared across all launches). */
  private static stealthChromium: typeof import('playwright').chromium | null = null;

  /**
   * Load a chromium launcher with the puppeteer-extra stealth evasions applied
   * (via playwright-extra). The stealth plugin patches many automation tells
   * Akamai/Bot-Manager fingerprints (navigator.webdriver, chrome.runtime,
   * permissions, WebGL vendor, plugins, etc.) at a deeper level than our
   * STEALTH_INIT script. Falls back to plain playwright if the extra packages
   * are missing so scraping still degrades gracefully.
   */
  private async loadChromium(): Promise<typeof import('playwright').chromium> {
    if (PlaywrightSouthwestClient.stealthChromium) {
      return PlaywrightSouthwestClient.stealthChromium;
    }
    let chromium: typeof import('playwright').chromium;
    try {
      const extra = (await import('playwright-extra')) as unknown as {
        chromium: typeof import('playwright').chromium & { use(plugin: unknown): void };
      };
      const stealth = ((await import('puppeteer-extra-plugin-stealth')) as unknown as {
        default: () => unknown;
      }).default;
      extra.chromium.use(stealth());
      chromium = extra.chromium;
      log.info('Stealth chromium loaded (playwright-extra + stealth plugin).');
    } catch (err) {
      log.warn('playwright-extra/stealth unavailable; using plain playwright', {
        error: String(err),
      });
      ({ chromium } = await import('playwright'));
    }
    PlaywrightSouthwestClient.stealthChromium = chromium;
    return chromium;
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser) return this.browser;
    let chromium;
    try {
      chromium = await this.loadChromium();
    } catch (err) {
      throw new Error(
        'Playwright is not installed. Run "npx playwright install chromium" or disable scraping.',
      );
    }
    const launchOptions: import('playwright').LaunchOptions = {
      headless: !this.options.headful,
      // Anti-detection: drop Playwright's default automation flag. We do NOT add
      // --disable-blink-features=AutomationControlled: it shows a visible
      // "unsupported command-line flag" infobar (itself a bot tell). The
      // STEALTH_INIT init script masks navigator.webdriver instead.
      ignoreDefaultArgs: ['--enable-automation'],
      // Keep the OS sandbox ON. Playwright disables it by default, which adds
      // the "--no-sandbox" flag and a visible "unsupported command-line flag"
      // infobar — a strong automation signal anti-bot systems read.
      chromiumSandbox: true,
    };
    // Prefer a real installed browser when a channel is configured; this avoids
    // the bundled-Chromium download and is harder for anti-bot systems to flag.
    if (this.options.channel) {
      launchOptions.channel = this.options.channel;
    }
    try {
      this.browser = await chromium.launch(launchOptions);
    } catch (err) {
      if (this.options.channel) {
        // Fall back to bundled Chromium if the requested channel isn't present.
        log.warn('Channel launch failed; falling back to bundled Chromium', {
          channel: this.options.channel,
          error: String(err),
        });
        this.browser = await chromium.launch({
          headless: !this.options.headful,
          ignoreDefaultArgs: ['--enable-automation'],
          chromiumSandbox: true,
        });
      } else {
        throw err;
      }
    }
    return this.browser;
  }

  /**
   * Stealth init script: mask the automation fingerprints Akamai keys on. Shared
   * by the persistent context and the per-session stealth contexts.
   */
  private static readonly STEALTH_INIT = (): void => {
    const g = globalThis as unknown as {
      navigator: Record<string, unknown>;
      chrome?: unknown;
    };
    Object.defineProperty(g.navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(g.navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(g.navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    g.chrome = g.chrome || { runtime: {} };
  };

  private static readonly USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/149.0.0.0 Safari/537.36';

  /**
   * Get a browser context for searches. When a `profileDir` is configured this
   * returns a single shared persistent context (warmed Akamai cookies survive
   * across runs, defeating the automated-search block). Otherwise it falls back
   * to a fresh stealth context on a normal (non-persistent) browser.
   */
  private async ensureContext(): Promise<{ context: BrowserContext; persistent: boolean }> {
    if (!this.options.profileDir) {
      const browser = await this.ensureBrowser();
      return { context: await this.newStealthContext(browser), persistent: false };
    }
    if (this.persistentContext) return { context: this.persistentContext, persistent: true };

    let chromium;
    try {
      chromium = await this.loadChromium();
    } catch {
      throw new Error(
        'Playwright is not installed. Run "npx playwright install chromium" or disable scraping.',
      );
    }
    const launchArgs: import('playwright').BrowserContextOptions &
      import('playwright').LaunchOptions = {
      headless: !this.options.headful,
      viewport: { width: 1360, height: 950 },
      locale: 'en-US',
      userAgent: PlaywrightSouthwestClient.USER_AGENT,
      ignoreDefaultArgs: ['--enable-automation'],
      chromiumSandbox: true,
    };
    const dir = this.options.profileDir;
    let context: BrowserContext;
    try {
      context = await chromium.launchPersistentContext(dir, {
        channel: this.options.channel ?? 'chrome',
        ...launchArgs,
      });
    } catch (err) {
      log.warn('Persistent context launch failed; trying bundled Chromium', {
        error: String(err),
      });
      context = await chromium.launchPersistentContext(dir, launchArgs);
    }
    // If the context closes for any reason (user closes the headful window, a
    // crash, or Akamai), drop our reference so the next search relaunches it.
    // Without this we'd keep reusing a dead context and every subsequent search
    // would fail with "Target page, context or browser has been closed".
    context.on('close', () => {
      if (this.persistentContext === context) this.persistentContext = null;
    });
    await context.addInitScript(PlaywrightSouthwestClient.STEALTH_INIT);
    this.persistentContext = context;
    return { context, persistent: true };
  }

  /**
   * Open the dedicated scraper profile headfully on the booking page so the user
   * can complete ONE manual search. This warms Akamai's trust cookies (_abck/
   * bm_sz) in the persistent profile; once warmed, automated searches reusing
   * the same profile are no longer blocked. Resolves when the user reaches the
   * results page or closes the window (cookies flush to disk on close).
   */
  async warmupProfile(timeoutMs = 300_000): Promise<{ warmed: boolean }> {
    const dir = this.options.profileDir;
    if (!dir) throw new Error('No scraper profile directory is configured.');

    // Free the profile dir: only one Chromium may open it at a time.
    if (this.persistentContext) {
      await this.persistentContext.close().catch(() => undefined);
      this.persistentContext = null;
    }

    let chromium;
    try {
      chromium = await this.loadChromium();
    } catch {
      throw new Error(
        'Playwright is not installed. Run "npx playwright install chromium" or disable scraping.',
      );
    }

    const launchArgs: import('playwright').BrowserContextOptions &
      import('playwright').LaunchOptions = {
      headless: false,
      viewport: { width: 1360, height: 950 },
      locale: 'en-US',
      userAgent: PlaywrightSouthwestClient.USER_AGENT,
      ignoreDefaultArgs: ['--enable-automation'],
      chromiumSandbox: true,
    };

    let context: BrowserContext;
    try {
      context = await chromium.launchPersistentContext(dir, {
        channel: this.options.channel ?? 'chrome',
        ...launchArgs,
      });
    } catch (err) {
      log.warn('Persistent warmup launch failed; trying bundled Chromium', {
        error: String(err),
      });
      context = await chromium.launchPersistentContext(dir, launchArgs);
    }

    try {
      await context.addInitScript(PlaywrightSouthwestClient.STEALTH_INIT);
      const page = context.pages()[0] ?? (await context.newPage());

      // The profile can accumulate a FLAGGED Akamai session (a "blocked" _abck
      // cookie + bot tokens in storage) from earlier failed automated runs.
      // Once poisoned, even a manual search in this warmed browser returns the
      // "we found some errors / no results" page. If — and only if — the profile
      // already holds cookies, wipe them + site storage so the homepage issues a
      // fresh, clean Akamai handshake. On a brand-new (empty) profile we must NOT
      // wipe: that would strip the good cookies the first page load establishes.
      const existing = await context.cookies().catch(() => []);
      if (existing.length > 0) {
        log.info('Warmup: clearing existing profile cookies/storage before re-warm', {
          cookieCount: existing.length,
        });
        await context.clearCookies().catch(() => undefined);
        await page
          .goto(`${this.options.baseUrl}/`, { waitUntil: 'domcontentloaded' })
          .catch(() => undefined);
        await page
          .evaluate(() => {
            try {
              (globalThis as unknown as { localStorage?: { clear(): void } }).localStorage?.clear();
              (
                globalThis as unknown as { sessionStorage?: { clear(): void } }
              ).sessionStorage?.clear();
            } catch {
              /* ignore */
            }
          })
          .catch(() => undefined);
        await context.clearCookies().catch(() => undefined);
      }

      await page
        .goto(`${this.options.baseUrl}/air/booking/`, { waitUntil: 'domcontentloaded' })
        .catch(() => undefined);

      // Resolve when the user reaches a results page OR closes the browser.
      const closed = new Promise<void>((resolve) => context.once('close', () => resolve()));
      const reachedResults = page
        .waitForURL(/select-depart|air\/booking\/select/i, { timeout: timeoutMs })
        .then(() => undefined)
        .catch(() => undefined);
      await Promise.race([reachedResults, closed]);
    } finally {
      // Closing flushes the warmed cookies to the profile dir on disk.
      await context.close().catch(() => undefined);
    }
    return { warmed: true };
  }

  async login(
    credentials: AccountCredentials,
    accountId: string,
  ): Promise<{ session: SouthwestClientSession; pageText: string }> {
    const browser = await this.ensureBrowser();
    const context = await this.newStealthContext(browser);
    const page = await context.newPage();
    page.setDefaultTimeout(this.options.timeoutMs);

    log.info('Navigating to login', { accountId });
    await page.goto(`${this.options.baseUrl}/loginout`, { waitUntil: 'domcontentloaded' });
    await this.snapshot(page, 'login-page');

    const S = PlaywrightSouthwestClient.SELECTORS;

    if (this.options.assistedLogin) {
      // Pre-fill the username to save the user a step, then let them type the
      // password and clear any bot challenge themselves.
      await this.fillFirst(page, S.usernameInput, credentials.username);
      log.info('Assisted login: waiting for user to sign in', { accountId });
      await this.waitForLoggedIn(page);
    } else {
      await this.fillFirst(page, S.usernameInput, credentials.username);
      await this.fillFirst(page, S.passwordInput, credentials.password);
      await this.clickFirst(page, S.submitLogin);
      await page.waitForLoadState('networkidle').catch(() => undefined);
    }

    await this.snapshot(page, 'after-login');
    const pageText = await this.bodyText(page);
    this.sessions.set(accountId, { context, page });
    return { session: { accountId, handle: { accountId } }, pageText };
  }

  async fetchTrips(
    session: SouthwestClientSession,
  ): Promise<{ trips: RawTrip[]; pageText: string }> {
    const internal = this.require(session.accountId);
    const { page } = internal;
    await page.goto(`${this.options.baseUrl}/air/manage-reservation/upcoming-trips.html`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await this.snapshot(page, 'upcoming-trips');

    const S = PlaywrightSouthwestClient.SELECTORS;
    const trips: RawTrip[] = await page
      .$$eval(
        S.tripCard,
        (cards) =>
          cards.map((card) => {
            const text = (sel: string) =>
              (card.querySelector(sel)?.textContent ?? '').trim() || undefined;
            const conf = text('[data-qa="confirmation-number"], .confirmation-number') ?? '';
            const route = text('[data-qa="trip-route"], .trip-route') ?? '';
            const [origin = '', destination = ''] = route
              .split(/\s*(?:to|→|–|—|->)\s*/i)
              .map((s: string) => s.trim());
            return {
              confirmationNumber: conf,
              passengerNames: [] as string[],
              origin,
              destination,
              departureDateTime:
                card.querySelector('time')?.getAttribute('datetime') ?? '',
              fareLabel: text('[data-qa="fare-type"], .fare-type'),
              priceText: text('[data-qa="price"], .price'),
              pointsText: text('[data-qa="points"], .points'),
              taxesText: text('[data-qa="taxes"], .taxes'),
            };
          }),
      )
      .catch(() => [] as RawTrip[]);

    return { trips, pageText: await this.bodyText(page) };
  }

  async searchFlights(
    query: FlightSearchQuery,
    session?: SouthwestClientSession,
  ): Promise<{ options: RawFareOption[]; pageText: string }> {
    const internal = session ? this.require(session.accountId) : await this.anonymousPage();
    const { page } = internal;

    try {
      // Southwest intermittently returns a "Sorry, we found some errors / no
      // results for your search" page (especially on back-to-back automated
      // searches in the same session). It's transient, so retry the whole
      // search several times — with an escalating cooldown — until results
      // render, rather than reporting no fares.
      const maxAttempts = 5;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (page.isClosed()) {
          throw new Error('The browser window was closed before the search finished.');
        }
        await this.paceSearch(attempt);
        await this.runSearch(page, query);
        if (page.isClosed()) {
          throw new Error('The browser window was closed during the search.');
        }
        await this.snapshot(page, `results-${query.origin}-${query.destination}-try${attempt}`);

        const hasResults =
          (await page
            .locator('.air-booking-select-detail')
            .count()
            .catch(() => 0)) > 0;
        if (hasResults) break;

        if (attempt < maxAttempts) {
          const transient = await this.isTransientErrorPage(page);
          log.warn('Southwest returned no results; retrying same search', {
            origin: query.origin,
            destination: query.destination,
            departureDate: query.departureDate,
            attempt,
            transientErrorPage: transient,
          });
          // Once Akamai flags the session, a plain retry keeps hitting the error
          // page. Re-warm trust via a human-like homepage visit before retrying.
          if (!page.isClosed()) await this.recoverTrust(page);
          continue;
        }
      }

      const options = await this.parseResults(page, query.departureDate);
      const pageText = await this.bodyText(page);
      return { options, pageText };
    } finally {
      if (!session) {
        // Close just the page. With a persistent profile the context is shared
        // and reused across searches; only tear it down in close().
        await page.close().catch(() => undefined);
        if (!this.persistentContext) {
          await internal.context.close().catch(() => undefined);
        }
      }
    }
  }

  /**
   * Detect Southwest's transient "Sorry, we found some errors… Oops… there are
   * no results for your search" page. Used to decide whether a result-less
   * search is worth retrying.
   */
  private async isTransientErrorPage(page: Page): Promise<boolean> {
    const text = (await this.bodyText(page)).toLowerCase();
    return (
      text.includes('we found some errors') ||
      text.includes('unable to process your request') ||
      text.includes('there are no results for your search')
    );
  }

  /**
   * Space out consecutive search submits. Back-to-back automated searches in the
   * same persistent session trip Southwest's bot sensor (every other search
   * fails); waiting between them — and a little longer on each retry — keeps the
   * session looking human. The first attempt of the first search waits the base
   * gap; retries escalate.
   */
  private async paceSearch(attempt: number): Promise<void> {
    const base = PlaywrightSouthwestClient.MIN_SEARCH_GAP_MS;
    const sinceLast = Date.now() - this.lastSearchAt;
    // Enforce the base gap since the previous search, plus extra per retry.
    const required = base + (attempt - 1) * base;
    const wait = Math.max(0, required - sinceLast);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastSearchAt = Date.now();
  }

  /**
   * Re-establish Akamai trust after a transient error page. Once Southwest's
   * bot sensor flags the session, retrying the search alone keeps failing — the
   * `_abck`/`bm_sz` cookies need a "human" page interaction to be re-validated.
   * Navigate to the homepage, idle with some mouse movement and a scroll so the
   * sensor collects fresh behavioural signal, then let it settle.
   */
  private async recoverTrust(page: Page): Promise<void> {
    if (page.isClosed()) return;
    try {
      await page.goto(`${this.options.baseUrl}/`, { waitUntil: 'domcontentloaded' });
      // Human-like idle: wiggle the mouse and scroll a little, then wait so the
      // Akamai sensor script can post a fresh, valid token.
      await page.mouse.move(300, 250, { steps: 10 }).catch(() => undefined);
      await page.mouse.move(700, 480, { steps: 14 }).catch(() => undefined);
      await page.mouse.wheel(0, 600).catch(() => undefined);
      await page.waitForTimeout(2500).catch(() => undefined);
      await page.mouse.wheel(0, -300).catch(() => undefined);
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
      await page.waitForTimeout(1500).catch(() => undefined);
    } catch {
      // Best-effort; if recovery navigation fails the retry will just try again.
    }
  }

  /**
   * Fill and submit the one-way search form by typing/clicking like a real user.
   * Selectors validated against the live 2026 southwest.com booking widget:
   *  - Trip type is a custom dropdown (combobox "Trip type options" → li[role=
   *    option] "One-way"); there is NO radio.
   *  - Airport comboboxes need the matching autocomplete OPTION clicked (keyboard
   *    nav selects the wrong airport).
   *  - Fare type radios are tabindex=-1; click the associated label, not the input.
   *  - The open date-picker overlay intercepts the submit button — close it (Esc)
   *    before clicking Search, and use a real mouse click so Akamai sees a
   *    trusted event.
   */
  private async runSearch(page: Page, query: FlightSearchQuery): Promise<void> {
    const fareValue = query.preferred === PurchaseType.Cash ? 'USD' : 'POINTS';

    await page.goto(`${this.options.baseUrl}/air/booking/`, { waitUntil: 'domcontentloaded' });
    await page
      .waitForSelector('#originationAirportCode', { timeout: this.options.timeoutMs, state: 'visible' })
      .catch(() => undefined);

    // Dismiss the cookie banner if present (it can overlay controls).
    await page
      .getByRole('button', { name: /reject all cookies/i })
      .click({ timeout: 3000 })
      .catch(() => undefined);

    // Trip type → One-way (open the dropdown once, then click the option).
    const owOption = page.locator('li[role="option"]', { hasText: /^one-?way$/i }).first();
    const tripTrigger = page.getByRole('combobox', { name: 'Trip type options' }).first();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await tripTrigger.click({ timeout: 5000 }).catch(() => undefined);
      const visible = await owOption
        .waitFor({ state: 'visible', timeout: 4000 })
        .then(() => true, () => false);
      if (visible) {
        const clicked = await owOption.click().then(() => true, () => false);
        if (clicked) break;
      }
    }

    await this.typeAirport(page, '#originationAirportCode', query.origin);
    await this.typeAirport(page, '#destinationAirportCode', query.destination);

    // Fare currency (Points vs Dollars): click the label of the tabindex=-1 radio.
    const fareRadio = page.locator(`input[name="fareType"][value="${fareValue}"]`).first();
    const labelledBy = await fareRadio.getAttribute('aria-labelledby').catch(() => null);
    if (labelledBy) {
      await page.locator(`#${labelledBy}`).click().catch(() => undefined);
    } else {
      await fareRadio.click({ force: true }).catch(() => undefined);
    }

    // Departure date as MMDD (e.g. "1008"), then close the calendar overlay.
    const [, mm = '', dd = ''] = query.departureDate.split('-');
    const dateInput = page.locator('#departureDate');
    await dateInput.click().catch(() => undefined);
    await dateInput.fill('').catch(() => undefined);
    await page.keyboard.type(`${mm}${dd}`, { delay: 60 }).catch(() => undefined);
    await page.waitForTimeout(400).catch(() => undefined);
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(300).catch(() => undefined);

    // Submit with a real mouse click (trusted event → passes Akamai sensor).
    const submit = page.locator('#flightBookingSubmit').first();
    await page.mouse.move(400, 300, { steps: 8 }).catch(() => undefined);
    await page.mouse.move(700, 500, { steps: 12 }).catch(() => undefined);
    await submit.scrollIntoViewIfNeeded().catch(() => undefined);
    await submit.click({ timeout: 8000 }).catch(async () => {
      await submit.click({ force: true, timeout: 8000 }).catch(() => undefined);
    });

    // Wait for the results matrix. If a "Press & Hold" challenge appears and the
    // browser is headful, the user can solve it within this window.
    await page
      .waitForSelector('.air-booking-select-detail', {
        timeout: this.options.assistedLoginTimeoutMs ?? this.options.timeoutMs,
        state: 'attached',
      })
      .catch(() => undefined);

    // The flight rows render their times before the fare buttons (prices)
    // hydrate. Wait until at least one Basic fare button actually shows a
    // price, otherwise parseResults reads empty points/cash and "current"
    // shows 0.
    await page
      .waitForFunction(
        () => {
          // Runs in the browser; the Node tsconfig has no DOM lib, so type the
          // minimal DOM surface we touch instead of referencing DOM globals.
          type El = {
            querySelector(s: string): { getAttribute(n: string): string | null } | null;
            getAttribute(n: string): string | null;
            textContent: string | null;
          };
          const doc = (globalThis as unknown as {
            document: { querySelectorAll(s: string): ArrayLike<El> };
          }).document;
          const btns = Array.from(doc.querySelectorAll('[data-test="fare-button--basic"]'));
          if (btns.length === 0) return false;
          return btns.some((b) => {
            const label = b.querySelector('button')?.getAttribute('aria-label') ?? '';
            return /\d[\d,]*\s*(?:PTS|Dollars)/i.test(label) || /\$\s*\d/.test(b.textContent ?? '');
          });
        },
        { timeout: 20_000 },
      )
      .catch(() => undefined);
    await page.waitForTimeout(800).catch(() => undefined);
  }

  /** Type an airport code into a combobox and click the matching suggestion. */
  private async typeAirport(page: Page, selector: string, code: string): Promise<void> {
    const input = page.locator(selector);
    await input.click().catch(() => undefined);
    await input.fill('').catch(() => undefined);
    await page.keyboard.type(code, { delay: 90 }).catch(() => undefined);
    await page.waitForTimeout(1500).catch(() => undefined);
    // Click the option whose text ends with "- <CODE>" (keyboard nav is unreliable
    // and can select the wrong airport).
    const option = page
      .getByRole('option', { name: new RegExp(`-\\s*${code}\\b`, 'i') })
      .first();
    await option.click({ timeout: 4000 }).catch(async () => {
      // Fallback to keyboard selection if the option text didn't match.
      await page.keyboard.press('ArrowDown').catch(() => undefined);
      await page.keyboard.press('Enter').catch(() => undefined);
    });
    await page.waitForTimeout(400).catch(() => undefined);
  }

  /**
   * Parse each flight row (`.air-booking-select-detail`) into a RawFareOption,
   * reading the cheapest ("Basic") fare's points/cash from its aria-label.
   */
  private async parseResults(page: Page, departureDate: string): Promise<RawFareOption[]> {
    return page
      .$$eval(
        '.air-booking-select-detail',
        (rows, date) => {
          const to24h = (t: string, period: string): string => {
            const [hStr, mStr] = t.split(':');
            let h = Number.parseInt(hStr ?? '0', 10);
            const m = mStr ?? '00';
            const p = period.toUpperCase();
            if (p === 'PM' && h !== 12) h += 12;
            if (p === 'AM' && h === 12) h = 0;
            return `${String(h).padStart(2, '0')}:${m.padStart(2, '0')}:00`;
          };

          return rows.map((row) => {
            // Flight number: aria-label "Information for flight number 1 3 0 8..."
            const infoEl = row.querySelector('[aria-label*="Information for flight number"]');
            const infoLabel = infoEl?.getAttribute('aria-label') ?? '';
            const numMatch = infoLabel.match(/flight numbers?\s+([\d\s/]+?)\.?\s*(?:Opens|$)/i);
            const flightNumber = numMatch
              ? numMatch[1].replace(/\s+/g, '').replace(/\/.*$/, '')
              : undefined;

            // Departure time.
            const depEl = row.querySelector('[data-test="select-detail--origination-time"]');
            const depValue = (depEl?.querySelector('.time--value')?.textContent ?? '')
              .replace(/Departs/i, '')
              .trim();
            const depTimeMatch = depValue.match(/(\d{1,2}:\d{2})\s*([AP]M)/i);
            const departureDateTime = depTimeMatch
              ? `${date}T${to24h(depTimeMatch[1], depTimeMatch[2])}`
              : `${date}T00:00:00`;

            // Cheapest fare: the "Basic" fare button. Read price from the
            // aria-label first, then fall back to the screen-reader currency
            // span ("22,000 Points" / "$5.60") and finally the visible value —
            // the aria-label is occasionally missing right after hydration.
            const basicWrap = row.querySelector('[data-test="fare-button--basic"]');
            const basic =
              basicWrap?.querySelector('button') ?? basicWrap ?? undefined;
            const fareLabelText = basic?.getAttribute('aria-label') ?? '';

            // Points: aria-label "22,000 PTS" OR SR span "22,000 Points".
            const srPoints =
              basicWrap?.querySelector(
                '.currency_points .swa-g-screen-reader-only, .currency_points .currency-box',
              )?.textContent ?? '';
            const visiblePoints =
              basicWrap?.querySelector('.fare-button--value [aria-hidden="true"]')?.textContent ??
              '';
            const ptsMatch =
              fareLabelText.match(/([\d,]+)\s*PTS/i) ??
              srPoints.match(/([\d,]+)\s*Points/i) ??
              visiblePoints.match(/([\d,]+)/);

            // Cash: aria-label "59.98 Dollars" OR visible "$59.98".
            const srCash =
              basicWrap?.querySelector('.currency:not(.currency_points)')?.textContent ?? '';
            const dollarsMatch =
              fareLabelText.match(/([\d,]+(?:\.\d{2})?)\s*Dollars/i) ??
              srCash.match(/\$\s*([\d,]+(?:\.\d{2})?)/);

            const taxMatch =
              fareLabelText.match(/taxes and fees of dollars\s+([\d.]+)/i) ??
              (basicWrap?.querySelector('.taxes-text')?.textContent ?? '').match(
                /\$\s*([\d.]+)/,
              );

            return {
              flightNumber,
              departureDateTime,
              fareLabel: 'Basic',
              pointsText: ptsMatch ? ptsMatch[1] : undefined,
              cashText: dollarsMatch ? dollarsMatch[1] : undefined,
              taxesText: taxMatch ? taxMatch[1] : undefined,
              stops: 0,
            };
          });
        },
        departureDate,
      )
      .catch(() => [] as RawFareOption[]);
  }

  async close(session: SouthwestClientSession): Promise<void> {
    const internal = this.sessions.get(session.accountId);
    if (internal) {
      await internal.context.close().catch(() => undefined);
      this.sessions.delete(session.accountId);
    }
    if (this.sessions.size === 0) {
      if (this.persistentContext) {
        await this.persistentContext.close().catch(() => undefined);
        this.persistentContext = null;
      }
      if (this.browser) {
        await this.browser.close().catch(() => undefined);
        this.browser = null;
      }
    }
  }

  // --- helpers -------------------------------------------------------------

  /**
   * Wait until the page looks logged in. Heuristic: the URL leaves the login
   * flow and account/trips chrome appears. Used for assisted login so the user
   * can clear Southwest's "Press & Hold" challenge manually.
   */
  private async waitForLoggedIn(page: Page): Promise<void> {
    const timeout = this.options.assistedLoginTimeoutMs ?? 180_000;
    const loggedInHint =
      'a[href*="logout"], [data-qa="account-menu"], a[href*="manage-reservation"], text=My Account';
    try {
      await page.waitForSelector(loggedInHint, { timeout, state: 'attached' });
    } catch {
      // Fall back to URL change away from the login page.
      const deadline = Date.now() + timeout;
      while (/login/i.test(page.url()) && Date.now() < deadline) {
        await page.waitForTimeout(1000);
      }
    }
    await page.waitForLoadState('networkidle').catch(() => undefined);
  }

  /** Persist a screenshot + HTML for selector tuning when debug mode is on. */
  private async snapshot(page: Page, label: string): Promise<void> {
    if (!this.options.debugMode || !this.options.debugDir) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = join(this.options.debugDir, `${stamp}_${label}`);
    try {
      await page.screenshot({ path: `${base}.png`, fullPage: true });
      const html = await page.content();
      await writeFile(`${base}.html`, html, 'utf8');
      log.debug('Saved scraper snapshot', { label });
    } catch (err) {
      log.warn('Failed to save scraper snapshot', { label, error: String(err) });
    }
  }

  private require(accountId: string): InternalSession {
    const s = this.sessions.get(accountId);
    if (!s) throw new Error(`No active Southwest session for account ${accountId}. Log in first.`);
    return s;
  }

  private async anonymousPage(): Promise<InternalSession> {
    const { context } = await this.ensureContext();
    const page = await context.newPage();
    page.setDefaultTimeout(this.options.timeoutMs);
    return { context, page };
  }

  /**
   * Create a browser context with the automation fingerprints masked. Southwest
   * uses Akamai Bot Manager, which silently kills the results page when it
   * detects `navigator.webdriver` or the automation banner. Combined with the
   * launch flags in {@link ensureBrowser}, this lets real searches render.
   */
  private async newStealthContext(browser: Browser): Promise<BrowserContext> {
    const context = await browser.newContext({
      viewport: { width: 1360, height: 950 },
      locale: 'en-US',
      userAgent: PlaywrightSouthwestClient.USER_AGENT,
    });
    await context.addInitScript(PlaywrightSouthwestClient.STEALTH_INIT);
    return context;
  }

  private async fillFirst(page: Page, selector: string, value: string): Promise<void> {
    const locator = page.locator(selector).first();
    await locator.waitFor({ state: 'visible' }).catch(() => undefined);
    await locator.fill(value).catch(() => undefined);
  }

  private async clickFirst(page: Page, selector: string): Promise<void> {
    const locator = page.locator(selector).first();
    await locator.click().catch(() => undefined);
  }

  private async bodyText(page: Page): Promise<string> {
    return (await page.textContent('body').catch(() => '')) ?? '';
  }
}
