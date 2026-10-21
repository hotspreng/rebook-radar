import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Airline, FareType, FlightSource, PurchaseType } from '../models/common.js';
import type { Flight } from '../models/Flight.js';
import type { HotelStay } from '../models/HotelStay.js';
import type { RentalCar } from '../models/RentalCar.js';
import type { BusRide } from '../models/BusRide.js';
import { suggestBusRides, suggestHotelStays, suggestRentalCars } from './hotelSuggestions.js';

function flight(departs: string, arrives: string): Flight {
  return {
    id: `f-${departs}`,
    passengerId: 'p1',
    airline: Airline.United,
    confirmationNumber: 'ABC123',
    route: { origin: { code: 'ORD' }, destination: { code: 'KEF' } },
    departureDateTime: departs,
    arrivalDateTime: arrives,
    fareType: FareType.Unknown,
    originalCost: { purchaseType: PurchaseType.Points, points: 1000, taxesAndFeesUsd: 0 },
    bookingDate: '2026-01-01',
    source: FlightSource.Email,
    monitoring: true,
    createdAt: '',
    updatedAt: '',
  } as unknown as Flight;
}

function stay(id: string, checkIn: string, checkOut: string): HotelStay {
  return {
    id,
    provider: 'hilton',
    hotelName: id,
    checkIn,
    checkOut,
    guestNames: [],
    createdAt: '',
    updatedAt: '',
  };
}

const outbound = flight('2026-06-07T20:00:00', '2026-06-08T06:30:00');
const ret = flight('2026-06-11T12:00:00', '2026-06-11T15:00:00');

test('a stay between the outbound and return flights is suggested', () => {
  const during = stay('during', '2026-06-08T15:00:00', '2026-06-11T11:00:00');
  assert.deepEqual(suggestHotelStays([outbound, ret], [during]).map((s) => s.id), ['during']);
});

test('stays well before or after the trip are not suggested', () => {
  const stays = [stay('before', '2026-05-01', '2026-05-03'), stay('after', '2026-07-01', '2026-07-03')];
  assert.deepEqual(suggestHotelStays([outbound, ret], stays), []);
});

test('a stay that checked out the morning you fly out is not suggested', () => {
  const earlier = stay('earlier', '2026-06-05T15:00:00', '2026-06-07T11:00:00');
  assert.equal(suggestHotelStays([outbound, ret], [earlier]).length, 0);
});

test('a stay that begins on the day you land is suggested for just the outbound flight', () => {
  const arrival = stay('arrival', '2026-06-08T15:00:00', '2026-06-09T11:00:00');
  assert.deepEqual(suggestHotelStays([outbound], [arrival]).map((s) => s.id), ['arrival']);
});

test('date-only stays are compared by calendar date', () => {
  const dateOnly = stay('dateOnly', '2026-06-09', '2026-06-10');
  assert.equal(suggestHotelStays([outbound, ret], [dateOnly]).length, 1);
});

test('suggestions come back in check-in order', () => {
  const late = stay('late', '2026-06-10T15:00:00', '2026-06-11T11:00:00');
  const early = stay('early', '2026-06-08T15:00:00', '2026-06-10T11:00:00');
  assert.deepEqual(suggestHotelStays([outbound, ret], [late, early]).map((s) => s.id), ['early', 'late']);
});

test('no flights means no suggestions', () => {
  assert.deepEqual(suggestHotelStays([], [stay('x', '2026-06-08', '2026-06-09')]), []);
});

function rental(id: string, pickupAt: string, returnAt: string): RentalCar {
  return {
    id,
    provider: 'hertz',
    confirmationNumber: id.toUpperCase().padEnd(8, 'X'),
    pickupLocation: 'DENVER (DEN)',
    pickupAt,
    returnLocation: 'DENVER (DEN)',
    returnAt,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

test('rentals during the trip are suggested, in pick-up order', () => {
  const cars = [
    rental('late', '2026-06-09T09:00:00', '2026-06-11T10:00:00'),
    rental('arrive', '2026-06-08T07:00:00', '2026-06-11T10:00:00'),
  ];
  assert.deepEqual(suggestRentalCars([outbound, ret], cars).map((c) => c.id), ['arrive', 'late']);
});

test('rentals outside the trip, or returned the day you fly out, are not suggested', () => {
  const cars = [
    rental('before', '2026-05-01T09:00:00', '2026-05-05T09:00:00'),
    rental('after', '2026-07-01T09:00:00', '2026-07-05T09:00:00'),
    rental('earlier-trip', '2026-06-05T09:00:00', '2026-06-07T09:00:00'),
  ];
  assert.deepEqual(suggestRentalCars([outbound, ret], cars), []);
});

test('a rental that spans the outbound departure is suggested; no flights means none', () => {
  const spanning = rental('span', '2026-06-06T09:00:00', '2026-06-09T09:00:00');
  assert.equal(suggestRentalCars([outbound], [spanning]).length, 1);
  assert.deepEqual(suggestRentalCars([], [spanning]), []);
});
function bus(id: string, departureAt: string, departureCity: string, arrivalCity: string): BusRide {
  return {
    id,
    provider: 'ourbus',
    ticketReference: id.toUpperCase(),
    departureAt,
    arrivalAt: departureAt,
    departureCity,
    arrivalCity,
    passengerNames: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

test('a bus to the airport the day before or of the first flight is suggested; one after is not', () => {
  const rides = [
    bus('eve', '2026-06-06T20:00:00', 'Ithaca, NY', 'Syracuse Airport, NY'),
    bus('morning', '2026-06-07T09:00:00', 'Ithaca, NY', 'Syracuse Airport, NY'),
    bus('early', '2026-06-04T09:00:00', 'Ithaca, NY', 'Syracuse Airport, NY'),
    bus('late', '2026-06-08T09:00:00', 'Ithaca, NY', 'Syracuse Airport, NY'),
  ];
  assert.deepEqual(suggestBusRides([outbound, ret], rides).map((r) => r.id), ['eve', 'morning']);
});

test('a bus from the airport on or the day after the last arrival is suggested', () => {
  const rides = [
    bus('same', '2026-06-11T17:00:00', 'Syracuse Airport, NY', 'Ithaca, NY'),
    bus('next', '2026-06-12T08:00:00', 'Syracuse Airport, NY', 'Ithaca, NY'),
    bus('later', '2026-06-13T08:00:00', 'Syracuse Airport, NY', 'Ithaca, NY'),
    bus('before', '2026-06-10T08:00:00', 'Syracuse Airport, NY', 'Ithaca, NY'),
  ];
  assert.deepEqual(suggestBusRides([outbound, ret], rides).map((r) => r.id), ['same', 'next']);
});

test('rides that never touch an airport are not suggested, and no flights means none', () => {
  const rides = [bus('town', '2026-06-07T09:00:00', 'Ithaca, NY', 'Syracuse, NY')];
  assert.deepEqual(suggestBusRides([outbound, ret], rides), []);
  assert.deepEqual(suggestBusRides([], [bus('x', '2026-06-07T09:00:00', 'Ithaca, NY', 'Syracuse Airport, NY')]), []);
});
test('a bus into the city of the first flight\'s airport is suggested even when the stop is not an airport', () => {
  const rocFlight = { ...flight('2027-02-12T19:00:00', '2027-02-12T20:00:00'), route: { origin: { code: 'ROC' }, destination: { code: 'MDW' } } } as Flight;
  const rides = [
    bus('feeder', '2027-02-12T14:15:00', 'Ithaca, NY', 'Rochester, NY'),
    bus('other-city', '2027-02-12T14:15:00', 'Ithaca, NY', 'Syracuse, NY'),
    bus('too-early', '2027-02-09T14:15:00', 'Ithaca, NY', 'Rochester, NY'),
  ];
  assert.deepEqual(suggestBusRides([rocFlight], rides).map((r) => r.id), ['feeder']);

  const home = { ...flight('2027-02-20T10:00:00', '2027-02-20T12:00:00'), route: { origin: { code: 'MDW' }, destination: { code: 'ROC' } } } as Flight;
  const back = [bus('home', '2027-02-20T14:00:00', 'Rochester, NY', 'Ithaca, NY')];
  assert.deepEqual(suggestBusRides([home], back).map((r) => r.id), ['home']);
});