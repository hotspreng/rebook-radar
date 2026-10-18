/** Where a hotel reservation was booked / confirmed from. */
export type HotelProvider = 'marriott' | 'hilton' | 'frankfurtflyer' | 'amex';

export const HOTEL_PROVIDER_LABELS: Record<HotelProvider, string> = {
  marriott: 'Marriott Bonvoy',
  hilton: 'Hilton Honors',
  frankfurtflyer: 'Frankfurtflyer',
  amex: 'American Express Travel',
};

/**
 * One imported hotel reservation.
 *
 * Dates are wall-clock at the hotel and carry no timezone. A check-in/out is
 * either `YYYY-MM-DD` (time unknown) or `YYYY-MM-DDTHH:mm:00`.
 */
export interface HotelStay {
  id: string;
  provider: HotelProvider;
  hotelName: string;
  /** Street address (or just the city/country when that is all the email gives). */
  address?: string;
  phone?: string;
  checkIn: string;
  checkOut: string;
  nights?: number;
  /** Names on the reservation. */
  guestNames: string[];
  /** Total guests across all rooms. */
  guests?: number;
  rooms?: number;
  roomType?: string;
  /** The hotel's own confirmation number, when the email carries one. */
  confirmationNumber?: string;
  /**
   * The booking agent's reference when it differs from the hotel's number —
   * an AMEX Travel trip number, or the Frankfurtflyer booking code.
   */
  bookingReference?: string;
  /** Gmail message the stay was last parsed from. */
  emailId?: string;
  /** When that email arrived (ISO timestamp). */
  bookedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** A stay as parsed from email, before it is assigned an id or timestamps. */
export type ParsedHotelStay = Omit<HotelStay, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * Stable identity for de-duplicating re-imports of the same reservation: the
 * hotel's confirmation number, else the agent's reference, else the hotel plus
 * check-in date (Frankfurtflyer emails without an attachment name).
 */
export function hotelStayKey(
  stay: Pick<HotelStay, 'provider' | 'hotelName' | 'checkIn' | 'confirmationNumber' | 'bookingReference'>,
): string {
  const id =
    stay.confirmationNumber?.trim() ||
    stay.bookingReference?.trim() ||
    `${stay.hotelName.trim().toLowerCase()}@${stay.checkIn.slice(0, 10)}`;
  return `${stay.provider}|${id.toUpperCase()}`;
}
