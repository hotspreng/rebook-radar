import type { Flight } from '../models/Flight.js';
import type { HotelStay } from '../models/HotelStay.js';

/**
 * Hotel stays that fall within the trip the given flights make up.
 *
 * The trip runs from the earliest departure date to the latest arrival date.
 * A stay matches when it overlaps that window: it checks in on or before the
 * last arrival day and checks out after the first departure day, so a stay
 * that ended the morning you fly out is not suggested. Dates are compared as
 * the wall-clock calendar dates stored on the flights and stays, which keeps
 * the result independent of the machine's timezone. Results are in check-in order.
 */
export function suggestHotelStays(flights: Flight[], stays: HotelStay[]): HotelStay[] {
  const dates = flights.flatMap((f) =>
    [f.departureDateTime, f.arrivalDateTime].flatMap((value) => (value ? [value.slice(0, 10)] : [])),
  );
  if (dates.length === 0) return [];

  const start = dates.reduce((a, b) => (a < b ? a : b));
  const end = dates.reduce((a, b) => (a > b ? a : b));

  return stays
    .filter((stay) => stay.checkIn.slice(0, 10) <= end && stay.checkOut.slice(0, 10) > start)
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn));
}
