import {
  Flight,
  PriceComparison,
  PriceQuote,
  PurchaseType,
  Recommendation,
} from '../models/index.js';
import { normalizeCentsPerPoint, pointsToUsd, usdToPoints } from './PointsValuation.js';

export interface ComparisonOptions {
  /** Cents per point used to normalize points to USD. */
  pointValueCents: number;
  /** Minimum USD savings to recommend rebooking a cash fare. */
  savingsThresholdUsd: number;
  /** Minimum points savings to recommend rebooking a points fare. */
  savingsThresholdPoints: number;
  /** Clock injection for testability. */
  now?: () => Date;
}

export const DEFAULT_COMPARISON_OPTIONS: ComparisonOptions = {
  pointValueCents: 1.4,
  savingsThresholdUsd: 25,
  savingsThresholdPoints: 2000,
};

/**
 * Pure, deterministic engine that compares an original Southwest booking
 * against a current price quote and recommends "Rebook" or "Keep".
 *
 * Southwest policy embedded in the logic:
 *  - No change/cancel fees on any fare.
 *  - Points bookings: points are fully refundable to the account; taxes/fees
 *    refunded to original form of payment.
 *  - Cash (Wanna Get Away) bookings: refunded as Transferable Flight Credit /
 *    flight credit that can be applied to a new, cheaper booking — you keep the
 *    leftover difference.
 *
 * Because there are no penalties, ANY genuine price drop is "free money", so
 * the only question is whether the drop clears the user's alert threshold.
 */
export class PricingComparisonService {
  compare(
    flight: Flight,
    quote: PriceQuote | undefined,
    options: ComparisonOptions = DEFAULT_COMPARISON_OPTIONS,
  ): PriceComparison {
    const now = options.now ?? (() => new Date());
    const pointValueCents = normalizeCentsPerPoint(options.pointValueCents);
    const computedAt = now().toISOString();

    const original = flight.originalCost;
    const isPoints = original.purchaseType === PurchaseType.Points;

    const originalAmount = isPoints ? original.points ?? 0 : original.cashUsd ?? 0;
    const originalValueUsd = isPoints
      ? pointsToUsd(original.points ?? 0, pointValueCents) + original.taxesAndFeesUsd
      : (original.cashUsd ?? 0) + 0; // cash fare already includes taxes

    // No quote → we cannot recommend anything yet.
    if (!quote) {
      return {
        flightId: flight.id,
        originalPurchaseType: original.purchaseType,
        originalValueUsd: round2(originalValueUsd),
        currentValueUsd: 0,
        originalAmount,
        savingsUsd: 0,
        percentDifference: 0,
        pointValueCents,
        recommendation: Recommendation.Unknown,
        rationale: 'No current price available yet. Run a price check to compare.',
        computedAt,
      };
    }

    // Resolve the current amount in the SAME unit as the original purchase.
    const { currentAmount, currentValueUsd } = this.resolveCurrent(
      isPoints,
      quote,
      pointValueCents,
    );

    const savingsNative = round(originalAmount - currentAmount, isPoints ? 0 : 2);
    const savingsUsd = round2(originalValueUsd - currentValueUsd);
    const percentDifference =
      originalAmount > 0 ? round1((savingsNative / originalAmount) * 100) : 0;

    const threshold = isPoints ? options.savingsThresholdPoints : options.savingsThresholdUsd;
    const meetsThreshold = savingsNative >= threshold && savingsNative > 0;
    const recommendation = meetsThreshold ? Recommendation.Rebook : Recommendation.Keep;

    return {
      flightId: flight.id,
      originalPurchaseType: original.purchaseType,
      originalValueUsd: round2(originalValueUsd),
      currentValueUsd: round2(currentValueUsd),
      originalAmount,
      currentAmount,
      savingsUsd,
      savingsNative,
      percentDifference,
      pointValueCents,
      recommendation,
      rationale: this.buildRationale({
        isPoints,
        savingsNative,
        savingsUsd,
        threshold,
        recommendation,
      }),
      computedAt,
    };
  }

  private resolveCurrent(
    isPoints: boolean,
    quote: PriceQuote,
    pointValueCents: number,
  ): { currentAmount: number; currentValueUsd: number } {
    if (isPoints) {
      // Prefer a real points quote; fall back to converting the cash quote.
      const currentPoints =
        quote.points ?? (quote.cashUsd != null ? usdToPoints(quote.cashUsd, pointValueCents) : 0);
      const taxes = quote.pointsTaxesAndFeesUsd ?? 0;
      return {
        currentAmount: currentPoints,
        currentValueUsd: round2(pointsToUsd(currentPoints, pointValueCents) + taxes),
      };
    }
    const currentCash =
      quote.cashUsd ?? (quote.points != null ? pointsToUsd(quote.points, pointValueCents) : 0);
    return { currentAmount: round2(currentCash), currentValueUsd: round2(currentCash) };
  }

  private buildRationale(args: {
    isPoints: boolean;
    savingsNative: number;
    savingsUsd: number;
    threshold: number;
    recommendation: Recommendation;
  }): string {
    const { isPoints, savingsNative, savingsUsd, threshold, recommendation } = args;

    if (recommendation === Recommendation.Rebook) {
      if (isPoints) {
        return (
          `The current points price is ${formatPoints(savingsNative)} points lower ` +
          `(~$${savingsUsd.toFixed(2)} value). Southwest charges no change fees and points are ` +
          `fully refundable, so cancel and rebook: your original points return to the account ` +
          `and you re-book at the lower price, pocketing the difference.`
        );
      }
      return (
        `The current fare is $${savingsNative.toFixed(2)} cheaper. Southwest has no change fees ` +
        `and refunds Wanna Get Away fares as flight credit, so cancel and rebook — the leftover ` +
        `$${savingsNative.toFixed(2)} stays as usable flight credit.`
      );
    }

    if (savingsNative > 0) {
      const unit = isPoints ? `${formatPoints(savingsNative)} points` : `$${savingsNative.toFixed(2)}`;
      const thr = isPoints ? `${formatPoints(threshold)} points` : `$${threshold.toFixed(2)}`;
      return (
        `There is a small drop of ${unit}, but it is below your alert threshold of ${thr}. ` +
        `Keep the current booking for now.`
      );
    }

    return 'The current price is the same or higher than what you paid. Keep your booking.';
  }
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
const round2 = (v: number) => round(v, 2);
const round1 = (v: number) => round(v, 1);

function formatPoints(points: number): string {
  return Math.round(points).toLocaleString('en-US');
}
