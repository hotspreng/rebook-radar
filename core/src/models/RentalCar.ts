/** Which rental company issued a car reservation. */
export type RentalProvider = 'hertz' | 'national';

export const RENTAL_PROVIDER_LABELS: Record<RentalProvider, string> = {
  hertz: 'Hertz',
  national: 'National Car Rental',
};

/**
 * One imported car rental reservation.
 *
 * Pick-up / return times are wall-clock at the rental counter and carry no
 * timezone: either `YYYY-MM-DD` (time unknown) or `YYYY-MM-DDTHH:mm:00`.
 */
export interface RentalCar {
  id: string;
  provider: RentalProvider;
  confirmationNumber: string;
  pickupLocation: string;
  /** Street address of the pick-up counter, when the email gives one. */
  pickupAddress?: string;
  pickupPhone?: string;
  pickupAt: string;
  returnLocation: string;
  returnAt: string;
  /** Rental class, e.g. "Full Size". */
  vehicleClass?: string;
  /** Car model, e.g. "Nissan Altima or similar". */
  vehicleModel?: string;
  driverName?: string;
  /** Gmail message the reservation was last parsed from. */
  emailId?: string;
  /** When that email arrived (ISO timestamp). */
  bookedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** A rental as parsed from email, before it is assigned an id or timestamps. */
export type ParsedRentalCar = Omit<RentalCar, 'id' | 'createdAt' | 'updatedAt'>;

/** Stable identity for de-duplicating re-imports: the company's confirmation number. */
export function rentalCarKey(car: Pick<RentalCar, 'provider' | 'confirmationNumber'>): string {
  return `${car.provider}|${car.confirmationNumber.trim().toUpperCase()}`;
}
