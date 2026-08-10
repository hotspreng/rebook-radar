/**
 * Cash → Rapid Rewards points estimation.
 *
 * Southwest sells award seats at a roughly linear rate tied to the cash fare:
 * the points portion covers the base fare while the customer still pays a small
 * cash amount in taxes & fees. When we can read a flight's cash price but not its
 * points price (e.g. the points toggle didn't render, or pricing came from a
 * third-party source that only carries cash), we approximate the points cost
 * from the cash fare using a configurable redemption rate.
 *
 * This is an ESTIMATE, not a quote. The default rate is a reasonable
 * Wanna Get Away redemption value; users can override it in Settings.
 */

/** Default Rapid Rewards redemption value, in US dollars per point (~1.35¢/pt). */
export const DEFAULT_CENTS_PER_POINT = 0.0135;

/** Typical domestic one-way taxes & fees on an award ticket (USD). */
export const DEFAULT_AWARD_TAXES_USD = 5.6;

export interface PointsEstimationOptions {
  /** Redemption value in USD per point. Defaults to {@link DEFAULT_CENTS_PER_POINT}. */
  centsPerPoint?: number;
  /**
   * Cash taxes & fees (USD) the traveler still pays on an award ticket; this is
   * subtracted from the cash fare before converting, since points only cover the
   * base fare. Defaults to {@link DEFAULT_AWARD_TAXES_USD}.
   */
  awardTaxesUsd?: number;
}

/**
 * Estimate the Rapid Rewards points cost of a flight from its cash fare.
 *
 * @param cashUsd Total cash fare in USD (base fare + taxes & fees).
 * @returns Estimated points (rounded to the nearest 10), or `undefined` when the
 *          input is missing or non-positive.
 */
export function estimatePointsFromCash(
  cashUsd: number | undefined,
  options: PointsEstimationOptions = {},
): number | undefined {
  if (cashUsd == null || !Number.isFinite(cashUsd) || cashUsd <= 0) return undefined;

  const centsPerPoint = options.centsPerPoint ?? DEFAULT_CENTS_PER_POINT;
  const awardTaxesUsd = options.awardTaxesUsd ?? DEFAULT_AWARD_TAXES_USD;
  if (!Number.isFinite(centsPerPoint) || centsPerPoint <= 0) return undefined;

  // Points only cover the base fare; the traveler still pays taxes/fees in cash.
  const baseFareUsd = Math.max(cashUsd - awardTaxesUsd, 0);
  if (baseFareUsd <= 0) return undefined;

  const rawPoints = baseFareUsd / centsPerPoint;
  // Southwest prices award seats in whole points; round to a tidy increment.
  return Math.round(rawPoints / 10) * 10;
}
