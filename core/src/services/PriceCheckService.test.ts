import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Airline, FareType, FlightSource, PurchaseType } from '../models/common.js';
import type { Flight } from '../models/index.js';
import type {
  AirlineProvider,
  FlightSearchResult,
  RetrievedTrip,
} from '../providers/AirlineProvider.js';
import { PriceCheckService } from './PriceCheckService.js';

function makeFlight(overrides: Partial<Flight> = {}): Flight {
  return {
    id: 'flight_1',
    passengerId: 'pax_1',
    airline: Airline.Southwest,
    confirmationNumber: 'C57HXM',
    route: { origin: { code: 'MDW' }, destination: { code: 'ROC' } },
    departureDateTime: '2026-10-13T13:00:00',
    fareType: FareType.WannaGetAway,
    originalCost: {
      purchaseType: PurchaseType.Points,
      points: 15000,
      taxesAndFeesUsd: 5.6,
    },
    bookingDate: '2026-06-01',
    source: FlightSource.Email,
    monitoring: true,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

/** A provider that just replays a fixed set of search results. */
function fakeProvider(results: FlightSearchResult[]): AirlineProvider {
  return {
    id: 'fake',
    name: 'Fake',
    async searchPrice(): Promise<FlightSearchResult[]> {
      return results;
    },
    async login(): Promise<never> {
      throw new Error('not supported');
    },
    async getUpcomingTrips(): Promise<RetrievedTrip[]> {
      return [];
    },
    async logout(): Promise<void> {
      /* no-op */
    },
  };
}

// The real SerpApi results seen for MDW→ROC on 2026-10-13: a cheaper 1-stop
// connection departs at the same 1:00 PM time as the nonstop the traveler
// actually booked.
const RESULTS: FlightSearchResult[] = [
  {
    flightNumber: 'WN 839 / WN 839 / WN 4110',
    departureDateTime: '2026-10-13T15:05',
    fareType: FareType.Unknown,
    cashUsd: 194,
    points: 13460,
    pointsEstimated: true,
    stops: 2,
  },
  {
    flightNumber: 'WN 2817 / WN 4110',
    departureDateTime: '2026-10-13T13:00',
    fareType: FareType.Unknown,
    cashUsd: 194,
    points: 13460,
    pointsEstimated: true,
    stops: 1,
  },
  {
    flightNumber: 'WN 2220',
    departureDateTime: '2026-10-13T17:55',
    fareType: FareType.Unknown,
    cashUsd: 221,
    points: 15390,
    pointsEstimated: true,
    stops: 0,
  },
  {
    flightNumber: 'WN 2750',
    departureDateTime: '2026-10-13T13:00',
    fareType: FareType.Unknown,
    cashUsd: 260,
    points: 18170,
    pointsEstimated: true,
    stops: 0,
  },
];

test('nonstop booking matches the same-time nonstop, not a cheaper connection', async () => {
  const service = new PriceCheckService();
  const flight = makeFlight(); // nonstop (no segments)
  const { quote } = await service.check(flight, fakeProvider(RESULTS), undefined);

  assert.ok(quote, 'expected a matched quote');
  // Must pick the $260 nonstop (WN 2750) over the $194 same-time connection.
  assert.equal(quote!.cashUsd, 260);
  assert.equal(quote!.points, 18170);
  assert.equal(quote!.departureDateTime, '2026-10-13T13:00');
});

test('connecting booking still matches a connection over a nonstop', async () => {
  const service = new PriceCheckService();
  // A booked flight with a connection stores its segments (2 = 1 stop).
  const flight = makeFlight({
    segments: [
      {
        origin: { code: 'MDW' },
        destination: { code: 'BWI' },
        departureDateTime: '2026-10-13T13:00',
      },
      {
        origin: { code: 'BWI' },
        destination: { code: 'ROC' },
        departureDateTime: '2026-10-13T16:30',
      },
    ],
  });
  const { quote } = await service.check(flight, fakeProvider(RESULTS), undefined);

  assert.ok(quote, 'expected a matched quote');
  // Same-time 1-stop connection ($194) preferred over the nonstop.
  assert.equal(quote!.cashUsd, 194);
  assert.equal(quote!.departureDateTime, '2026-10-13T13:00');
});
