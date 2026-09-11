import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FareType,
  FlightSource,
  PurchaseType,
  Recommendation,
} from '../models/index.js';
import type { Flight, PriceQuote } from '../models/index.js';
import { PricingComparisonService } from './PricingComparisonService.js';

const service = new PricingComparisonService();
const fixedNow = () => new Date('2026-06-16T12:00:00Z');

function makeFlight(overrides: Partial<Flight> = {}): Flight {
  return {
    id: 'flight_1',
    passengerId: 'pax_1',
    accountId: 'acct_1',
    confirmationNumber: 'ABC123',
    route: { origin: { code: 'MDW' }, destination: { code: 'DEN' } },
    departureDateTime: '2026-08-14T09:35:00-05:00',
    fareType: FareType.Basic,
    originalCost: {
      purchaseType: PurchaseType.Cash,
      cashUsd: 149.98,
      taxesAndFeesUsd: 0,
    },
    bookingDate: '2026-05-01',
    source: FlightSource.Manual,
    monitoring: true,
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    ...overrides,
  };
}

function makeQuote(overrides: Partial<PriceQuote> = {}): PriceQuote {
  return {
    flightId: 'flight_1',
    fareType: FareType.Basic,
    departureDateTime: '2026-08-14T09:35:00-05:00',
    fetchedAt: '2026-06-16T12:00:00Z',
    providerId: 'southwest',
    ...overrides,
  };
}

test('cash fare price drop above threshold recommends Rebook', () => {
  const flight = makeFlight();
  const quote = makeQuote({ cashUsd: 99.98 });
  const result = service.compare(flight, quote, {
    pointValueCents: 1.4,
    savingsThresholdUsd: 25,
    savingsThresholdPoints: 2000,
    now: fixedNow,
  });

  assert.equal(result.recommendation, Recommendation.Rebook);
  assert.equal(result.savingsUsd, 50);
  assert.equal(result.savingsNative, 50);
});

test('cash fare small drop below threshold recommends Keep', () => {
  const flight = makeFlight();
  const quote = makeQuote({ cashUsd: 139.98 });
  const result = service.compare(flight, quote, {
    pointValueCents: 1.4,
    savingsThresholdUsd: 25,
    savingsThresholdPoints: 2000,
    now: fixedNow,
  });

  assert.equal(result.recommendation, Recommendation.Keep);
  assert.equal(result.savingsUsd, 10);
});

test('points fare drop above threshold recommends Rebook', () => {
  const flight = makeFlight({
    originalCost: { purchaseType: PurchaseType.Points, points: 12000, taxesAndFeesUsd: 5.6 },
  });
  const quote = makeQuote({ points: 9000, pointsTaxesAndFeesUsd: 5.6 });
  const result = service.compare(flight, quote, {
    pointValueCents: 1.4,
    savingsThresholdUsd: 25,
    savingsThresholdPoints: 2000,
    now: fixedNow,
  });

  assert.equal(result.recommendation, Recommendation.Rebook);
  assert.equal(result.savingsNative, 3000);
});

test('points fare with captured actual cash scales current points up when the fare rises', () => {
  // Booked 8,500 pts when the real market cash fare was $161. The current cash
  // fare has risen to $211, so the same seat now costs MORE points.
  const flight = makeFlight({
    originalCost: { purchaseType: PurchaseType.Points, points: 8500, taxesAndFeesUsd: 5.6 },
    originalMarketCashUsd: 161,
  });
  const quote = makeQuote({ cashUsd: 211, points: 8500, pointsEstimated: true });
  const result = service.compare(flight, quote, {
    pointValueCents: 1.4,
    savingsThresholdUsd: 25,
    savingsThresholdPoints: 2000,
    now: fixedNow,
  });

  // 8,500 * 211 / 161 ≈ 11,140 — higher than booked, so no savings → Keep.
  assert.equal(result.currentAmount, Math.round((8500 * 211) / 161));
  assert.ok(result.currentAmount != null && result.currentAmount > 8500);
  assert.ok(result.savingsNative != null && result.savingsNative < 0);
  assert.equal(result.recommendation, Recommendation.Keep);
});

test('points fare with captured actual cash scales current points down when the fare falls', () => {
  const flight = makeFlight({
    originalCost: { purchaseType: PurchaseType.Points, points: 8500, taxesAndFeesUsd: 5.6 },
    originalMarketCashUsd: 161,
  });
  const quote = makeQuote({ cashUsd: 120, points: 8500, pointsEstimated: true });
  const result = service.compare(flight, quote, {
    pointValueCents: 1.4,
    savingsThresholdUsd: 25,
    savingsThresholdPoints: 2000,
    now: fixedNow,
  });

  assert.equal(result.currentAmount, Math.round((8500 * 120) / 161));
  assert.ok(result.currentAmount != null && result.currentAmount < 8500);
  assert.ok(result.savingsNative != null && result.savingsNative > 0);
});

test('points fare values the booking at the price paid, not the settings cpp', () => {
  // Booked 8,500 pts when the real cash fare was $161 (≈ 1.89¢/pt), well above
  // the 1.4¢ settings default. A fresh check right after booking returns the
  // same fare, so there is no real opportunity to rebook.
  const flight = makeFlight({
    originalCost: { purchaseType: PurchaseType.Points, points: 8500, taxesAndFeesUsd: 5.6 },
    originalMarketCashUsd: 161,
  });
  const quote = makeQuote({ cashUsd: 161, points: 8500, pointsTaxesAndFeesUsd: 5.6 });
  const result = service.compare(flight, quote, {
    pointValueCents: 1.4,
    savingsThresholdUsd: 25,
    savingsThresholdPoints: 2000,
    now: fixedNow,
  });

  // Original valued at what was actually paid ($161 + $5.60 taxes), NOT
  // 8,500 × 1.4¢ = $119 + taxes.
  assert.equal(result.originalValueUsd, 166.6);
  // The reported point value reflects the booking rate, not the 1.4¢ setting.
  assert.equal(result.pointValueCents, 1.89);
  // Same fare ⇒ no meaningful savings ⇒ Keep (no spurious rebook after booking).
  assert.equal(result.currentAmount, 8500);
  assert.equal(result.savingsNative, 0);
  assert.equal(result.recommendation, Recommendation.Keep);
});

test('missing quote yields Unknown recommendation', () => {
  const flight = makeFlight();
  const result = service.compare(flight, undefined, {
    pointValueCents: 1.4,
    savingsThresholdUsd: 25,
    savingsThresholdPoints: 2000,
    now: fixedNow,
  });

  assert.equal(result.recommendation, Recommendation.Unknown);
});

test('price increase recommends Keep', () => {
  const flight = makeFlight();
  const quote = makeQuote({ cashUsd: 199.98 });
  const result = service.compare(flight, quote, {
    pointValueCents: 1.4,
    savingsThresholdUsd: 25,
    savingsThresholdPoints: 2000,
    now: fixedNow,
  });

  assert.equal(result.recommendation, Recommendation.Keep);
  assert.ok(result.savingsUsd < 0);
});
