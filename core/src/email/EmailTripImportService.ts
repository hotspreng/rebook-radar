import { RetrievedTrip } from '../providers/AirlineProvider.js';
import { EmailMessage } from './EmailMessage.js';
import { ParsedTripEvent, TripEventType } from './TripEvent.js';
import { parseSouthwestEmail } from './southwestEmailParsing.js';
import { isUnitedEmail, parseUnitedEmail } from './unitedEmailParsing.js';

/**
 * Parse a single confirmation email into a trip event, dispatching to the
 * right airline parser by sender. United receipts/notifications come from
 * `@united.com`; everything else is treated as Southwest.
 */
function parseAirlineEmail(message: EmailMessage): ParsedTripEvent | undefined {
  return isUnitedEmail(message.from)
    ? parseUnitedEmail(message)
    : parseSouthwestEmail(message);
}


/** Result of folding a batch of Southwest emails into current trip state. */
export interface EmailImportResult {
  /** Trips that are currently active and depart in the future. */
  active: RetrievedTrip[];
  /** Confirmation numbers whose latest event is a cancellation. */
  cancelledConfirmations: string[];
  /**
   * Last-known details for cancelled confirmations (route, date, price), when
   * the emails carried them. Lets the importer match a cancel-and-rebook under
   * a NEW confirmation number against the cancelled trip to credit a saving.
   */
  cancelledTrips: RetrievedTrip[];
  /** Total number of recognized Southwest events parsed. */
  events: number;
  /** Number of distinct confirmation numbers seen. */
  confirmations: number;
}

export interface EmailImportOptions {
  /** "Now" for the future-only filter. Defaults to the current time. */
  now?: Date;
  /**
   * Include trips whose departure date could not be parsed. Default true so a
   * parsing miss doesn't silently drop a real upcoming trip.
   */
  includeUndatedTrips?: boolean;
}

interface FoldState {
  confirmationNumber: string;
  trip?: RetrievedTrip;
  cancelled: boolean;
  lastEventAt: number;
  /** When the latest booking confirmation arrived (ms since epoch). */
  bookedAt?: number;
  /** Earliest known paid points for this PNR (the savings baseline). */
  firstPaidPoints?: number;
  /** Earliest known paid cash for this PNR (the savings baseline). */
  firstPaidCashUsd?: number;
}

/**
 * Folds Southwest confirmation emails into the current set of upcoming trips.
 *
 * Strategy (the core "smartness"):
 *  1. Parse each email into a {@link ParsedTripEvent} (booked/changed/cancelled).
 *  2. Group events by confirmation number (PNR) and process them in
 *     chronological order (oldest → newest).
 *  3. Latest event wins: a later *Changed* email overwrites the itinerary; a
 *     later *Cancelled* email removes the trip from the active list. A booking
 *     that arrives *after* a cancellation (re-book under the same PNR) revives it.
 *  4. Changes merge over the previous trip so fields the change email omits are
 *     retained from the original booking.
 *
 * Pure and deterministic — fully unit-testable without Gmail.
 */
export class EmailTripImportService {
  fold(messages: EmailMessage[], options: EmailImportOptions = {}): EmailImportResult {
    const now = options.now ?? new Date();
    const includeUndated = options.includeUndatedTrips ?? true;

    const events: ParsedTripEvent[] = [];
    for (const message of messages) {
      const event = parseAirlineEmail(message);
      if (event) events.push(event);
    }

    // Oldest first so newer events override older ones during the fold.
    events.sort((a, b) => a.occurredAt - b.occurredAt);

    const byConfirmation = new Map<string, FoldState>();
    for (const event of events) {
      const state =
        byConfirmation.get(event.confirmationNumber) ??
        ({ confirmationNumber: event.confirmationNumber, cancelled: false, lastEventAt: 0 } as FoldState);

      switch (event.type) {
        case TripEventType.Cancelled:
          state.cancelled = true;
          break;
        case TripEventType.Booked:
          state.cancelled = false;
          state.trip = event.trip ?? state.trip;
          state.bookedAt = event.occurredAt;
          break;
        case TripEventType.Changed:
          state.cancelled = false;
          state.trip = mergeTrip(state.trip, event.trip);
          break;
      }
      // Remember the EARLIEST price seen for this PNR. Events are sorted
      // oldest-first, so the first one carrying a price is the original fare;
      // a later cheaper change/rebook is then recognizable as a saving even
      // when the original and rebooked emails arrive in the same import.
      if (state.firstPaidPoints == null && event.trip?.paidPoints != null) {
        state.firstPaidPoints = event.trip.paidPoints;
      }
      if (state.firstPaidCashUsd == null && event.trip?.paidCashUsd != null) {
        state.firstPaidCashUsd = event.trip.paidCashUsd;
      }
      state.lastEventAt = event.occurredAt;
      byConfirmation.set(event.confirmationNumber, state);
    }

    const active: RetrievedTrip[] = [];
    const cancelledConfirmations: string[] = [];
    const cancelledTrips: RetrievedTrip[] = [];
    for (const state of byConfirmation.values()) {
      if (state.cancelled) {
        cancelledConfirmations.push(state.confirmationNumber);
        if (state.trip) {
          cancelledTrips.push(
            state.bookedAt != null ? { ...state.trip, bookedAt: state.bookedAt } : state.trip,
          );
        }
        continue;
      }
      if (!state.trip) continue;
      const trip: RetrievedTrip = state.bookedAt != null ? { ...state.trip, bookedAt: state.bookedAt } : { ...state.trip };
      // Surface the original (higher) fare when this trip was later changed to a
      // cheaper price under the same PNR, so the importer can credit the drop.
      if (state.firstPaidPoints != null && trip.paidPoints != null && trip.paidPoints < state.firstPaidPoints) {
        trip.originalPaidPoints = state.firstPaidPoints;
      }
      if (state.firstPaidCashUsd != null && trip.paidCashUsd != null && trip.paidCashUsd < state.firstPaidCashUsd) {
        trip.originalPaidCashUsd = state.firstPaidCashUsd;
      }
      if (isFutureTrip(trip, now, includeUndated)) active.push(trip);
    }

    return {
      active,
      cancelledConfirmations,
      cancelledTrips,
      events: events.length,
      confirmations: byConfirmation.size,
    };
  }
}

/** Merge a change over the prior trip, keeping prior values the change omits. */
function mergeTrip(prev: RetrievedTrip | undefined, next: RetrievedTrip | undefined): RetrievedTrip | undefined {
  if (!prev) return next;
  if (!next) return prev;
  return {
    confirmationNumber: next.confirmationNumber || prev.confirmationNumber,
    passengerNames: next.passengerNames.length ? next.passengerNames : prev.passengerNames,
    origin: next.origin || prev.origin,
    destination: next.destination || prev.destination,
    departureDateTime: next.departureDateTime || prev.departureDateTime,
    arrivalDateTime: next.arrivalDateTime ?? prev.arrivalDateTime,
    durationMinutes: next.durationMinutes ?? prev.durationMinutes,
    fareType: next.fareType || prev.fareType,
    purchaseType: next.purchaseType ?? prev.purchaseType,
    paidCashUsd: next.paidCashUsd ?? prev.paidCashUsd,
    paidPoints: next.paidPoints ?? prev.paidPoints,
    originalPaidPoints: next.originalPaidPoints ?? prev.originalPaidPoints,
    originalPaidCashUsd: next.originalPaidCashUsd ?? prev.originalPaidCashUsd,
    taxesAndFeesUsd: next.taxesAndFeesUsd ?? prev.taxesAndFeesUsd,
    legs: next.legs ?? prev.legs,
  };
}

function isFutureTrip(trip: RetrievedTrip, now: Date, includeUndated: boolean): boolean {
  if (!trip.departureDateTime) return includeUndated;
  const departure = Date.parse(trip.departureDateTime);
  if (Number.isNaN(departure)) return includeUndated;
  return departure >= now.getTime();
}
