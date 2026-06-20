import { PurchaseType } from './common.js';

/**
 * A realized rebooking saving.
 *
 * When a tracked flight is rebooked for the same date and route (a new
 * Southwest confirmation re-imported from email) at a lower price than what was
 * originally paid, the drop is recorded here. Unlike {@link PriceHistoryEntry}
 * (which tracks observed market prices over time), a `RebookEvent` represents
 * money/points the user actually saved by acting on a price drop.
 *
 * Savings are always measured against the flight's lifetime-original cost (the
 * first price it was booked at), so re-importing the same lower fare does not
 * double-count and the latest event reflects the full cumulative saving.
 */
export interface RebookEvent {
  id: string;

  /** Flight that was rebooked. */
  flightId: string;
  /** Passenger the flight belongs to, for reporting filters. */
  passengerId: string;
  /** Confirmation number at the time of the rebooking. */
  confirmationNumber: string;
  /** Route, for display in the report (e.g. "ROC → MDW"). */
  routeLabel: string;
  /** Departure date (origin local, YYYY-MM-DD) the rebooking applies to. */
  departureDate: string;

  /** Currency the booking was made in. */
  purchaseType: PurchaseType;

  /** Original (lifetime-first) amount paid, in native units (points or USD). */
  originalAmount: number;
  /** New amount paid after rebooking, in native units (points or USD). */
  newAmount: number;

  /**
   * Points saved by the rebooking (original − new), when the booking is a
   * points booking. Zero/undefined for cash bookings.
   */
  pointsSaved?: number;
  /**
   * Actual cash saved in USD (original − new), when the booking is a cash
   * booking. Zero/undefined for points bookings.
   */
  cashSavedUsd?: number;
  /**
   * Estimated USD value of the saving, normalized for both kinds of booking.
   * For cash bookings this equals {@link cashSavedUsd}; for points bookings it
   * is `pointsSaved` valued at the point value used at record time.
   */
  estimatedValueUsd: number;
  /** Cents-per-point used to value points savings when this event was recorded. */
  pointValueCents: number;

  /** When the rebooking was detected/recorded (ISO timestamp). */
  recordedAt: string;
}

export type NewRebookEvent = Omit<RebookEvent, 'id'>;
