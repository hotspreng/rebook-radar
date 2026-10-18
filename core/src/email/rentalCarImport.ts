import { rentalCarKey, type ParsedRentalCar, type RentalProvider } from '../models/RentalCar.js';
import type { EmailMessage } from './EmailMessage.js';
import { parseRentalEmail, type RentalCarEvent } from './rentalEmailParsing.js';

/** Identifies the reservation a cancellation email refers to. */
export interface RentalCancellation {
  provider: RentalProvider;
  confirmationNumber: string;
}

export interface RentalImportResult {
  /** Current reservations (any date), one per confirmation number. */
  cars: ParsedRentalCar[];
  /** Reservations that were cancelled and must be removed from storage. */
  cancellations: RentalCancellation[];
  /** Emails that produced a reservation event. */
  events: number;
}

export function rentalCancellationMatches(
  cancellation: RentalCancellation,
  car: Pick<ParsedRentalCar, 'provider' | 'confirmationNumber'>,
): boolean {
  return (
    cancellation.provider === car.provider &&
    cancellation.confirmationNumber.toUpperCase() === car.confirmationNumber.toUpperCase()
  );
}

/**
 * Fold rental emails into the current set of reservations. Events are applied
 * oldest-first and the latest wins per confirmation number: a newer email
 * replaces an older one (modifications), a cancellation removes it, and a
 * booking that arrives after a cancellation revives it.
 */
export function foldRentalEmails(messages: EmailMessage[]): RentalImportResult {
  const events: RentalCarEvent[] = messages.flatMap((message) => parseRentalEmail(message));
  events.sort((a, b) => a.occurredAt - b.occurredAt);

  const cars = new Map<string, ParsedRentalCar>();
  const cancellations: RentalCancellation[] = [];

  for (const event of events) {
    if (event.type === 'booked' && event.car) {
      cars.set(rentalCarKey(event.car), event.car);
      continue;
    }
    const cancellation: RentalCancellation = {
      provider: event.provider,
      confirmationNumber: event.confirmationNumber,
    };
    for (const [key, car] of cars) {
      if (rentalCancellationMatches(cancellation, car)) cars.delete(key);
    }
    cancellations.push(cancellation);
  }

  return { cars: [...cars.values()], cancellations, events: events.length };
}
