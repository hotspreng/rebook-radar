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

/**
 * How close (in minutes) a returned fare must depart to the booked flight's
 * time for the fast/cached path to be considered to "cover" that booking. When
 * nothing departs within this window, a deep search is run to reproduce the
 * browser's full results (so a booked connection isn't missed in favour of the
 * fast path's nonstops). Matches the price-check matcher's default tolerance.
 */
const NEAR_PREFERRED_WINDOW_MIN = 90;

/** Fetches a URL and returns the parsed JSON body. Injected so /core stays
 *  framework-agnostic and unit-testable (desktop passes a `fetch` wrapper). */
export type JsonFetch = (url: string) => Promise<unknown>;

export interface GoogleFlightsSerpApiOptions {
  /** Performs the HTTP GET and parses JSON. Should throw on non-2xx responses. */
  fetchJson: JsonFetch;
  /** Resolves a single SerpApi key (e.g. from the OS secret store). */
  getApiKey?: () => Promise<string | undefined>;
  /**
   * Resolves an ordered list of SerpApi keys. The provider tries them in order,
   * rotating to the next when one runs out of free monthly searches. Takes
   * precedence over {@link getApiKey} when provided.
   */
  getApiKeys?: () => Promise<string[]>;
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
  /** Total travel time in minutes, across all segments + layovers. */
  total_duration?: number;
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
  private readonly getApiKey?: () => Promise<string | undefined>;
  private readonly getApiKeys?: () => Promise<string[]>;
  private readonly estimation: PointsEstimationOptions;
  private readonly baseUrl: string;
  private readonly airlineName: string;
  private readonly log: Logger;

  constructor(options: GoogleFlightsSerpApiOptions) {
    this.fetchJson = options.fetchJson;
    this.getApiKey = options.getApiKey;
    this.getApiKeys = options.getApiKeys;
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
    const keys = await this.resolveKeys();
    if (keys.length === 0) {
      throw new AirlineError(
        'NOT_SUPPORTED',
        'No SerpApi key configured. Add one in Settings → Live price source.',
        { providerId: this.id },
      );
    }

    let lastQuotaError: unknown;
    for (let i = 0; i < keys.length; i++) {
      const apiKey = keys[i]!;
      const isLast = i === keys.length - 1;

      const first = await this.querySerpApi(query, apiKey, false, i + 1, keys.length);
      if (first.quota) {
        this.log.warn('SerpApi key out of searches — rotating to next key', { keySlot: i + 1 });
        lastQuotaError = first.error;
        if (!isLast) continue;
        break;
      }
      let body = first.body;

      // Google Flights' fast/cached path sometimes returns nothing for a valid
      // route+date that genuinely has flights — and other times returns only a
      // subset (e.g. nonstops) that omits the booked itinerary (a connection).
      // A deep search reproduces the browser's full results, so retry once when
      // the fast path is empty OR has no fare near the booked departure time.
      const needsDeepSearch =
        this.isEmptyResponse(body) || !this.hasFareNearPreferred(body, query);
      if (needsDeepSearch) {
        this.log.info('Retrying with deep_search', {
          origin: query.origin,
          destination: query.destination,
          date: query.departureDate,
          reason: this.isEmptyResponse(body) ? 'empty' : 'no-near-time-match',
        });
        const deep = await this.querySerpApi(query, apiKey, true, i + 1, keys.length);
        if (deep.quota) {
          lastQuotaError = deep.error;
          if (!isLast) continue;
          // No more keys — fall through so the empty body throws a no-results error.
        } else if (!this.isEmptyResponse(deep.body)) {
          body = deep.body;
        }
      }

      if (body.error) {
        // Google Flights returned no data even with deep search. This is a "no
        // fares right now" condition, not a failure — surface a clear message
        // instead of the raw SerpApi error text.
        if (this.isNoResultsError(body.error)) {
          this.log.info('Google Flights returned no results', {
            origin: query.origin,
            destination: query.destination,
            date: query.departureDate,
          });
          throw new NoResultsError(
            `Google Flights has no ${this.airlineName} fares for ` +
              `${query.origin}→${query.destination} on ${query.departureDate} right now. ` +
              `Try again later, or check southwest.com directly.`,
            this.id,
          );
        }
        throw new AirlineError('NETWORK', `SerpApi error: ${body.error}`, { providerId: this.id });
      }

      return this.parseResults(body, query, i + 1);
    }

    throw new AirlineError(
      'NETWORK',
      `All ${keys.length} SerpApi key(s) are out of searches. Add another key in Settings or wait ` +
        `for the monthly quota to reset. (${String(lastQuotaError)})`,
      { providerId: this.id },
    );
  }

  /**
   * Perform a single SerpApi search. Returns the parsed body, or a `quota`
   * signal when that key has exhausted its monthly searches (so the caller can
   * rotate to the next key). Throws an {@link AirlineError} on network failure.
   */
  private async querySerpApi(
    query: FlightSearchQuery,
    apiKey: string,
    deepSearch: boolean,
    keySlot: number,
    keyCount: number,
  ): Promise<{ quota: true; error: unknown } | { quota: false; body: SerpResponse }> {
    const url = this.buildUrl(query, apiKey, deepSearch);
    this.log.info('Querying SerpApi google_flights', {
      origin: query.origin,
      destination: query.destination,
      date: query.departureDate,
      keySlot,
      keyCount,
      deepSearch,
    });

    let raw: unknown;
    try {
      raw = await this.fetchJson(url);
    } catch (err) {
      if (this.isQuotaError(String(err))) return { quota: true, error: err };
      throw new AirlineError('NETWORK', `SerpApi request failed: ${String(err)}`, {
        providerId: this.id,
        cause: err,
      });
    }

    const body = (raw ?? {}) as SerpResponse;
    if (body.error && this.isQuotaError(body.error)) {
      return { quota: true, error: new Error(body.error) };
    }
    return { quota: false, body };
  }

  /** True when SerpApi returned no usable itineraries (an explicit no-results
   *  error, or zero flights in both result buckets). */
  private isEmptyResponse(body: SerpResponse): boolean {
    if (body.error) return this.isNoResultsError(body.error);
    const total = (body.best_flights?.length ?? 0) + (body.other_flights?.length ?? 0);
    return total === 0;
  }

  /**
   * True when the response contains a matching-airline fare departing close to
   * the booked flight's time (within {@link NEAR_PREFERRED_WINDOW_MIN}). When
   * the caller didn't supply a preferred time, always true (no constraint). Used
   * to decide whether the fast path's results actually cover the booked
   * itinerary, or a deep search is needed to surface it (e.g. a connection that
   * the fast/cached path dropped in favour of nonstops).
   */
  private hasFareNearPreferred(body: SerpResponse, query: FlightSearchQuery): boolean {
    const preferred = query.preferredDepartureTime
      ? Date.parse(query.preferredDepartureTime)
      : NaN;
    if (Number.isNaN(preferred)) return true;
    if (body.error) return false;

    const itineraries = [...(body.best_flights ?? []), ...(body.other_flights ?? [])];
    return itineraries.some((it) => {
      const result = this.mapItinerary(it);
      if (!result) return false;
      const dep = Date.parse(result.departureDateTime);
      if (Number.isNaN(dep)) return false;
      return Math.abs(dep - preferred) / 60_000 <= NEAR_PREFERRED_WINDOW_MIN;
    });
  }

  /** Resolve the ordered list of usable API keys (multi-key takes precedence). */
  private async resolveKeys(): Promise<string[]> {
    if (this.getApiKeys) {
      const keys = await this.getApiKeys();
      return keys.map((k) => k.trim()).filter((k) => k.length > 0);
    }
    const single = (await this.getApiKey?.())?.trim();
    return single ? [single] : [];
  }

  /** True when a SerpApi error/message indicates the monthly search quota is exhausted. */
  private isQuotaError(message: string): boolean {
    return /run out of searches|ran out of searches|exceeded|out of searches|plan searches|monthly search|account.*limit|HTTP 429|429/i.test(
      message,
    );
  }

  /** True when SerpApi reports Google Flights returned no itineraries for the query. */
  private isNoResultsError(message: string): boolean {
    return /returned? any results|hasn't returned|has not returned|no results|didn't return any|did not return any/i.test(
      message,
    );
  }

  /** Map a successful SerpApi response into search results (or throw NoResults). */
  private parseResults(
    body: SerpResponse,
    query: FlightSearchQuery,
    keySlot: number,
  ): FlightSearchResult[] {
    const itineraries = [...(body.best_flights ?? []), ...(body.other_flights ?? [])];
    const results = itineraries
      .map((it) => this.mapItinerary(it))
      .filter((r): r is FlightSearchResult => r != null);

    this.log.info('SerpApi responded', {
      best: body.best_flights?.length ?? 0,
      other: body.other_flights?.length ?? 0,
      keySlot,
      airlinesSeen: [
        ...new Set(
          itineraries.flatMap((it) => (it.flights ?? []).map((s) => s.airline ?? '?')),
        ),
      ],
      matched: results.length,
      centsPerPoint: this.estimation.centsPerPoint,
      fares: results.map((r) => ({ cashUsd: r.cashUsd, points: r.points })),
    });

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

  private buildUrl(query: FlightSearchQuery, apiKey: string, deepSearch = false): string {
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
    // Deep search matches the Google Flights browser UI exactly (slower), used
    // as a fallback when the default fast path returns no results.
    if (deepSearch) params.set('deep_search', 'true');
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
      durationMinutes: typeof it.total_duration === 'number' ? it.total_duration : undefined,
    };
  }

  /** Convert SerpApi's "YYYY-MM-DD HH:mm" local time into an ISO-like string. */
  private toIso(time: string | undefined): string | undefined {
    if (!time) return undefined;
    return time.includes(' ') ? time.replace(' ', 'T') : time;
  }
}
