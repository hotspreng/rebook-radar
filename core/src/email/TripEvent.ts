import { RetrievedTrip } from '../providers/AirlineProvider.js';
import { Airline } from '../models/common.js';

/** The kind of change a Southwest email represents for a given confirmation. */
export enum TripEventType {
  /** A new booking confirmation. */
  Booked = 'booked',
  /** An itinerary/schedule change or rebooking confirmation. */
  Changed = 'changed',
  /** A cancellation / refund / flight-credit confirmation. */
  Cancelled = 'cancelled',
}

/**
 * A single parsed event derived from one Southwest email. Events are folded
 * per confirmation number (latest-wins) to compute the current trip state.
 */
export interface ParsedTripEvent {
  type: TripEventType;
  /** Source email id (for traceability / dedupe). */
  emailId: string;
  /** When the email arrived (ms since epoch); the ordering key for folding. */
  occurredAt: number;
  /** The 6-character Southwest confirmation number (PNR). */
  confirmationNumber: string;
  /**
   * Parsed trip details. Present for Booked/Changed events; omitted for
   * Cancelled events (which only need the confirmation number).
   */
  trip?: RetrievedTrip;
}

/**
 * A points/miles redeposit (credit) parsed from an airline change-confirmation
 * email — e.g. United's "New purchase summary → Redeposit 12,400 miles" sent
 * when a traveler voluntarily changes one leg of a multi-leg booking.
 *
 * Unlike a {@link ParsedTripEvent}, a credit carries no per-leg attribution:
 * the email states a single refunded amount for the whole confirmation, so the
 * importer cannot know which direction it applies to. These are surfaced to the
 * user as a review item to resolve by hand.
 */
export interface MileageCreditEvent {
  airline: Airline;
  /** The confirmation number (PNR) the credit applies to. */
  confirmationNumber: string;
  /** Source email id (for traceability / dedupe). */
  emailId: string;
  /** When the email arrived (ms since epoch). */
  occurredAt: number;
  /** Email subject, for display in the review queue. */
  subject?: string;
  /** Traveler name on the email, when parseable. */
  passengerName?: string;
  /** Miles/points redeposited to the account, when the credit is in points. */
  creditedPoints?: number;
  /** Cash refunded in USD, when the credit is in cash. */
  creditedCashUsd?: number;
}
