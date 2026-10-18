import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Airline, FareType, FlightSource, PurchaseType } from '../models/common.js';
import type { Flight } from '../models/Flight.js';
import type { HotelStay } from '../models/HotelStay.js';
import { suggestHotelStays } from './hotelSuggestions.js';

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
