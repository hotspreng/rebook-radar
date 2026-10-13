import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Airline, FareType, FlightSource, PurchaseType } from './common.js';
import type { Flight } from './Flight.js';
import { operatingAirline } from './Flight.js';

function makeFlight(overrides: Partial<Flight> = {}): Flight {
  return {
    id: 'flight_1',
    passengerId: 'pax_1',
    airline: Airline.AirCanada,
    confirmationNumber: 'ABC123',
    route: { origin: { code: 'ITH' }, destination: { code: 'ORD' } },
    departureDateTime: '2026-12-15T20:10:00',
    fareType: FareType.Unknown,
    originalCost: {
      purchaseType: PurchaseType.Points,
      points: 15000,
      taxesAndFeesUsd: 0,
    },
    bookingDate: '2026-10-14',
    source: FlightSource.Email,
    monitoring: true,
    createdAt: '2026-10-14T00:00:00Z',
    updatedAt: '2026-10-14T00:00:00Z',
    ...overrides,
  };
}

test('operatingAirline treats an Aeroplan booking on a United-numbered flight as United', () => {
  const flight = makeFlight({
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
  assert.equal(operatingAirline(flight), Airline.United);
});

test('operatingAirline keeps Air Canada when the operating flight number is genuinely Air Canada', () => {
  const flight = makeFlight({
    segments: [
      {
        origin: { code: 'ORD' },
        destination: { code: 'YYZ' },
        departureDateTime: '2026-12-15T08:00:00',
        arrivalDateTime: '2026-12-15T10:30:00',
        flightNumber: 'AC 123',
      },
    ],
  });
  assert.equal(operatingAirline(flight), Airline.AirCanada);
});

test('operatingAirline falls back to the stored airline when there are no segments', () => {
  const flight = makeFlight({ segments: undefined });
  assert.equal(operatingAirline(flight), Airline.AirCanada);
});

test('operatingAirline leaves non-Air-Canada bookings untouched', () => {
  const flight = makeFlight({
    airline: Airline.United,
    segments: [
      {
        origin: { code: 'ORD' },
        destination: { code: 'DEN' },
        departureDateTime: '2026-12-15T08:00:00',
        arrivalDateTime: '2026-12-15T09:30:00',
        flightNumber: 'UA 500',
      },
    ],
  });
  assert.equal(operatingAirline(flight), Airline.United);
});
