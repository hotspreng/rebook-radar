import type { Flight } from '../models/Flight.js';
import type { HotelStay } from '../models/HotelStay.js';
import type { RentalCar } from '../models/RentalCar.js';
import { busAirportDirection, type BusRide } from '../models/BusRide.js';

function shiftDay(date: string, days: number): string {
  const d = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + days));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Airport bus transfers for the trip the given flights make up: a ride that
 * ends at an airport within a day before the first departure, or one that
 * starts at an airport within a day after the last arrival. Rides whose stops
 * don't mention an airport are never suggested. Results are in departure order.
 */
export function suggestBusRides(flights: Flight[], rides: BusRide[]): BusRide[] {
  const dates = flights.flatMap((f) =>
    [f.departureDateTime, f.arrivalDateTime].flatMap((value) => (value ? [value.slice(0, 10)] : [])),
  );
  if (dates.length === 0) return [];

  const start = dates.reduce((a, b) => (a < b ? a : b));
  const end = dates.reduce((a, b) => (a > b ? a : b));

  return rides
    .filter((ride) => {
      const day = ride.departureAt.slice(0, 10);
      const direction = busAirportDirection(ride);
      if (direction === 'to') return day >= shiftDay(start, -1) && day <= start;
      if (direction === 'from') return day >= end && day <= shiftDay(end, 1);
      return false;
    })
    .sort((a, b) => a.departureAt.localeCompare(b.departureAt));
}

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

/**
 * Car rentals that fall within the same trip window. A rental matches when it
 * is picked up on or before the last arrival day and is either picked up on or
 * after the first departure day or returned after it (so a rental returned the
 * day you fly out, from an earlier trip, is not suggested). Results are in
 * pick-up order.
 */
export function suggestRentalCars(flights: Flight[], cars: RentalCar[]): RentalCar[] {
  const dates = flights.flatMap((f) =>
    [f.departureDateTime, f.arrivalDateTime].flatMap((value) => (value ? [value.slice(0, 10)] : [])),
  );
  if (dates.length === 0) return [];

  const start = dates.reduce((a, b) => (a < b ? a : b));
  const end = dates.reduce((a, b) => (a > b ? a : b));

  return cars
    .filter((car) => {
      const pickup = car.pickupAt.slice(0, 10);
      return pickup <= end && (pickup >= start || car.returnAt.slice(0, 10) > start);
    })
    .sort((a, b) => a.pickupAt.localeCompare(b.pickupAt));
}
