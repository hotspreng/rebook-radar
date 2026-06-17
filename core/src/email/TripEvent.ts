import { RetrievedTrip } from '../providers/AirlineProvider.js';

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
