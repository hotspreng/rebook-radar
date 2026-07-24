import { PurchaseType } from './common.js';

/**
 * A single recorded price observation for a flight. One entry is appended each
 * time a price check sees a price that differs from the last recorded one, so
 * the series captures the flight's price movement over time (used to render a
 * trend on the dashboard and a history in the flight detail view).
 */
export interface PriceHistoryEntry {
  flightId: string;

  /** When this price was observed (ISO timestamp). */
  recordedAt: string;

  /** Currency the original booking was made in (matches the displayed unit). */
  purchaseType: PurchaseType;

  /** Current price in native units (points or cash USD) at record time. */
  amount?: number;

  /** Current best cash fare in USD, if available. */
  cashUsd?: number;

  /** Current best points price, if available. */
  points?: number;

  /** Current price normalized to USD (points valued via points-to-cash). */
  valueUsd: number;

  /**
   * Marks the point at which the flight was cancelled and rebooked (a new
   * confirmation number). Set on a synthetic entry appended at rebooking time
   * so the trend chart can note where the rebooking happened while keeping the
   * pre-rebooking price history that was carried over from the old flight.
   */
  rebooking?: boolean;
}
