import { Flight, PriceComparison, PriceQuote, PurchaseType } from '../models/index.js';
import { FareType } from '../models/common.js';
import {
  AirlineProvider,
  AirlineSession,
  FlightSearchResult,
} from '../providers/AirlineProvider.js';
import { Logger, logger as defaultLogger } from '../utils/logger.js';
import {
  ComparisonOptions,
  DEFAULT_COMPARISON_OPTIONS,
  PricingComparisonService,
} from './PricingComparisonService.js';

export interface PriceCheckOptions extends ComparisonOptions {
  /** Match window (minutes) around the original departure time. */
  matchToleranceMinutes: number;
}

export const DEFAULT_PRICE_CHECK_OPTIONS: PriceCheckOptions = {
  ...DEFAULT_COMPARISON_OPTIONS,
  matchToleranceMinutes: 90,
};

export interface PriceCheckResult {
  flightId: string;
  quote?: PriceQuote;
  comparison: PriceComparison;
}

/**
 * Orchestrates a single flight's price check end to end:
 *   provider.searchPrice → choose the best matching fare → build a PriceQuote →
 *   compute a PriceComparison.
 *
 * Framework-agnostic: depends only on the AirlineProvider interface and the
 * pure pricing service, so it runs unchanged in desktop and a future web host.
 */
export class PriceCheckService {
  private readonly pricing: PricingComparisonService;
  private readonly log: Logger;

  constructor(
    pricing: PricingComparisonService = new PricingComparisonService(),
    log: Logger = defaultLogger,
  ) {
    this.pricing = pricing;
    this.log = log.child('price-check');
  }

  async check(
    flight: Flight,
    provider: AirlineProvider,
    session: AirlineSession | undefined,
    options: PriceCheckOptions = DEFAULT_PRICE_CHECK_OPTIONS,
  ): Promise<PriceCheckResult> {
    const departureDate = flight.departureDateTime.slice(0, 10);
    this.log.info('Checking price', {
      flightId: flight.id,
      route: `${flight.route.origin.code}-${flight.route.destination.code}`,
      departureDate,
    });

    const results = await provider.searchPrice(
      {
        origin: flight.route.origin.code,
        destination: flight.route.destination.code,
        departureDate,
        preferred: flight.originalCost.purchaseType,
      },
      session,
    );

    const best = this.selectBestMatch(flight, results, options.matchToleranceMinutes);
    const quote = best ? this.toQuote(flight, best, provider.id, results) : undefined;
    const comparison = this.pricing.compare(flight, quote, options);

    return { flightId: flight.id, quote, comparison };
  }

  /**
   * Pick the fare option closest to the original departure time (within the
   * tolerance window), breaking ties by the cheapest relevant price.
   */
  private selectBestMatch(
    flight: Flight,
    results: FlightSearchResult[],
    toleranceMinutes: number,
  ): FlightSearchResult | undefined {
    if (results.length === 0) return undefined;
    const originalMs = Date.parse(flight.departureDateTime);
    const isPoints = flight.originalCost.purchaseType === PurchaseType.Points;

    const scored = results
      .map((r) => {
        const diffMin = Number.isNaN(originalMs)
          ? 0
          : Math.abs(Date.parse(r.departureDateTime) - originalMs) / 60_000;
        const price = isPoints ? r.points ?? Number.MAX_SAFE_INTEGER : r.cashUsd ?? Number.MAX_SAFE_INTEGER;
        return { r, diffMin, price };
      })
      .filter((s) => Number.isNaN(originalMs) || s.diffMin <= toleranceMinutes);

    if (scored.length === 0) return results[0];

    scored.sort((a, b) => a.diffMin - b.diffMin || a.price - b.price);
    return scored[0]!.r;
  }

  private toQuote(
    flight: Flight,
    result: FlightSearchResult,
    providerId: string,
    allResults: FlightSearchResult[] = [],
  ): PriceQuote {
    return {
      flightId: flight.id,
      fareType: result.fareType ?? FareType.Unknown,
      cashUsd: result.cashUsd,
      points: result.points,
      pointsEstimated: result.pointsEstimated,
      pointsTaxesAndFeesUsd: result.pointsTaxesAndFeesUsd,
      departureDateTime: result.departureDateTime,
      arrivalDateTime: result.arrivalDateTime,
      durationMinutes: result.durationMinutes,
      fetchedAt: new Date().toISOString(),
      providerId,
      preferredPurchaseType: flight.originalCost.purchaseType,
      alternatives: this.buildAlternatives(flight, allResults),
    };
  }

  /**
   * All same-day options, cheapest first in the original booking's currency, so
   * the UI can show cheaper alternative departure times. De-duplicated by
   * departure time + flight number.
   */
  private buildAlternatives(
    flight: Flight,
    results: FlightSearchResult[],
  ): PriceQuote['alternatives'] {
    if (results.length === 0) return undefined;
    const isPoints = flight.originalCost.purchaseType === PurchaseType.Points;
    const priceOf = (r: FlightSearchResult): number =>
      (isPoints ? r.points : r.cashUsd) ?? Number.MAX_SAFE_INTEGER;

    const seen = new Set<string>();
    const alternatives = results
      .filter((r) => priceOf(r) !== Number.MAX_SAFE_INTEGER)
      .filter((r) => {
        const key = `${r.departureDateTime}|${r.flightNumber ?? ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((r) => ({
        flightNumber: r.flightNumber,
        departureDateTime: r.departureDateTime,
        arrivalDateTime: r.arrivalDateTime,
        fareType: r.fareType ?? FareType.Unknown,
        cashUsd: r.cashUsd,
        points: r.points,
        pointsEstimated: r.pointsEstimated,
        pointsTaxesAndFeesUsd: r.pointsTaxesAndFeesUsd,
        stops: r.stops,
        durationMinutes: r.durationMinutes,
      }))
      .sort((a, b) => {
        const pa = (isPoints ? a.points : a.cashUsd) ?? Number.MAX_SAFE_INTEGER;
        const pb = (isPoints ? b.points : b.cashUsd) ?? Number.MAX_SAFE_INTEGER;
        return pa - pb;
      });

    return alternatives.length > 0 ? alternatives : undefined;
  }
}
