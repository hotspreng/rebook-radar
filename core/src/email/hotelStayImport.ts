import { hotelStayKey, type HotelProvider, type ParsedHotelStay } from '../models/HotelStay.js';
import type { EmailMessage } from './EmailMessage.js';
import { parseHotelEmail, type HotelStayEvent } from './hotelEmailParsing.js';

/** Identifies reservations a cancellation email refers to. */
export interface HotelCancellation {
  provider: HotelProvider;
  confirmationNumber?: string;
  bookingReference?: string;
  /** Used only when the email carries neither number. */
  hotelName?: string;
  checkInDate?: string;
}

export interface HotelImportResult {
  /** Current reservations (any date), one per reservation. */
  stays: ParsedHotelStay[];
  /** Reservations that were cancelled and must be removed from storage. */
  cancellations: HotelCancellation[];
  /** Emails that produced at least one reservation event. */
  events: number;
}

/** Whether a cancellation refers to a stay. */
export function cancellationMatches(
  cancellation: HotelCancellation,
  stay: Pick<ParsedHotelStay, 'provider' | 'hotelName' | 'checkIn' | 'confirmationNumber' | 'bookingReference'>,
): boolean {
  if (cancellation.provider !== stay.provider) return false;
  const same = (a?: string, b?: string): boolean => !!a && !!b && a.toUpperCase() === b.toUpperCase();
  if (same(cancellation.confirmationNumber, stay.confirmationNumber)) return true;
  if (same(cancellation.bookingReference, stay.bookingReference)) return true;
  // Both sides carry a number and they differ: this is a different booking of
  // the same hotel (e.g. one re-booked for other dates), so leave it alone.
  const cancelHasId = !!(cancellation.confirmationNumber || cancellation.bookingReference);
  const stayHasId = !!(stay.confirmationNumber || stay.bookingReference);
  if (cancelHasId && stayHasId) return false;
  const plainName = (name: string): string => name.toLowerCase().replace(/^the\s+/, '').trim();
  return (
    !!cancellation.hotelName &&
    plainName(cancellation.hotelName) === plainName(stay.hotelName) &&
    cancellation.checkInDate === stay.checkIn.slice(0, 10)
  );
}

/**
 * Fold hotel emails into the current set of reservations. Events are applied
 * oldest-first and the latest wins per reservation: a newer confirmation
 * replaces an older one (modifications), a cancellation removes it, and a
 * booking that arrives after a cancellation revives it.
 */
export function foldHotelEmails(messages: EmailMessage[]): HotelImportResult {
  const events: HotelStayEvent[] = messages.flatMap((message) => parseHotelEmail(message));
  events.sort((a, b) => a.occurredAt - b.occurredAt);

  const stays = new Map<string, ParsedHotelStay>();
  const cancellations: HotelCancellation[] = [];

  for (const event of events) {
    if (event.type === 'booked' && event.stay) {
      stays.set(hotelStayKey(event.stay), event.stay);
      continue;
    }
    const cancellation: HotelCancellation = {
      provider: event.provider,
      confirmationNumber: event.confirmationNumber,
      bookingReference: event.bookingReference,
      hotelName: event.stay?.hotelName,
      checkInDate: event.stay?.checkIn.slice(0, 10),
    };
    for (const [key, stay] of stays) {
      if (cancellationMatches(cancellation, stay)) stays.delete(key);
    }
    cancellations.push(cancellation);
  }

  return { stays: [...stays.values()], cancellations, events: events.length };
}
