/**
 * Points-to-cash valuation helpers.
 *
 * Rapid Rewards points have no fixed cash value; their worth depends on
 * redemption. A configurable "cents per point" lets the user toggle between
 * conservative (~1.3¢) and optimistic (~1.5¢) valuations.
 */

export const MIN_REASONABLE_CPP = 1.0;
export const MAX_REASONABLE_CPP = 2.0;

/** Convert a points amount to USD at a given cents-per-point value. */
export function pointsToUsd(points: number, centsPerPoint: number): number {
  return (points * centsPerPoint) / 100;
}

/** Convert a USD amount to its equivalent points at a given cents-per-point. */
export function usdToPoints(usd: number, centsPerPoint: number): number {
  if (centsPerPoint <= 0) return 0;
  return Math.round((usd * 100) / centsPerPoint);
}

/** Clamp a user-provided cents-per-point into a sane range. */
export function normalizeCentsPerPoint(centsPerPoint: number): number {
  if (Number.isNaN(centsPerPoint) || centsPerPoint <= 0) return 1.4;
  return Math.min(MAX_REASONABLE_CPP, Math.max(MIN_REASONABLE_CPP, centsPerPoint));
}
