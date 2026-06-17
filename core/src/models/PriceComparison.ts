import { PurchaseType, Recommendation } from './common.js';

/**
 * The result of comparing what was originally paid for a flight against its
 * current price. All values are computed by the PricingComparisonService.
 */
export interface PriceComparison {
  flightId: string;

  /** Currency the original booking was made in. */
  originalPurchaseType: PurchaseType;

  /** Original cost normalized to USD (points valued via points-to-cash). */
  originalValueUsd: number;
  /** Current best price normalized to USD. */
  currentValueUsd: number;

  /** Raw original amount in its native unit. */
  originalAmount: number;
  /** Raw current amount in the same unit as the original (cash or points). */
  currentAmount?: number;

  /** Savings in USD (positive = you would save money by rebooking). */
  savingsUsd: number;
  /** Savings in native units (points if points booking, else USD). */
  savingsNative?: number;
  /** Percent difference vs original (positive = cheaper now). */
  percentDifference: number;

  /** The point value (cents per point) used for normalization. */
  pointValueCents: number;

  recommendation: Recommendation;

  /**
   * Plain-language explanation of the recommendation, incorporating Southwest
   * policy (no change fees, refundable points, cash → flight credit).
   */
  rationale: string;

  /** When the comparison was computed. */
  computedAt: string;
}
