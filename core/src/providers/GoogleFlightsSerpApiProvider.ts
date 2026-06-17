import { AccountCredentials } from '../models/Account.js';
import { FareType } from '../models/common.js';
import { AirlineError, NoResultsError } from '../errors.js';
import { Logger, logger as defaultLogger } from '../utils/logger.js';
import {
  AirlineProvider,
  AirlineSession,
  FlightSearchQuery,
  FlightSearchResult,
  RetrievedTrip,
} from './AirlineProvider.js';
import { estimatePointsFromCash, PointsEstimationOptions } from './pointsEstimation.js';

export const GOOGLE_FLIGHTS_SERPAPI_PROVIDER_ID = 'google-flights-serpapi';

/** Fetches a URL and returns the parsed JSON body. Injected so /core stays
 *  framework-agnostic and unit-testable (desktop passes a `fetch` wrapper). */
export type JsonFetch = (url: string) => Promise<unknown>;

export interface GoogleFlightsSerpApiOptions {
  /** Performs the HTTP GET and parses JSON. Should throw on non-2xx responses. */
  fetchJson: JsonFetch;
  /** Resolves the SerpApi key (e.g. from the OS secret store). */
  getApiKey: () => Promise<string | undefined>;
  /** Cash→points conversion settings. */
  estimation?: PointsEstimationOptions;
  /** SerpApi search endpoint. Defaults to the public one. */
  baseUrl?: string;
  /** Airline display name to keep (exact match on each segment). Defaults to "Southwest". */
  airlineName?: string;
  log?: Logger;
}

/** Minimal shape of the SerpApi `google_flights` response we consume. */
interface SerpFlightSegment {
  departure_airport?: { id?: string; time?: string };
  arrival_airport?: { id?: string; time?: string };
  airline?: string;
  flight_number?: string;
}
interface SerpItinerary {
  flights?: SerpFlightSegment[];
  layovers?: unknown[];
  price?: number;
}
interface SerpResponse {
  error?: string;
  best_flights?: SerpItinerary[];
  other_flights?: SerpItinerary[];
}

/**
 * {@link AirlineProvider} that reads **cash** fares from Google Flights via the
 * SerpApi `google_flights` engine, then estimates the Rapid Rewards points cost.
 *
 * Southwest does not publish award (points) pricing to any third party — only
 * southwest.com shows it — so this provider returns estimated points (flagged
 * via {@link FlightSearchResult.pointsEstimated}). Account login / trip import
 * are not supported here; use the scraper or Gmail import for those.
 */
export class GoogleFlightsSerpApiProvider implements AirlineProvider {
  readonly id = GOOGLE_FLIGHTS_SERPAPI_PROVIDER_ID;
  readonly name = 'Google Flights (SerpApi)';

  private readonly fetchJson: JsonFetch;
  private readonly getApiKey: () => Promise<string | undefined>;
  private readonly estimation: PointsEstimationOptions;
  private readonly baseUrl: string;
  private readonly airlineName: string;
  private readonly log: Logger;

  constructor(options: GoogleFlightsSerpApiOptions) {
    this.fetchJson = options.fetchJson;
    this.getApiKey = options.getApiKey;
    this.estimation = options.estimation ?? {};
    this.baseUrl = options.baseUrl ?? 'https://serpapi.com/search.json';
    this.airlineName = options.airlineName ?? 'Southwest';
    this.log = (options.log ?? defaultLogger).child('serpapi');
  }

  async login(): Promise<AirlineSession> {
    throw new AirlineError(
      'NOT_SUPPORTED',
      'Account login is not available with the SerpApi fare source. Import trips from Gmail, ' +
        'or switch the fare source to the scraper in Settings.',
      { providerId: this.id },
    );
  }

  async getUpcomingTrips(): Promise<RetrievedTrip[]> {
    throw new AirlineError(
      'NOT_SUPPORTED',
      'Trip import is not available with the SerpApi fare source. Use Gmail import instead.',
      { providerId: this.id },
    );
  }

  async searchPrice(query: FlightSearchQuery): Promise<FlightSearchResult[]> {
    const apiKey = (await this.getApiKey())?.trim();
    if (!apiKey) {
      throw new AirlineError(
        'NOT_SUPPORTED',
        'No SerpApi key configured. Add one in Settings → Live price source.',
        { providerId: this.id },
      );
    }

    const url = this.buildUrl(query, apiKey);
    this.log.info('Querying SerpApi google_flights', {
      origin: query.origin,
      destination: query.destination,
      date: query.departureDate,
    });

    let raw: unknown;
    try {
      raw = await this.fetchJson(url);
    } catch (err) {
      throw new AirlineError('NETWORK', `SerpApi request failed: ${String(err)}`, {
        providerId: this.id,
        cause: err,
      });
    }

    const body = (raw ?? {}) as SerpResponse;
    if (body.error) {
      throw new AirlineError('NETWORK', `SerpApi error: ${body.error}`, { providerId: this.id });
    }

    const itineraries = [...(body.best_flights ?? []), ...(body.other_flights ?? [])];
    const results = itineraries
      .map((it) => this.mapItinerary(it))
      .filter((r): r is FlightSearchResult => r != null);

    if (results.length === 0) {
      throw new NoResultsError(
        `No ${this.airlineName} fares found for ${query.origin}→${query.destination} on ${query.departureDate}.`,
        this.id,
      );
    }
    return results;
  }

  async logout(): Promise<void> {
    /* Stateless HTTP provider — nothing to release. */
  }

  // --- helpers -------------------------------------------------------------

  private buildUrl(query: FlightSearchQuery, apiKey: string): string {
    const params = new URLSearchParams({
      engine: 'google_flights',
      departure_id: query.origin,
      arrival_id: query.destination,
      outbound_date: query.departureDate,
      type: '2', // one-way
      currency: 'USD',
      hl: 'en',
      adults: String(query.passengers ?? 1),
      api_key: apiKey,
    });
    return `${this.baseUrl}?${params.toString()}`;
  }

  /** Keep only all-Southwest itineraries; convert to a search result with
   *  estimated points. Returns `undefined` for non-matching/unparseable items. */
  private mapItinerary(it: SerpItinerary): FlightSearchResult | undefined {
    const segments = it.flights ?? [];
    if (segments.length === 0) return undefined;

    const allMatch = segments.every(
      (s) => (s.airline ?? '').toLowerCase() === this.airlineName.toLowerCase(),
    );
    if (!allMatch) return undefined;

    const first = segments[0];
    const last = segments[segments.length - 1];
    if (!first || !last) return undefined;
    const departure = this.toIso(first.departure_airport?.time);
    if (!departure) return undefined;

    const cashUsd = typeof it.price === 'number' && it.price > 0 ? it.price : undefined;
    const points = estimatePointsFromCash(cashUsd, this.estimation);
    const stops = it.layovers?.length ?? segments.length - 1;

    return {
      flightNumber: segments
        .map((s) => s.flight_number)
        .filter(Boolean)
        .join(' / ') || undefined,
      departureDateTime: departure,
      arrivalDateTime: this.toIso(last.arrival_airport?.time),
      fareType: FareType.Unknown,
      cashUsd,
      points,
      pointsEstimated: points != null ? true : undefined,
      stops,
    };
  }

  /** Convert SerpApi's "YYYY-MM-DD HH:mm" local time into an ISO-like string. */
  private toIso(time: string | undefined): string | undefined {
    if (!time) return undefined;
    return time.includes(' ') ? time.replace(' ', 'T') : time;
  }
}
