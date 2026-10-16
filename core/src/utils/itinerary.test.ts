import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Airline, Cabin, FareType, FlightSource, PurchaseType } from '../models/common.js';
import type { Flight } from '../models/Flight.js';
import { buildItinerary } from './itinerary.js';

function makeFlight(overrides: Partial<Flight> = {}): Flight {
  return {
    id: 'flt_1',
    passengerId: 'pax_1',
    airline: Airline.American,
    confirmationNumber: 'QDFZSJ',
    route: { origin: { code: 'ORD' }, destination: { code: 'OGG' } },
    departureDateTime: '2027-01-07T11:55:00',
    arrivalDateTime: '2027-01-07T17:40:00',
    fareType: FareType.Unknown,
    cabin: Cabin.Economy,
    originalCost: { purchaseType: PurchaseType.Cash, cashUsd: 273.1, taxesAndFeesUsd: 34.94 },
    bookingDate: '2026-09-09',
    source: FlightSource.Email,
    monitoring: true,
    createdAt: '2026-09-09T00:00:00Z',
    updatedAt: '2026-09-09T00:00:00Z',
    ...overrides,
  };
}

const outbound = (name: string, id: string): { flight: Flight; passengerName: string } => ({
  flight: makeFlight({ id }),
  passengerName: name,
});

const ret = (name: string, id: string): { flight: Flight; passengerName: string } => ({
  flight: makeFlight({
    id,
    route: { origin: { code: 'OGG' }, destination: { code: 'ORD' } },
    departureDateTime: '2027-01-14T08:00:00',
    arrivalDateTime: '2027-01-14T16:30:00',
  }),
  passengerName: name,
});

test('two flights become an Outbound and a Return journey, earliest first', () => {
  // Passed in reverse order on purpose: ordering comes from departure time.
  const text = buildItinerary([ret('Joshua Sprenger', 'b'), outbound('Joshua Sprenger', 'a')]);
  const outIdx = text.indexOf('OUTBOUND JOURNEY');
  const retIdx = text.indexOf('RETURN JOURNEY');
  assert.ok(outIdx >= 0 && retIdx > outIdx, 'outbound must precede return');
  assert.match(text, /Thursday, January 7, 2027/);
  assert.match(text, /ORD → OGG/);
  assert.match(text, /Departs: 11:55 AM/);
  assert.match(text, /Arrives: 5:40 PM/);
  assert.match(text, /Cabin: Economy/);
  assert.match(text, /American Airlines/);
});

test('travelers on the same flight are merged into one journey, not repeated', () => {
  const text = buildItinerary([
    outbound('Joshua Sprenger', 'a'),
    outbound('Amy Sprenger', 'b'),
    outbound('Emily Sprenger', 'c'),
    ret('Joshua Sprenger', 'd'),
    ret('Amy Sprenger', 'e'),
    ret('Emily Sprenger', 'f'),
  ]);
  assert.equal(text.match(/OUTBOUND JOURNEY/g)?.length, 1);
  assert.equal(text.match(/RETURN JOURNEY/g)?.length, 1);
  assert.match(text, /^Travelers: Joshua Sprenger, Amy Sprenger, Emily Sprenger$/m);
  // Everyone is on both journeys, so per-journey traveler lines are omitted.
  assert.equal(text.match(/Travelers:/g)?.length, 1);
  // One shared confirmation, printed once per journey.
  assert.equal(text.match(/Confirmation: QDFZSJ/g)?.length, 2);
});

test('a journey carrying only part of the party names its travelers', () => {
  const text = buildItinerary([
    outbound('Joshua Sprenger', 'a'),
    outbound('Amy Sprenger', 'b'),
    ret('Joshua Sprenger', 'c'),
  ]);
  const returnSection = text.slice(text.indexOf('RETURN JOURNEY'));
  assert.match(returnSection, /Travelers: Joshua Sprenger/);
  assert.doesNotMatch(text.slice(0, text.indexOf('RETURN JOURNEY')).split('OUTBOUND JOURNEY')[1]!, /Travelers:/);
});

test('travelers booked under different confirmations list each confirmation', () => {
  const a = outbound('Joshua Sprenger', 'a');
  const b = outbound('Amy Sprenger', 'b');
  b.flight.confirmationNumber = 'ZZZ999';
  const text = buildItinerary([a, b]);
  assert.match(text, /Confirmations: QDFZSJ \(Joshua Sprenger\); ZZZ999 \(Amy Sprenger\)/);
});

test('a same-day connection lists each segment with its layover', () => {
  const flight = makeFlight({
    airline: Airline.AirCanada,
    confirmationNumber: '2K4C2W',
    route: { origin: { code: 'ITH' }, destination: { code: 'ORD' } },
    departureDateTime: '2026-12-15T20:10:00',
    arrivalDateTime: '2026-12-15T23:29:00',
    durationMinutes: undefined,
    segments: [
      {
        origin: { code: 'ITH' },
        destination: { code: 'IAD' },
        departureDateTime: '2026-12-15T20:10:00',
        arrivalDateTime: '2026-12-15T21:30:00',
        flightNumber: 'UA 4954',
      },
      {
        origin: { code: 'IAD' },
        destination: { code: 'ORD' },
        departureDateTime: '2026-12-15T22:15:00',
        arrivalDateTime: '2026-12-15T23:29:00',
        flightNumber: 'UA 421',
      },
    ],
  });
  const text = buildItinerary([{ flight, passengerName: 'Emily Sprenger' }]);

  assert.match(text, /^FLIGHT$/m);
  // Flown by United even though it was booked through Air Canada.
  assert.match(text, /United Airlines/);
  assert.match(text, /Confirmation: 2K4C2W \(booked via Air Canada\)/);
  assert.match(text, /Stops: 1 \(IAD\)/);
  assert.match(text, /1\. UA 4954: ITH → IAD/);
  assert.match(text, /Departs 8:10 PM · Arrives 9:30 PM/);
  assert.match(text, /Layover in IAD: 45m/);
  assert.match(text, /2\. UA 421: IAD → ORD/);
  assert.match(text, /Departs 10:15 PM · Arrives 11:29 PM/);
});

test('an overnight arrival states the arrival day', () => {
  const flight = makeFlight({
    route: { origin: { code: 'OGG' }, destination: { code: 'ORD' } },
    departureDateTime: '2027-01-12T17:05:00',
    arrivalDateTime: '2027-01-13T05:03:00',
    durationMinutes: 478,
  });
  const text = buildItinerary([{ flight, passengerName: 'Amy Sprenger' }]);
  assert.match(text, /Departs: 5:05 PM/);
  assert.match(text, /Arrives: Wed, Jan 13 at 5:03 AM/);
  assert.match(text, /Duration: 7h 58m/);
});

test('airport names appear alongside codes when known', () => {
  const flight = makeFlight({
    route: {
      origin: { code: 'ORD', name: "Chicago O'Hare" },
      destination: { code: 'OGG', name: 'Kahului' },
    },
  });
  const text = buildItinerary([{ flight, passengerName: 'Amy Sprenger' }]);
  assert.match(text, /Chicago O'Hare \(ORD\) → Kahului \(OGG\)/);
});

test('confirmation numbers can be left out', () => {
  const text = buildItinerary([outbound('Joshua Sprenger', 'a')], { includeConfirmation: false });
  assert.doesNotMatch(text, /Confirmation/);
  assert.doesNotMatch(text, /QDFZSJ/);
});

test('prices are never included', () => {
  const text = buildItinerary([outbound('Joshua Sprenger', 'a'), ret('Joshua Sprenger', 'b')]);
  assert.doesNotMatch(text, /\$|points|pts|273/i);
});

test('three or more flights are numbered', () => {
  const mid = makeFlight({
    id: 'mid',
    route: { origin: { code: 'OGG' }, destination: { code: 'LAX' } },
    departureDateTime: '2027-01-10T09:00:00',
    arrivalDateTime: '2027-01-10T16:00:00',
  });
  const text = buildItinerary([
    outbound('Joshua Sprenger', 'a'),
    { flight: mid, passengerName: 'Joshua Sprenger' },
    ret('Joshua Sprenger', 'c'),
  ]);
  assert.match(text, /FLIGHT 1 OF 3/);
  assert.match(text, /FLIGHT 2 OF 3/);
  assert.match(text, /FLIGHT 3 OF 3/);
});

test('no flights yields an empty itinerary', () => {
  assert.equal(buildItinerary([]), '');
});
