import {
  AirlineProvider,
  EmailTripImportService,
  FakeSouthwestScraperClient,
  FlightSource,
  GoogleFlightsSerpApiProvider,
  PriceCheckService,
  PricingComparisonService,
  PurchaseType,
  SouthwestProvider,
  estimatePointsFromCash,
  exportFlightsToCsv,
  fetchSerpApiUsage,
  generateId,
  isAirlineError,
  type Account,
  type AccountCredentials,
  type AccountRepository,
  type AppConfig,
  type ExportRow,
  type Flight,
  type FlightRepository,
  type FlightSegment,
  type NewAccount,
  type NewFlight,
  type NewPassenger,
  type Passenger,
  type PassengerRepository,
  type PriceCheckOptions,
  type PriceComparison,
  type PriceHistoryEntry,
  type PriceHistoryRepository,
  type QuoteRepository,
  type RetrievedTrip,
  type SecretStore,
} from '@swr/core';
import { logger } from '@swr/core';
import type { AppSettings, CreateAccountInput, EmailImportProgress, EmailImportResult, EmailStatus, FlightWithComparison, GmailCredentialsInput, SerpApiKeyUsage } from '../../shared/dto.js';
import type { TestLoginResult } from '../../shared/api.js';
import { PlaywrightSouthwestClient } from '../scraping/PlaywrightSouthwestClient.js';
import { GmailMessageSource } from '../email/GmailMessageSource.js';
import type { SettingsStore } from './SettingsStore.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const log = logger.child('app-service');

/**
 * Secret-store account names under which each SerpApi key is encrypted, in
 * priority order. Slot 0 keeps the legacy 'serpapi' account so existing keys
 * keep working. The provider rotates through these when one runs out of searches.
 */
const SERPAPI_SECRET_ACCOUNTS = ['serpapi', 'serpapi-2', 'serpapi-3'] as const;

/**
 * Whether an email-parsed passenger name refers to the same person as a stored
 * passenger. Matches on first + last token so middle names that Southwest
 * sometimes omits ("Emily Sprenger" vs "Emily Jean Sprenger") still match,
 * while a different first name on a shared surname ("Amy ... Sprenger") does
 * not. Falls back to exact full-name equality.
 */
function passengerNameMatches(emailName: string, storedFullName: string): boolean {
  const a = emailName.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const b = storedFullName.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (a.length === 0 || b.length === 0) return false;
  if (a.join(' ') === b.join(' ')) return true;
  if (a.length < 2 || b.length < 2) return false;
  return a[0] === b[0] && a[a.length - 1] === b[b.length - 1];
}

/** Stable identity for a single flight leg: PNR + route + departure date. */
function flightLegKey(
  confirmationNumber: string,
  origin: string,
  destination: string,
  departureDateTime: string,
): string {
  return [
    confirmationNumber.toUpperCase(),
    origin.toUpperCase(),
    destination.toUpperCase(),
    departureDateTime.slice(0, 10),
  ].join('|');
}

/**
 * Expand a retrieved trip into one {@link RetrievedTrip} per flown leg.
 *
 * A round-trip confirmation carries a `legs` array (outbound + return). Each
 * leg becomes its own tracked flight sharing the confirmation number, with the
 * paid points/cash and taxes split evenly across the legs (Southwest prices and
 * refunds each direction separately). Single-leg trips pass through unchanged.
 */
function expandTripLegs(trip: RetrievedTrip): RetrievedTrip[] {
  if (!trip.legs || trip.legs.length <= 1) return [trip];

  const count = trip.legs.length;
  const splitEven = (total: number | undefined): number | undefined =>
    total == null ? undefined : Math.round(total / count);

  return trip.legs.map((leg) => ({
    ...trip,
    origin: leg.origin,
    destination: leg.destination,
    departureDateTime: leg.departureDateTime,
    arrivalDateTime: leg.arrivalDateTime,
    durationMinutes: leg.durationMinutes,
    segments: leg.segments,
    paidPoints: splitEven(trip.paidPoints),
    paidCashUsd: splitEven(trip.paidCashUsd),
    taxesAndFeesUsd: splitEven(trip.taxesAndFeesUsd),
    legs: undefined,
  }));
}

/** Map retrieved (string-coded) segments onto stored {@link FlightSegment}s. */
function toFlightSegments(trip: RetrievedTrip): FlightSegment[] | undefined {
  if (!trip.segments || trip.segments.length === 0) return undefined;
  return trip.segments.map((s) => ({
    origin: { code: s.origin, name: s.originName },
    destination: { code: s.destination, name: s.destinationName },
    departureDateTime: s.departureDateTime,
    arrivalDateTime: s.arrivalDateTime,
    flightNumber: s.flightNumber,
  }));
}

export interface AppServiceDeps {
  config: AppConfig;
  settings: SettingsStore;
  passengers: PassengerRepository;
  accounts: AccountRepository;
  flights: FlightRepository;
  quotes: QuoteRepository;
  priceHistory: PriceHistoryRepository;
  secrets: SecretStore;
  /** Directory where the scraper writes debug screenshots/HTML. */
  debugDir: string;
  /** Dedicated persistent browser profile dir for scraping (Akamai trust). */
  scraperProfileDir: string;
  /** Opens a URL in the user's default browser (used for Gmail OAuth consent). */
  openExternal: (url: string) => Promise<void>;
  /** Reports live progress while an email import runs (main → renderer). */
  onEmailProgress?: (e: EmailImportProgress) => void;
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
  private readonly pricing = new PricingComparisonService();

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

    this.deps.onEmailProgress?.({ phase: 'scanning', scanned: 0, tripsFound: 0 });

    // Transactional confirmations/changes/cancellations come ONLY from
    // southwestairlines@ifly.southwest.com. Anchoring on that sender keeps
    // marketing mail out entirely so we never manufacture phantom trips.
    const primaryQuery = 'from:southwestairlines@ifly.southwest.com newer_than:13m';

    let messages = await source.fetchMessages({ query: primaryQuery, maxResults: 500 });
    if (messages.length === 0) {
      log.info('Transactional sender query found nothing — retrying broad sender');
      messages = await source.fetchMessages({
        query: 'from:southwest.com newer_than:13m',
        maxResults: 500,
      });
    }

    const folded = new EmailTripImportService().fold(messages, { now: new Date() });
    this.deps.onEmailProgress?.({
      phase: 'parsing',
      scanned: messages.length,
      total: messages.length,
      tripsFound: folded.active.length,
    });
    log.info('Parsed Gmail trip emails', {
      scanned: messages.length,
      events: folded.events,
      confirmations: folded.confirmations,
      activeTrips: folded.active.length,
      cancelled: folded.cancelledConfirmations.length,
      activeConfirmations: folded.active.map((t) => t.confirmationNumber),
    });

    const passengers = await this.deps.passengers.list();
    const existing = await this.deps.flights.list();
    // Round trips share one PNR across multiple flights, so match on the full
    // leg identity (PNR + route + departure date), not the PNR alone.
    const byLegKey = new Map<string, Flight>();
    const byConfirmation = new Map<string, Flight[]>();
    for (const f of existing) {
      byLegKey.set(flightLegKey(f.confirmationNumber, f.route.origin.code, f.route.destination.code, f.departureDateTime), f);
      const pnr = f.confirmationNumber.toUpperCase();
      const list = byConfirmation.get(pnr) ?? [];
      list.push(f);
      byConfirmation.set(pnr, list);
    }

    let imported = 0;
    let updated = 0;
    let cancelled = 0;
    let skipped = 0;

    for (const trip of folded.active) {
      const passengerId = await this.resolvePassengerForImport(passengers, trip.passengerNames);
      if (!passengerId) {
        log.info('Skipped trip — no passenger name in email', {
          confirmation: trip.confirmationNumber,
          names: trip.passengerNames,
        });
        skipped += 1;
        continue;
      }
      // Expand a multi-leg (round-trip) confirmation into one flight per leg.
      for (const legTrip of expandTripLegs(trip)) {
        const key = flightLegKey(
          legTrip.confirmationNumber,
          legTrip.origin,
          legTrip.destination,
          legTrip.departureDateTime,
        );
        const prior = byLegKey.get(key);
        let flight: Flight;
        if (prior) {
          flight = this.mergeEmailTripIntoFlight(prior, legTrip);
          await this.deps.flights.update(flight);
          updated += 1;
        } else {
          flight = await this.createFlightFromEmailTrip(passengerId, legTrip);
          imported += 1;
        }
        // For a brand-new booking, capture the real market fare so the
        // original cost shows an "actual" price instead of an estimate.
        await this.maybeCaptureBookingPrice(flight, legTrip.bookedAt);
      }
    }

    for (const confirmation of folded.cancelledConfirmations) {
      const priorLegs = byConfirmation.get(confirmation.toUpperCase()) ?? [];
      for (const prior of priorLegs) {
        if (prior.source === FlightSource.Email) {
          await this.deps.flights.delete(prior.id);
          cancelled += 1;
        }
      }
    }

    this.deps.settings.update({ lastEmailImportAt: new Date().toISOString() });
    log.info('Email import complete', { imported, updated, cancelled, skipped });
    this.deps.onEmailProgress?.({
      phase: 'done',
      scanned: messages.length,
      total: messages.length,
      tripsFound: folded.active.length,
    });
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
      onProgress: this.deps.onEmailProgress
        ? (done, total) => this.deps.onEmailProgress?.({ phase: 'scanning', scanned: done, total })
        : undefined,
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
    const parsed = names.map((n) => n.trim()).filter((n) => n.length > 0);
    const match = passengers.find((p) => parsed.some((n) => passengerNameMatches(n, p.fullName)));
    return match?.id;
  }

  /**
   * Resolve the passenger for an imported trip. The Gmail inbox is shared
   * across the whole family, so each booking can be for a different person.
   * Prefer an existing passenger that matches one of the email's names;
   * otherwise auto-create a passenger from the first name on the booking and
   * add it to {@link passengers} so later trips for the same person match.
   */
  private async resolvePassengerForImport(
    passengers: Passenger[],
    names: string[],
  ): Promise<string | undefined> {
    const existingId = this.matchPassengerByName(passengers, names);
    if (existingId) return existingId;

    const newName = names.map((n) => n.trim()).find((n) => n.length > 0);
    if (!newName) return undefined;

    const created = await this.createPassenger({ fullName: newName, accountIds: [] });
    passengers.push(created);
    log.info('Auto-created passenger from email import', { passenger: newName });
    return created.id;
  }

  private mergeEmailTripIntoFlight(existing: Flight, trip: RetrievedTrip): Flight {
    const isPoints = trip.paidPoints != null;
    const segments = toFlightSegments(trip);
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
      durationMinutes: trip.durationMinutes ?? existing.durationMinutes,
      segments: segments ?? existing.segments,
      fareType: trip.fareType ?? existing.fareType,
      originalCost: {
        purchaseType:
          trip.purchaseType ?? (isPoints ? 'points' : 'cash') as Flight['originalCost']['purchaseType'],
        cashUsd: trip.paidCashUsd ?? existing.originalCost.cashUsd,
        points: trip.paidPoints ?? existing.originalCost.points,
        taxesAndFeesUsd: trip.taxesAndFeesUsd ?? existing.originalCost.taxesAndFeesUsd,
        payments: trip.payments ?? existing.originalCost.payments,
      },
      source: FlightSource.Email,
      updatedAt: new Date().toISOString(),
    };
  }

  private async createFlightFromEmailTrip(passengerId: string, trip: RetrievedTrip): Promise<Flight> {
    const now = new Date().toISOString();
    const isPoints = trip.paidPoints != null;
    return this.deps.flights.create({
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
      durationMinutes: trip.durationMinutes,
      segments: toFlightSegments(trip),
      fareType: trip.fareType,
      originalCost: {
        purchaseType: (trip.purchaseType ?? (isPoints ? 'points' : 'cash')) as Flight['originalCost']['purchaseType'],
        cashUsd: trip.paidCashUsd,
        points: trip.paidPoints,
        taxesAndFeesUsd: trip.taxesAndFeesUsd ?? 0,
        payments: trip.payments,
      },
      bookingDate: now.slice(0, 10),
      source: FlightSource.Email,
      monitoring: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * When a points booking was made within the last 24 hours, run a one-off
   * price check and store the real market cash fare on the flight. The
   * Dashboard then shows that fare as the "actual" value for the original cost
   * (rather than a points-to-cash estimate). Best-effort: skipped silently when
   * no provider is configured or the lookup fails.
   */
  private async maybeCaptureBookingPrice(flight: Flight, bookedAt?: number): Promise<void> {
    if (bookedAt == null) return;
    if (Date.now() - bookedAt > 24 * 60 * 60 * 1000) return;
    // Only points bookings show an estimated cash value worth replacing.
    if (flight.originalCost.purchaseType !== PurchaseType.Points) return;
    // Don't re-fetch once we've already captured an actual fare.
    if (flight.originalMarketCashUsd != null) return;
    try {
      const provider = this.createProvider();
      const options = this.comparisonOptions();
      const result = await this.priceCheck.check(flight, provider, undefined, options);
      const cash = result.quote?.cashUsd;
      if (cash == null || !Number.isFinite(cash)) return;
      const updated: Flight = {
        ...flight,
        originalMarketCashUsd: cash,
        updatedAt: new Date().toISOString(),
      };
      await this.deps.flights.update(updated);
      // Persist the quote/comparison so the current price shows right away too.
      await this.deps.quotes.saveLatest(flight.id, result.quote, result.comparison);
      await this.recordPriceHistory(flight.id, result.quote, result.comparison);
      log.info('Captured actual booking price', {
        flightId: flight.id,
        confirmation: flight.confirmationNumber,
        cashUsd: cash,
      });
    } catch (err) {
      log.warn('Booking price capture failed', { flightId: flight.id, error: String(err) });
    }
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

  async deleteFlight(id: string): Promise<void> {
    await this.deps.priceHistory.deleteForFlight(id);
    await this.deps.flights.delete(id);
  }

  // --- Pricing -------------------------------------------------------------

  async checkOne(flightId: string): Promise<FlightWithComparison> {
    const flight = await this.deps.flights.get(flightId);
    if (!flight) throw new Error(`Flight ${flightId} not found.`);
    const provider = this.createProvider();
    const options = this.comparisonOptions();
    const result = await this.priceCheck.check(flight, provider, undefined, options);
    await this.deps.quotes.saveLatest(flight.id, result.quote, result.comparison);
    await this.recordPriceHistory(flight.id, result.quote, result.comparison);
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
        await this.recordPriceHistory(flight.id, result.quote, result.comparison);
        out.push(await this.toFlightWithComparison(flight, result.quote, result.comparison));
      } catch (err) {
        log.warn('Price check failed for flight', { flightId: flight.id, error: String(err) });
        out.push(await this.toFlightWithComparison(flight));
      }
    }
    return out;
  }

  /**
   * Re-estimate points from the STORED cash fares using the current award
   * estimation rate, without hitting any provider/API. Lets the user retune the
   * rate in Settings and see the Dashboard update instantly. Only touches
   * estimated quotes that carry a cash fare; real (scraped) points are left as-is.
   */
  async recomputeEstimates(): Promise<FlightWithComparison[]> {
    const flights = await this.deps.flights.listMonitored();
    const s = this.deps.settings.get();
    // Estimate award points from the stored cash fare using the same cents-per-
    // point rate the user values points at (no API call).
    const estimation = { centsPerPoint: s.pointValueCents / 100 };
    const options = this.comparisonOptions();
    const out: FlightWithComparison[] = [];

    let recomputed = 0;
    for (const flight of flights) {
      const latest = await this.deps.quotes.getLatest(flight.id);
      const quote = latest?.quote;
      // Nothing to recompute without a stored, cash-based estimate.
      if (!quote || !quote.pointsEstimated || quote.cashUsd == null) {
        out.push(await this.toFlightWithComparison(flight, quote, latest?.comparison));
        continue;
      }

      const reEstimated = {
        ...quote,
        points: estimatePointsFromCash(quote.cashUsd, estimation),
        alternatives: quote.alternatives?.map((alt) =>
          alt.pointsEstimated && alt.cashUsd != null
            ? { ...alt, points: estimatePointsFromCash(alt.cashUsd, estimation) }
            : alt,
        ),
      };
      const comparison = this.pricing.compare(flight, reEstimated, options);
      await this.deps.quotes.saveLatest(flight.id, reEstimated, comparison);
      out.push(await this.toFlightWithComparison(flight, reEstimated, comparison));
      recomputed += 1;
    }
    log.info('Recomputed point estimates', {
      centsPerPoint: estimation.centsPerPoint,
      flights: flights.length,
      recomputed,
    });
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
   * Store (or clear) a SerpApi key in the given slot (0-based, max 3) in the OS
   * secret store and mirror the per-slot configured flags in settings. Passing
   * an empty string removes that slot's key.
   */
  async setSerpApiKey(slot: number, key: string): Promise<AppSettings> {
    const account = SERPAPI_SECRET_ACCOUNTS[slot];
    if (!account) {
      throw new Error(`Invalid SerpApi key slot ${slot}.`);
    }
    const trimmed = key.trim();
    if (!trimmed) {
      await this.deps.secrets.deletePassword(account);
    } else {
      await this.deps.secrets.setPassword(account, trimmed);
    }
    const slots = await Promise.all(
      SERPAPI_SECRET_ACCOUNTS.map(async (acc) => Boolean((await this.deps.secrets.getPassword(acc))?.trim())),
    );
    return this.deps.settings.update({ serpApiKeys: slots });
  }

  /**
   * Look up each configured SerpApi key's monthly quota usage via SerpApi's
   * free Account API (doesn't count against the search quota). Returns one
   * entry per configured slot; slots without a key are omitted.
   */
  async getSerpApiUsage(): Promise<SerpApiKeyUsage[]> {
    const fetchJson = async (url: string): Promise<unknown> => {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    };

    const usage: SerpApiKeyUsage[] = [];
    for (let slot = 0; slot < SERPAPI_SECRET_ACCOUNTS.length; slot++) {
      const key = (await this.deps.secrets.getPassword(SERPAPI_SECRET_ACCOUNTS[slot]!))?.trim();
      if (!key) continue;
      try {
        const u = await fetchSerpApiUsage(fetchJson, key);
        usage.push({
          slot,
          thisMonthUsage: u.thisMonthUsage,
          searchesPerMonth: u.searchesPerMonth,
          totalSearchesLeft: u.totalSearchesLeft,
        });
      } catch (err) {
        usage.push({ slot, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return usage;
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
    // Estimate points from a cash fare using the user's cents-per-point rate, so
    // estimates track Southwest's actual award pricing. Tunable in Settings.
    const estimation = { centsPerPoint: s.pointValueCents / 100 };
    if (s.scrapingEnabled && s.fareSource === 'serpapi') {
      return new GoogleFlightsSerpApiProvider({
        fetchJson: async (url) => {
          // SerpApi runs the Google Flights search live, so allow generous time
          // but never hang forever (Node has no default fetch timeout).
          const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        },
        getApiKeys: async () => {
          const keys = await Promise.all(
            SERPAPI_SECRET_ACCOUNTS.map((account) => this.deps.secrets.getPassword(account)),
          );
          return keys
            .map((k) => k?.trim())
            .filter((k): k is string => k != null && k.length > 0);
        },
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
    const priceHistory = await this.deps.priceHistory.list(flight.id);
    return {
      flight,
      passengerName: passenger?.fullName ?? 'Unknown',
      accountLabel: account?.label,
      quote,
      comparison,
      priceHistory,
    };
  }

  /**
   * Append a price observation to the flight's history, but only when the
   * current price differs from the last recorded one. This keeps the series to
   * actual price movements (so the dashboard trend and detail history show
   * meaningful changes rather than a row per check).
   */
  private async recordPriceHistory(
    flightId: string,
    quote: FlightWithComparison['quote'],
    comparison: PriceComparison,
  ): Promise<void> {
    const amount = comparison.currentAmount;
    // No current price (no matching fare found) → nothing to record.
    if (amount == null || !Number.isFinite(amount)) return;

    const prev = await this.deps.priceHistory.latest(flightId);
    // Skip when unchanged (compare to cents/whole-point precision).
    if (prev?.amount != null && Math.round(prev.amount * 100) === Math.round(amount * 100)) return;

    const entry: PriceHistoryEntry = {
      flightId,
      recordedAt: comparison.computedAt ?? new Date().toISOString(),
      purchaseType: comparison.originalPurchaseType,
      amount,
      cashUsd: quote?.cashUsd,
      points: quote?.points,
      valueUsd: comparison.currentValueUsd,
    };
    await this.deps.priceHistory.append(entry);
  }

  private matchPassenger(
    passengers: Passenger[],
    names: string[],
    account: Account,
  ): string | undefined {
    const normalized = names.map((n) => n.trim()).filter((n) => n.length > 0);
    const byName = passengers.find((p) => normalized.some((n) => passengerNameMatches(n, p.fullName)));
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
      durationMinutes: trip.durationMinutes,
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
