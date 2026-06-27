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

test('treats Google Flights "no results" as a friendly no-results error', async () => {
  const sut = provider(async () => ({
    error: "Google Flights hasn't returned any results for this query.",
  }));
  await assert.rejects(sut.searchPrice(QUERY), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.equal((err as { code?: string }).code, 'NO_RESULTS');
    assert.match(err.message, /no Southwest fares for ROC→MDW/);
    return true;
  });
});

test('falls back to deep_search when the fast query returns no results', async () => {
  const urls: string[] = [];
  const sut = provider(async (url) => {
    urls.push(url);
    if (!url.includes('deep_search=true')) {
      return { error: "Google Flights hasn't returned any results for this query." };
    }
    return {
      best_flights: [
        {
          price: 206,
          flights: [
            {
              airline: 'Southwest',
              departure_airport: { id: 'MDW', time: '2026-10-09 07:45' },
              arrival_airport: { id: 'ROC', time: '2026-10-09 10:20' },
            },
          ],
        },
      ],
    };
  });

  const results = await sut.searchPrice({
    origin: 'MDW',
    destination: 'ROC',
    departureDate: '2026-10-09',
  });
  assert.equal(results.length, 1);
  assert.equal(results[0]!.cashUsd, 206);
  assert.equal(urls.length, 2);
  assert.ok(!urls[0]!.includes('deep_search'));
  assert.ok(urls[1]!.includes('deep_search=true'));
});

test('deep-searches when the fast path has no fare near the booked departure time', async () => {
  const urls: string[] = [];
  const sut = provider(async (url) => {
    urls.push(url);
    if (!url.includes('deep_search=true')) {
      // Fast path: only a morning nonstop — far from the booked 7:40pm flight.
      return {
        best_flights: [
          {
            price: 254,
            flights: [
              {
                airline: 'Southwest',
                departure_airport: { id: 'ROC', time: '2026-10-08 06:10' },
                arrival_airport: { id: 'MDW', time: '2026-10-08 07:50' },
              },
            ],
          },
        ],
      };
    }
    // Deep search reproduces the browser, including the booked evening flight.
    return {
      best_flights: [
        {
          price: 254,
          flights: [
            {
              airline: 'Southwest',
              departure_airport: { id: 'ROC', time: '2026-10-08 06:10' },
              arrival_airport: { id: 'MDW', time: '2026-10-08 07:50' },
            },
          ],
        },
        {
          price: 343,
          flights: [
            {
              airline: 'Southwest',
              departure_airport: { id: 'ROC', time: '2026-10-08 19:40' },
              arrival_airport: { id: 'MDW', time: '2026-10-08 21:19' },
            },
          ],
        },
      ],
    };
  });

  const results = await sut.searchPrice({
    ...QUERY,
    preferredDepartureTime: '2026-10-08T19:40',
  });
  // Both the fast nonstop and the deep-search evening flight are returned.
  assert.equal(results.length, 2);
  assert.ok(results.some((r) => r.departureDateTime === '2026-10-08T19:40'));
  // It actually retried with a deep search to surface the booked time.
  assert.equal(urls.length, 2);
  assert.ok(!urls[0]!.includes('deep_search'));
  assert.ok(urls[1]!.includes('deep_search=true'));
});

test('skips the deep search when the fast path already covers the booked time', async () => {
  const urls: string[] = [];
  const sut = provider(async (url) => {
    urls.push(url);
    return {
      best_flights: [
        {
          price: 343,
          flights: [
            {
              airline: 'Southwest',
              departure_airport: { id: 'ROC', time: '2026-10-08 19:40' },
              arrival_airport: { id: 'MDW', time: '2026-10-08 21:19' },
            },
          ],
        },
      ],
    };
  });

  const results = await sut.searchPrice({
    ...QUERY,
    preferredDepartureTime: '2026-10-08T19:40',
  });
  assert.equal(results.length, 1);
  // A near-time fare was present, so no costly deep search was needed.
  assert.equal(urls.length, 1);
  assert.ok(!urls[0]!.includes('deep_search'));
});

test('rotates to the next key when one runs out of searches', async () => {
  const usedKeys: string[] = [];
  const sut = new GoogleFlightsSerpApiProvider({
    fetchJson: async (url) => {
      const key = new URL(url).searchParams.get('api_key') ?? '';
      usedKeys.push(key);
      if (key === 'key-1') {
        return { error: 'Your account has run out of searches.' };
      }
      return {
        best_flights: [
          {
            price: 113,
            flights: [
              {
                airline: 'Southwest',
                departure_airport: { id: 'ROC', time: '2026-10-08 06:00' },
                arrival_airport: { id: 'MDW', time: '2026-10-08 07:30' },
              },
            ],
          },
        ],
      };
    },
    getApiKeys: async () => ['key-1', 'key-2'],
    estimation: { centsPerPoint: 0.0135, awardTaxesUsd: 5.6 },
  });

  const results = await sut.searchPrice(QUERY);
  assert.equal(results.length, 1);
  assert.deepEqual(usedKeys, ['key-1', 'key-2']);
});

test('throws when all keys are out of searches', async () => {
  const sut = new GoogleFlightsSerpApiProvider({
    fetchJson: async () => ({ error: 'You have run out of searches this month.' }),
    getApiKeys: async () => ['key-1', 'key-2'],
    estimation: { centsPerPoint: 0.0135, awardTaxesUsd: 5.6 },
  });
  await assert.rejects(sut.searchPrice(QUERY), /out of searches/);
});

test('login and trip import are not supported', async () => {
  const sut = provider(async () => ({}));
  await assert.rejects(sut.login(), /not available/);
  await assert.rejects(sut.getUpcomingTrips(), /not available/);
});
