import { AccountCredentials } from '../models/Account.js';
import { PurchaseType } from '../models/common.js';
import { CaptchaRequiredError, LoginFailedError, NoResultsError, SiteChangedError } from '../errors.js';
import { Logger, logger as defaultLogger } from '../utils/logger.js';
import {
  AirlineProvider,
  AirlineSession,
  FlightSearchQuery,
  FlightSearchResult,
  RetrievedTrip,
} from './AirlineProvider.js';
import {
  RawFareOption,
  RawTrip,
  SouthwestClientSession,
  SouthwestScraperClient,
} from './SouthwestScraperClient.js';
import {
  looksLikeCaptcha,
  looksLikeLoginFailure,
  normalizeFareType,
  parseCurrency,
  parsePoints,
} from './southwestParsing.js';
import { estimatePointsFromCash, PointsEstimationOptions } from './pointsEstimation.js';

export const SOUTHWEST_PROVIDER_ID = 'southwest';

/**
 * Southwest implementation of {@link AirlineProvider}.
 *
 * Contains the Southwest-specific *flow and parsing* logic (framework-agnostic)
 * and delegates raw browser interaction to an injected
 * {@link SouthwestScraperClient}. This keeps all airline business logic in
 * /core while the Playwright driver stays in /desktop.
 */
export class SouthwestProvider implements AirlineProvider {
  readonly id = SOUTHWEST_PROVIDER_ID;
  readonly name = 'Southwest Airlines';

  private readonly client: SouthwestScraperClient;
  private readonly log: Logger;
  private readonly estimation: PointsEstimationOptions;

  constructor(
    client: SouthwestScraperClient,
    log: Logger = defaultLogger,
    estimation: PointsEstimationOptions = {},
  ) {
    this.client = client;
    this.log = log.child('southwest');
    this.estimation = estimation;
  }

  async login(credentials: AccountCredentials, accountId: string): Promise<AirlineSession> {
    this.log.info('Attempting login', { accountId }); // credentials intentionally omitted
    const { session, pageText } = await this.client.login(credentials, accountId);

    if (looksLikeCaptcha(pageText)) {
      await this.safeClose(session);
      throw new CaptchaRequiredError(
        'Southwest presented a human-verification challenge. Re-run with the visible browser ' +
          '(SCRAPER_HEADFUL=true) and complete it manually.',
        this.id,
      );
    }
    if (looksLikeLoginFailure(pageText)) {
      await this.safeClose(session);
      throw new LoginFailedError(undefined, this.id);
    }

    return {
      providerId: this.id,
      accountId,
      handle: session,
      createdAt: new Date().toISOString(),
    };
  }

  async getUpcomingTrips(session: AirlineSession): Promise<RetrievedTrip[]> {
    const clientSession = this.asClientSession(session);
    const { trips, pageText } = await this.client.fetchTrips(clientSession);

    if (looksLikeCaptcha(pageText)) {
      throw new CaptchaRequiredError(undefined, this.id);
    }
    if (!Array.isArray(trips)) {
      throw new SiteChangedError('Could not read trips from My Trips page.', this.id);
    }

    return trips.map((t) => this.mapTrip(t));
  }

  async searchPrice(
    query: FlightSearchQuery,
    session?: AirlineSession,
  ): Promise<FlightSearchResult[]> {
    const clientSession = session ? this.asClientSession(session) : undefined;
    const { options, pageText } = await this.client.searchFlights(query, clientSession);

    if (looksLikeCaptcha(pageText)) {
      throw new CaptchaRequiredError(undefined, this.id);
    }
    if (!options || options.length === 0) {
      throw new NoResultsError(
        `No fares found for ${query.origin}→${query.destination} on ${query.departureDate}.`,
        this.id,
      );
    }

    return options.map((o) => this.mapFareOption(o));
  }

  async logout(session: AirlineSession): Promise<void> {
    await this.safeClose(this.asClientSession(session));
  }

  // --- mapping helpers -----------------------------------------------------

  private mapTrip(raw: RawTrip): RetrievedTrip {
    const cash = parseCurrency(raw.priceText);
    const points = parsePoints(raw.pointsText);
    const purchaseType = points != null ? PurchaseType.Points : cash != null ? PurchaseType.Cash : undefined;
    return {
      confirmationNumber: raw.confirmationNumber,
      passengerNames: raw.passengerNames,
      origin: raw.origin,
      destination: raw.destination,
      departureDateTime: raw.departureDateTime,
      arrivalDateTime: raw.arrivalDateTime,
      fareType: normalizeFareType(raw.fareLabel),
      purchaseType,
      paidCashUsd: cash,
      paidPoints: points,
      taxesAndFeesUsd: parseCurrency(raw.taxesText),
    };
  }

  private mapFareOption(raw: RawFareOption): FlightSearchResult {
    const cashUsd = parseCurrency(raw.cashText);
    const scrapedPoints = parsePoints(raw.pointsText);
    // Fall back to an estimate when the site exposed a cash fare but no points.
    const points =
      scrapedPoints ?? estimatePointsFromCash(cashUsd, this.estimation);
    if (scrapedPoints == null && points != null) {
      this.log.debug('Estimated points from cash fare', { cashUsd, estimatedPoints: points });
    }
    return {
      flightNumber: raw.flightNumber,
      departureDateTime: raw.departureDateTime,
      arrivalDateTime: raw.arrivalDateTime,
      fareType: normalizeFareType(raw.fareLabel),
      cashUsd,
      points,
      pointsEstimated: scrapedPoints == null && points != null ? true : undefined,
      pointsTaxesAndFeesUsd: parseCurrency(raw.taxesText),
      stops: raw.stops,
    };
  }

  private asClientSession(session: AirlineSession): SouthwestClientSession {
    const handle = session.handle as SouthwestClientSession | undefined;
    if (!handle || handle.accountId == null) {
      throw new SiteChangedError('Invalid Southwest session handle.', this.id);
    }
    return handle;
  }

  private async safeClose(session: SouthwestClientSession): Promise<void> {
    try {
      await this.client.close(session);
    } catch (err) {
      this.log.warn('Failed to close session cleanly', { error: String(err) });
    }
  }
}
