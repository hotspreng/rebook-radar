import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FareType } from '../models/common.js';
import {
  GoogleFlightsSerpApiProvider,
  JsonFetch,
} from './GoogleFlightsSerpApiProvider.js';

const QUERY = { origin: 'ROC', destination: 'MDW', departureDate: '2026-10-08' };

function provider(fetchJson: JsonFetch, key: string | null = 'test-key'): GoogleFlightsSerpApiProvider {
  return new GoogleFlightsSerpApiProvider({
    fetchJson,
    getApiKey: async () => key ?? undefined,
    estimation: { centsPerPoint: 0.0135, awardTaxesUsd: 5.6 },
  });
}

test('maps Southwest itineraries and estimates points from cash', async () => {
  let calledUrl = '';
  const sut = provider(async (url) => {
    calledUrl = url;
    return {
      best_flights: [
        {
          price: 113,
          layovers: [],
          flights: [
            {
              airline: 'Southwest',
              flight_number: 'WN 123',
              departure_airport: { id: 'ROC', time: '2026-10-08 06:00' },
              arrival_airport: { id: 'MDW', time: '2026-10-08 07:30' },
            },
          ],
        },
      ],
    };
  });

  const results = await sut.searchPrice(QUERY);
  assert.equal(results.length, 1);
  const r = results[0]!;
  assert.equal(r.cashUsd, 113);
  assert.equal(r.departureDateTime, '2026-10-08T06:00');
  assert.equal(r.arrivalDateTime, '2026-10-08T07:30');
  assert.equal(r.stops, 0);
  assert.equal(r.fareType, FareType.Unknown);
  assert.equal(r.pointsEstimated, true);
  // (113 - 5.6) / 0.0135 = 7955.5 → rounded to nearest 10
  assert.equal(r.points, 7960);
  // one-way + correct airports encoded in the request
  assert.match(calledUrl, /engine=google_flights/);
  assert.match(calledUrl, /type=2/);
  assert.match(calledUrl, /departure_id=ROC/);
});

test('filters out non-Southwest itineraries', async () => {
  const sut = provider(async () => ({
    best_flights: [
      {
        price: 99,
        flights: [{ airline: 'United', flight_number: 'UA 1', departure_airport: { time: '2026-10-08 06:00' } }],
      },
    ],
    other_flights: [],
  }));
  await assert.rejects(sut.searchPrice(QUERY), /No Southwest fares found/);
});

test('throws when no API key is configured', async () => {
  const sut = provider(async () => ({}), null);
  await assert.rejects(sut.searchPrice(QUERY), /No SerpApi key configured/);
});

test('surfaces SerpApi error payloads', async () => {
  const sut = provider(async () => ({ error: 'Invalid API key' }));
  await assert.rejects(sut.searchPrice(QUERY), /Invalid API key/);
});

test('login and trip import are not supported', async () => {
  const sut = provider(async () => ({}));
  await assert.rejects(sut.login(), /not available/);
  await assert.rejects(sut.getUpcomingTrips(), /not available/);
});
