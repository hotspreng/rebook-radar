import { busRideKey, type BusProvider, type ParsedBusRide } from '../models/BusRide.js';
import type { EmailMessage } from './EmailMessage.js';
import { parseBusEmail, type BusRideEvent } from './busEmailParsing.js';

/** Identifies the ticket a cancellation email refers to. */
export interface BusCancellation {
  provider: BusProvider;
  ticketReference: string;
}

export interface BusImportResult {
  /** Current tickets (any date), one per reference code. */
  rides: ParsedBusRide[];
  /** Tickets that were cancelled and must be removed from storage. */
  cancellations: BusCancellation[];
  /** Emails that produced a ticket event. */
  events: number;
}

export function busCancellationMatches(
  cancellation: BusCancellation,
  ride: Pick<ParsedBusRide, 'provider' | 'ticketReference'>,
): boolean {
  return (
    cancellation.provider === ride.provider &&
    cancellation.ticketReference.toUpperCase() === ride.ticketReference.toUpperCase()
  );
}

/**
 * Fold bus emails into the current set of tickets. Events are applied
 * oldest-first and the latest wins per reference code: an update (for example
 * an operator change) replaces the original ticket, a cancellation removes it,
 * and a ticket that arrives after a cancellation revives it.
 */
export function foldBusEmails(messages: EmailMessage[]): BusImportResult {
  const events: BusRideEvent[] = messages.flatMap((message) => parseBusEmail(message));
  events.sort((a, b) => a.occurredAt - b.occurredAt);

  const rides = new Map<string, ParsedBusRide>();
  const cancellations: BusCancellation[] = [];

  for (const event of events) {
    if (event.type === 'booked' && event.ride) {
      rides.set(busRideKey(event.ride), event.ride);
      continue;
    }
    const cancellation: BusCancellation = { provider: event.provider, ticketReference: event.ticketReference };
    for (const [key, ride] of rides) {
      if (busCancellationMatches(cancellation, ride)) rides.delete(key);
    }
    cancellations.push(cancellation);
  }

  return { rides: [...rides.values()], cancellations, events: events.length };
}
