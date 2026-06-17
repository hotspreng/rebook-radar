import {
  AirlineProvider,
  EmailTripImportService,
  FakeSouthwestScraperClient,
  FlightSource,
  GoogleFlightsSerpApiProvider,
  PriceCheckService,
  SouthwestProvider,
  exportFlightsToCsv,
  generateId,
  isAirlineError,
  type Account,
  type AccountCredentials,
  type AccountRepository,
  type AppConfig,
  type ExportRow,
  type Flight,
  type FlightRepository,
  type NewAccount,
  type NewFlight,
  type NewPassenger,
  type Passenger,
  type PassengerRepository,
  type PriceCheckOptions,
  type QuoteRepository,
  type RetrievedTrip,
  type SecretStore,
} from '@swr/core';
import { logger } from '@swr/core';
import type { AppSettings, CreateAccountInput, EmailImportResult, EmailStatus, FlightWithComparison, GmailCredentialsInput } from '../../shared/dto.js';
import type { TestLoginResult } from '../../shared/api.js';
import { PlaywrightSouthwestClient } from '../scraping/PlaywrightSouthwestClient.js';
import { GmailMessageSource } from '../email/GmailMessageSource.js';
import type { SettingsStore } from './SettingsStore.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const log = logger.child('app-service');

/** Secret-store account name under which the SerpApi key is encrypted. */
const SERPAPI_SECRET_ACCOUNT = 'serpapi';

export interface AppServiceDeps {
  config: AppConfig;
  settings: SettingsStore;
  passengers: PassengerRepository;
  accounts: AccountRepository;
  flights: FlightRepository;
  quotes: QuoteRepository;
  secrets: SecretStore;
  /** Directory where the scraper writes debug screenshots/HTML. */
  debugDir: string;
  /** Dedicated persistent browser profile dir for scraping (Akamai trust). */
  scraperProfileDir: string;
  /** Opens a URL in the user's default browser (used for Gmail OAuth consent). */
  openExternal: (url: string) => Promise<void>;
}

/**
 * Application service layer. Pure orchestration over core business logic and
 * the repository/secret ports; contains NO Southwest-specific logic (that lives
 * in core) and NO direct DB access (that lives in the repositories).
 *
 * IPC handlers are thin wrappers around these methods.
 */
export class AppService {
  private readonly priceCheck = new PriceCheckService();

  constructor(private readonly deps: AppServiceDeps) {}

  // --- Passengers ----------------------------------------------------------

  listPassengers(): Promise<Passenger[]> {
    return this.deps.passengers.list();
  }

  async createPassenger(input: NewPassenger): Promise<Passenger> {
    const now = new Date().toISOString();
    return this.deps.passengers.create({
      ...input,
      id: generateId('pax'),
      createdAt: now,
      updatedAt: now,
    });
  }

  async updatePassenger(passenger: Passenger): Promise<Passenger> {
    return this.deps.passengers.update({ ...passenger, updatedAt: new Date().toISOString() });
  }

  deletePassenger(id: string): Promise<void> {
    return this.deps.passengers.delete(id);
  }

  // --- Accounts ------------------------------------------------------------

  listAccounts(): Promise<Account[]> {
    return this.deps.accounts.list();
  }

  async createAccount(input: CreateAccountInput): Promise<Account> {
    const now = new Date().toISOString();
    const id = generateId('acct');
    const credentialKey = `${this.deps.config.keychainService}:${id}`;
    const account: Account = {
      ...(input.account as NewAccount),
      id,
      credentialKey,
      hasStoredCredential: false,
      createdAt: now,
      updatedAt: now,
    };
    const created = await this.deps.accounts.create(account);
    if (input.password) {
      await this.setAccountPassword(created.id, input.password);
      return { ...created, hasStoredCredential: true };
    }
    return created;
  }

  async updateAccount(account: Account): Promise<Account> {
    return this.deps.accounts.update({ ...account, updatedAt: new Date().toISOString() });
  }

  async deleteAccount(id: string): Promise<void> {
    const account = await this.deps.accounts.get(id);
    if (account?.hasStoredCredential) {
      await this.deps.secrets.deletePassword(account.credentialKey).catch(() => undefined);
    }
    await this.deps.accounts.delete(id);
  }

  async setAccountPassword(accountId: string, password: string): Promise<void> {
    const account = await this.requireAccount(accountId);
    await this.deps.secrets.setPassword(account.credentialKey, password);
    await this.deps.accounts.update({
      ...account,
      hasStoredCredential: true,
      updatedAt: new Date().toISOString(),
    });
  }

  async deleteAccountPassword(accountId: string): Promise<void> {
    const account = await this.requireAccount(accountId);
    await this.deps.secrets.deletePassword(account.credentialKey);
    await this.deps.accounts.update({
      ...account,
      hasStoredCredential: false,
      updatedAt: new Date().toISOString(),
    });
  }

  async testLogin(accountId: string): Promise<TestLoginResult> {
    const account = await this.requireAccount(accountId);
    const credentials = await this.loadCredentials(account);
    if (!credentials) {
      return { ok: false, message: 'No stored password for this account.' };
    }
    const provider = this.createProvider();
    try {
      const session = await provider.login(credentials, account.id);
      await provider.logout(session);
      return { ok: true, message: 'Login succeeded.' };
    } catch (err) {
      return this.toLoginError(err);
    }
  }

  async syncTrips(accountId: string): Promise<{ imported: number; skipped: number }> {
    const account = await this.requireAccount(accountId);
    const credentials = await this.loadCredentials(account);
    if (!credentials) throw new Error('No stored password for this account.');

    const provider = this.createProvider();
    const session = await provider.login(credentials, account.id);
    try {
      const trips = await provider.getUpcomingTrips(session);
      const existing = await this.deps.flights.listByAccount(account.id);
      const existingKeys = new Set(existing.map((f) => `${f.confirmationNumber}:${f.departureDateTime}`));

      let imported = 0;
      let skipped = 0;
      const passengers = await this.deps.passengers.list();

      for (const trip of trips) {
        const key = `${trip.confirmationNumber}:${trip.departureDateTime}`;
        if (existingKeys.has(key)) {
          skipped += 1;
          continue;
        }
        const passengerId = this.matchPassenger(passengers, trip.passengerNames, account);
        if (!passengerId) {
          skipped += 1;
          continue;
        }
        await this.createFlightFromTrip(account.id, passengerId, trip);
        imported += 1;
      }

      await this.deps.accounts.update({
        ...account,
        lastSyncedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return { imported, skipped };
    } finally {
      await provider.logout(session);
    }
  }

  // --- Gmail email import --------------------------------------------------

  private gmailSecretKey(kind: 'clientSecret' | 'refreshToken'): string {
    return `${this.deps.config.keychainService}:gmail:${kind}`;
  }

  /** Current Gmail connection status for the UI. */
  async getEmailStatus(): Promise<EmailStatus> {
    const s = this.deps.settings.get();
    const clientSecret = await this.deps.secrets.getPassword(this.gmailSecretKey('clientSecret'));
    const refreshToken = await this.deps.secrets.getPassword(this.gmailSecretKey('refreshToken'));
    return {
      configured: !!s.gmailClientId && !!clientSecret,
      connected: !!refreshToken,
      email: s.gmailEmail,
      lastImportAt: s.lastEmailImportAt,
    };
  }

  /** Persist the OAuth client id (settings) and client secret (secure store). */
  async setGmailCredentials(input: GmailCredentialsInput): Promise<EmailStatus> {
    this.deps.settings.update({ gmailClientId: input.clientId.trim() });
    if (input.clientSecret) {
      await this.deps.secrets.setPassword(this.gmailSecretKey('clientSecret'), input.clientSecret.trim());
    }
    return this.getEmailStatus();
  }

  /** Run the interactive Gmail consent flow and store the refresh token. */
  async connectGmail(): Promise<EmailStatus> {
    const source = await this.buildEmailSource(false);
    if (!source) throw new Error('Enter your Google OAuth Client ID and Client Secret first.');
    const { refreshToken, email } = await source.authorize((url) => this.deps.openExternal(url));
    await this.deps.secrets.setPassword(this.gmailSecretKey('refreshToken'), refreshToken);
    this.deps.settings.update({ gmailConnected: true, gmailEmail: email });
    return this.getEmailStatus();
  }

  /** Forget the stored Gmail tokens. */
  async disconnectGmail(): Promise<EmailStatus> {
    await this.deps.secrets.deletePassword(this.gmailSecretKey('refreshToken')).catch(() => undefined);
    this.deps.settings.update({ gmailConnected: false, gmailEmail: undefined });
    return this.getEmailStatus();
  }

  /**
   * Import trips from Gmail confirmation emails. Folds bookings/changes/
   * cancellations per confirmation number, then reconciles against stored
   * flights: new active trips are created, changed ones updated, and cancelled
   * confirmations removed from the dashboard.
   */
  async importFromEmail(): Promise<EmailImportResult> {
    const source = await this.buildEmailSource(true);
    if (!source || !(await source.isConnected())) {
      throw new Error('Gmail is not connected. Connect your account in Settings first.');
    }

    const messages = await source.fetchMessages({
      query: 'from:southwest.com newer_than:12m',
      maxResults: 400,
    });
    const folded = new EmailTripImportService().fold(messages, { now: new Date() });

    const passengers = await this.deps.passengers.list();
    const existing = await this.deps.flights.list();
    const byConfirmation = new Map<string, Flight>();
    for (const f of existing) byConfirmation.set(f.confirmationNumber.toUpperCase(), f);

    let imported = 0;
    let updated = 0;
    let cancelled = 0;
    let skipped = 0;

    for (const trip of folded.active) {
      const passengerId = this.matchPassengerByName(passengers, trip.passengerNames);
      if (!passengerId) {
        skipped += 1;
        continue;
      }
      const prior = byConfirmation.get(trip.confirmationNumber.toUpperCase());
      if (prior) {
        await this.deps.flights.update(this.mergeEmailTripIntoFlight(prior, trip));
        updated += 1;
      } else {
        await this.createFlightFromEmailTrip(passengerId, trip);
        imported += 1;
      }
    }

    for (const confirmation of folded.cancelledConfirmations) {
      const prior = byConfirmation.get(confirmation.toUpperCase());
      if (prior && prior.source === FlightSource.Email) {
        await this.deps.flights.delete(prior.id);
        cancelled += 1;
      }
    }

    this.deps.settings.update({ lastEmailImportAt: new Date().toISOString() });
    return { scanned: messages.length, imported, updated, cancelled, skipped };
  }

  private async buildEmailSource(withRefreshToken: boolean): Promise<GmailMessageSource | null> {
    const s = this.deps.settings.get();
    const clientSecret = await this.deps.secrets.getPassword(this.gmailSecretKey('clientSecret'));
    if (!s.gmailClientId || !clientSecret) return null;
    const refreshToken = withRefreshToken
      ? await this.deps.secrets.getPassword(this.gmailSecretKey('refreshToken'))
      : undefined;
    return new GmailMessageSource({
      clientId: s.gmailClientId,
      clientSecret,
      refreshToken: refreshToken ?? undefined,
      debugDump: s.debugMode ? (label, content) => this.dumpDebug(label, content) : undefined,
    });
  }

  private dumpDebug(label: string, content: string): void {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      writeFileSync(join(this.deps.debugDir, `${stamp}_${label}.txt`), content, 'utf8');
    } catch {
      // best-effort
    }
  }

  private matchPassengerByName(passengers: Passenger[], names: string[]): string | undefined {
    const normalized = names.map((n) => n.trim().toLowerCase());
    const byName = passengers.find((p) => normalized.includes(p.fullName.trim().toLowerCase()));
    if (byName) return byName.id;
    // If there is exactly one passenger, attribute the trip to them.
    if (passengers.length === 1) return passengers[0]!.id;
    return undefined;
  }

  private mergeEmailTripIntoFlight(existing: Flight, trip: RetrievedTrip): Flight {
    const isPoints = trip.paidPoints != null;
    return {
      ...existing,
      route: {
        origin: { code: trip.origin || existing.route.origin.code, name: existing.route.origin.name },
        destination: {
          code: trip.destination || existing.route.destination.code,
          name: existing.route.destination.name,
        },
      },
      departureDateTime: trip.departureDateTime || existing.departureDateTime,
      arrivalDateTime: trip.arrivalDateTime ?? existing.arrivalDateTime,
      fareType: trip.fareType ?? existing.fareType,
      originalCost: {
        purchaseType:
          trip.purchaseType ?? (isPoints ? 'points' : 'cash') as Flight['originalCost']['purchaseType'],
        cashUsd: trip.paidCashUsd ?? existing.originalCost.cashUsd,
        points: trip.paidPoints ?? existing.originalCost.points,
        taxesAndFeesUsd: trip.taxesAndFeesUsd ?? existing.originalCost.taxesAndFeesUsd,
      },
      source: FlightSource.Email,
      updatedAt: new Date().toISOString(),
    };
  }

  private async createFlightFromEmailTrip(passengerId: string, trip: RetrievedTrip): Promise<void> {
    const now = new Date().toISOString();
    const isPoints = trip.paidPoints != null;
    await this.deps.flights.create({
      id: generateId('flt'),
      passengerId,
      accountId: undefined,
      confirmationNumber: trip.confirmationNumber,
      route: {
        origin: { code: trip.origin },
        destination: { code: trip.destination },
      },
      departureDateTime: trip.departureDateTime,
      arrivalDateTime: trip.arrivalDateTime,
      fareType: trip.fareType,
      originalCost: {
        purchaseType: (trip.purchaseType ?? (isPoints ? 'points' : 'cash')) as Flight['originalCost']['purchaseType'],
        cashUsd: trip.paidCashUsd,
        points: trip.paidPoints,
        taxesAndFeesUsd: trip.taxesAndFeesUsd ?? 0,
      },
      bookingDate: now.slice(0, 10),
      source: FlightSource.Email,
      monitoring: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  // --- Flights -------------------------------------------------------------

  async listFlights(): Promise<FlightWithComparison[]> {
    const flights = await this.deps.flights.list();
    return Promise.all(flights.map((f) => this.toFlightWithComparison(f)));
  }

  async getFlight(id: string): Promise<FlightWithComparison | undefined> {
    const flight = await this.deps.flights.get(id);
    return flight ? this.toFlightWithComparison(flight) : undefined;
  }

  async createFlight(input: NewFlight): Promise<Flight> {
    const now = new Date().toISOString();
    return this.deps.flights.create({
      ...input,
      id: generateId('flt'),
      createdAt: now,
      updatedAt: now,
    });
  }

  async updateFlight(flight: Flight): Promise<Flight> {
    return this.deps.flights.update({ ...flight, updatedAt: new Date().toISOString() });
  }

  deleteFlight(id: string): Promise<void> {
    return this.deps.flights.delete(id);
  }

  // --- Pricing -------------------------------------------------------------

  async checkOne(flightId: string): Promise<FlightWithComparison> {
    const flight = await this.deps.flights.get(flightId);
    if (!flight) throw new Error(`Flight ${flightId} not found.`);
    const provider = this.createProvider();
    const options = this.comparisonOptions();
    const result = await this.priceCheck.check(flight, provider, undefined, options);
    await this.deps.quotes.saveLatest(flight.id, result.quote, result.comparison);
    return this.toFlightWithComparison(flight, result.quote, result.comparison);
  }

  async checkAll(): Promise<FlightWithComparison[]> {
    const flights = await this.deps.flights.listMonitored();
    const provider = this.createProvider();
    const options = this.comparisonOptions();
    const out: FlightWithComparison[] = [];

    for (const flight of flights) {
      try {
        const result = await this.priceCheck.check(flight, provider, undefined, options);
        await this.deps.quotes.saveLatest(flight.id, result.quote, result.comparison);
        out.push(await this.toFlightWithComparison(flight, result.quote, result.comparison));
      } catch (err) {
        log.warn('Price check failed for flight', { flightId: flight.id, error: String(err) });
        out.push(await this.toFlightWithComparison(flight));
      }
    }
    return out;
  }

  // --- Settings ------------------------------------------------------------

  getSettings(): AppSettings {
    return this.deps.settings.get();
  }

  updateSettings(partial: Partial<AppSettings>): AppSettings {
    return this.deps.settings.update(partial);
  }

  /**
   * Store (or clear) the SerpApi key in the OS secret store and mirror the
   * configured flag in settings. Passing an empty string removes the key.
   */
  async setSerpApiKey(key: string): Promise<AppSettings> {
    const trimmed = key.trim();
    if (!trimmed) {
      await this.deps.secrets.deletePassword(SERPAPI_SECRET_ACCOUNT);
      return this.deps.settings.update({ serpApiConfigured: false });
    }
    await this.deps.secrets.setPassword(SERPAPI_SECRET_ACCOUNT, trimmed);
    return this.deps.settings.update({ serpApiConfigured: true });
  }

  // --- Export --------------------------------------------------------------

  async buildCsv(): Promise<string> {
    const flights = await this.listFlights();
    const rows: ExportRow[] = flights.map((f) => ({
      flight: f.flight,
      passengerName: f.passengerName,
      accountLabel: f.accountLabel,
      comparison: f.comparison,
    }));
    return exportFlightsToCsv(rows);
  }

  /**
   * Open the scraper profile headfully so the user can complete one manual
   * search, warming Akamai's trust cookies. Required once before automated
   * "Check all prices" runs will succeed.
   */
  async warmScraperProfile(): Promise<{ warmed: boolean }> {
    const s = this.deps.settings.get();
    const client = new PlaywrightSouthwestClient({
      baseUrl: this.deps.config.southwestBaseUrl,
      headful: true,
      channel: s.scraperBrowserChannel === 'chromium' ? undefined : s.scraperBrowserChannel,
      timeoutMs: this.deps.config.scraperTimeoutMs,
      debugDir: this.deps.debugDir,
      debugMode: s.debugMode,
      profileDir: this.deps.scraperProfileDir,
    });
    return client.warmupProfile();
  }

  // --- internals -----------------------------------------------------------

  private comparisonOptions(): PriceCheckOptions {
    const s = this.deps.settings.get();
    return {
      pointValueCents: s.pointValueCents,
      savingsThresholdUsd: s.savingsAlertThresholdUsd,
      savingsThresholdPoints: s.savingsAlertThresholdPoints,
      matchToleranceMinutes: 90,
    };
  }

  /** Build the airline provider based on current settings (real vs fake). */
  private createProvider(): AirlineProvider {
    const s = this.deps.settings.get();
    // Use the user's point value as the cash→points estimation rate so the
    // estimate is consistent with how the rest of the app values points.
    const estimation = { centsPerPoint: s.pointValueCents / 100 };
    if (s.scrapingEnabled && s.fareSource === 'serpapi') {
      return new GoogleFlightsSerpApiProvider({
        fetchJson: async (url) => {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        },
        getApiKey: () => this.deps.secrets.getPassword(SERPAPI_SECRET_ACCOUNT),
        estimation,
      });
    }
    if (s.scrapingEnabled) {
      const client = new PlaywrightSouthwestClient({
        baseUrl: this.deps.config.southwestBaseUrl,
        headful: s.scraperHeadful,
        // 'chromium' means "use the bundled build" — pass no channel.
        channel: s.scraperBrowserChannel === 'chromium' ? undefined : s.scraperBrowserChannel,
        timeoutMs: this.deps.config.scraperTimeoutMs,
        debugDir: this.deps.debugDir,
        debugMode: s.debugMode,
        // Reuse one warmed persistent profile so Southwest's Akamai bot manager
        // trusts the automated searches (no per-run block).
        profileDir: this.deps.scraperProfileDir,
        // When the browser is visible, let the user complete login + any
        // "Press & Hold" bot challenge manually before we read trips.
        assistedLogin: s.scraperHeadful,
      });
      return new SouthwestProvider(client, undefined, estimation);
    }
    return new SouthwestProvider(new FakeSouthwestScraperClient(), undefined, estimation);
  }

  private async requireAccount(id: string): Promise<Account> {
    const account = await this.deps.accounts.get(id);
    if (!account) throw new Error(`Account ${id} not found.`);
    return account;
  }

  private async loadCredentials(account: Account): Promise<AccountCredentials | undefined> {
    if (!account.hasStoredCredential) return undefined;
    const password = await this.deps.secrets.getPassword(account.credentialKey);
    if (!password) return undefined;
    return { username: account.username, password };
  }

  private async toFlightWithComparison(
    flight: Flight,
    quoteOverride?: FlightWithComparison['quote'],
    comparisonOverride?: FlightWithComparison['comparison'],
  ): Promise<FlightWithComparison> {
    const passenger = await this.deps.passengers.get(flight.passengerId);
    const account = flight.accountId ? await this.deps.accounts.get(flight.accountId) : undefined;
    let quote = quoteOverride;
    let comparison = comparisonOverride;
    if (!comparison) {
      const latest = await this.deps.quotes.getLatest(flight.id);
      quote = quote ?? latest?.quote;
      comparison = latest?.comparison;
    }
    return {
      flight,
      passengerName: passenger?.fullName ?? 'Unknown',
      accountLabel: account?.label,
      quote,
      comparison,
    };
  }

  private matchPassenger(
    passengers: Passenger[],
    names: string[],
    account: Account,
  ): string | undefined {
    const normalized = names.map((n) => n.trim().toLowerCase());
    const byName = passengers.find((p) => normalized.includes(p.fullName.trim().toLowerCase()));
    if (byName) return byName.id;
    // Fall back to the account's first mapped passenger.
    return account.passengerIds[0];
  }

  private async createFlightFromTrip(
    accountId: string,
    passengerId: string,
    trip: Awaited<ReturnType<AirlineProvider['getUpcomingTrips']>>[number],
  ): Promise<void> {
    const now = new Date().toISOString();
    const isPoints = trip.paidPoints != null;
    await this.deps.flights.create({
      id: generateId('flt'),
      passengerId,
      accountId,
      confirmationNumber: trip.confirmationNumber,
      route: {
        origin: { code: trip.origin },
        destination: { code: trip.destination },
      },
      departureDateTime: trip.departureDateTime,
      arrivalDateTime: trip.arrivalDateTime,
      fareType: trip.fareType,
      originalCost: {
        purchaseType: (trip.purchaseType ?? (isPoints ? 'points' : 'cash')) as Flight['originalCost']['purchaseType'],
        cashUsd: trip.paidCashUsd,
        points: trip.paidPoints,
        taxesAndFeesUsd: trip.taxesAndFeesUsd ?? 0,
      },
      bookingDate: now.slice(0, 10),
      source: 'scraped' as Flight['source'],
      monitoring: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  private toLoginError(err: unknown): TestLoginResult {
    if (isAirlineError(err)) {
      return { ok: false, message: err.message, code: err.code };
    }
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
