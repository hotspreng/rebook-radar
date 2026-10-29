import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  Airline,
  FareType,
  FlightSource,
  PurchaseType,
  Recommendation,
  isCompanionPassFlight,
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

test('manual cash fare includes separately entered taxes in the original total', () => {
  const flight = makeFlight({
    originalCost: {
      purchaseType: PurchaseType.Cash,
      cashUsd: 376.74,
      taxesAndFeesUsd: 43.66,
    },
  });
  const quote = makeQuote({ cashUsd: 420 });
  const result = service.compare(flight, quote, {
    pointValueCents: 1.4,
    savingsThresholdUsd: 25,
    savingsThresholdPoints: 2000,
    now: fixedNow,
  });

  assert.equal(result.originalAmount, 420.4);
  assert.equal(result.originalValueUsd, 420.4);
  assert.equal(result.savingsNative, 0.4);
  assert.equal(result.savingsUsd, 0.4);
});

test('imported cash fare does not add itemized taxes to its all-in total', () => {
  const flight = makeFlight({
    source: FlightSource.Email,
    originalCost: {
      purchaseType: PurchaseType.Cash,
      cashUsd: 420,
      taxesAndFeesUsd: 43.26,
    },
  });
  const result = service.compare(flight, makeQuote({ cashUsd: 420 }), {
    pointValueCents: 1.4,
    savingsThresholdUsd: 25,
    savingsThresholdPoints: 2000,
    now: fixedNow,
  });

  assert.equal(result.originalAmount, 420);
  assert.equal(result.savingsNative, 0);
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

test('baseline holding override measures savings against the effective holding, not the booked points', () => {
  // Booked 26,900 pts (seat's real cash fare $334 at booking). A credit left an
  // effective holding of 14,500 pts. The current cash fare implies a higher
  // points price now, so rebooking would be WORSE → Keep, no phantom savings.
  const flight = makeFlight({
    source: FlightSource.Email,
    originalCost: { purchaseType: PurchaseType.Points, points: 26900, taxesAndFeesUsd: 6 },
    originalMarketCashUsd: 334,
  });
  const quote = makeQuote({ cashUsd: 291, points: 26900, pointsEstimated: true });

  const raw = service.compare(flight, quote, {
    pointValueCents: 1.35,
    savingsThresholdUsd: 25,
    savingsThresholdPoints: 2000,
    now: fixedNow,
  });
  const eff = service.compare(flight, quote, {
    pointValueCents: 1.35,
    savingsThresholdUsd: 25,
    savingsThresholdPoints: 2000,
    baselineHoldingNative: 14500,
    now: fixedNow,
  });

  // The current estimate is unchanged — the override never touches the seat's
  // booked redemption rate used to price it.
  assert.equal(eff.currentAmount, raw.currentAmount);
  assert.equal(eff.originalAmount, 14500);
  assert.ok(eff.savingsNative != null && eff.savingsNative < 0);
  assert.equal(eff.recommendation, Recommendation.Keep);
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

const opts = { pointValueCents: 1.4, savingsThresholdUsd: 25, savingsThresholdPoints: 2000, now: fixedNow };

test('two travelers on the same flight get the same current points, scaled from the most recent booking', () => {
  const quote = makeQuote({ cashUsd: 241, pointsEstimated: true });
  const early = makeFlight({
    id: 'early',
    bookingDate: '2026-08-19',
    originalCost: { purchaseType: PurchaseType.Points, points: 8000, taxesAndFeesUsd: 5.6 },
    originalMarketCashUsd: 129,
  });
  const late = makeFlight({
    id: 'late',
    bookingDate: '2026-09-11',
    originalCost: { purchaseType: PurchaseType.Points, points: 9000, taxesAndFeesUsd: 5.6 },
    originalMarketCashUsd: 192,
  });
  const anchorOf = (f: Flight) => ({ points: f.originalCost.points!, cashUsd: f.originalMarketCashUsd!, bookedOn: f.bookingDate });

  const a = service.compare(early, quote, { ...opts, sameFlightAnchors: [anchorOf(late)] });
  const b = service.compare(late, quote, { ...opts, sameFlightAnchors: [anchorOf(early)] });

  // The September booking is the most recent, so both scale from 9,000 pts / $192.
  const expected = Math.round((9000 * 241) / 192);
  assert.equal(a.currentAmount, expected);
  assert.equal(b.currentAmount, expected);
  // Savings now differ only by what each traveler actually paid (1,000 pts).
  assert.equal(b.savingsNative! - a.savingsNative!, 1000);
});

test('a ticket with no anchor of its own borrows one from the identical flight', () => {
  const flight = makeFlight({ originalCost: { purchaseType: PurchaseType.Points, points: 9000, taxesAndFeesUsd: 5.6 } });
  const quote = makeQuote({ cashUsd: 241, pointsEstimated: true });
  const result = service.compare(flight, quote, { ...opts, sameFlightAnchors: [{ points: 8000, cashUsd: 129, bookedOn: '2026-08-19' }] });
  assert.equal(result.currentAmount, Math.round((8000 * 241) / 129));
});

test('a Southwest cash ticket under $20 is a Companion Pass ticket: price and savings do not apply', () => {
  const flight = makeFlight({
    airline: Airline.Southwest,
    source: FlightSource.Email,
    originalCost: { purchaseType: PurchaseType.Cash, cashUsd: 11.2, taxesAndFeesUsd: 11.2 },
  });
  assert.equal(isCompanionPassFlight(flight), true);
  const result = service.compare(flight, makeQuote({ cashUsd: 150 }), opts);
  assert.equal(result.notApplicable, true);
  assert.equal(result.recommendation, Recommendation.Unknown);
  assert.equal(result.savingsUsd, 0);
  assert.equal(result.currentAmount, undefined);
});

test('companion detection: only Southwest cash tickets under $20 all-in', () => {
  const cash = (cashUsd: number, extra: Partial<Flight> = {}): Flight =>
    makeFlight({
      airline: Airline.Southwest,
      source: FlightSource.Email,
      originalCost: { purchaseType: PurchaseType.Cash, cashUsd, taxesAndFeesUsd: 0 },
      ...extra,
    });
  assert.equal(isCompanionPassFlight(cash(19.99)), true);
  assert.equal(isCompanionPassFlight(cash(20)), false);
  assert.equal(isCompanionPassFlight(cash(11.2, { airline: Airline.United })), false);
  assert.equal(
    isCompanionPassFlight(makeFlight({ airline: Airline.Southwest, originalCost: { purchaseType: PurchaseType.Points, points: 5000, taxesAndFeesUsd: 5.6 } })),
    false,
  );
  // A manual entry keeps taxes apart: $12 fare + $11.20 taxes is not under $20.
  assert.equal(
    isCompanionPassFlight(makeFlight({ airline: Airline.Southwest, source: FlightSource.Manual, originalCost: { purchaseType: PurchaseType.Cash, cashUsd: 12, taxesAndFeesUsd: 11.2 } })),
    false,
  );
});

test('a cheaper-fare traveler on the flight does not drag the other traveler estimate down by half', () => {
  // Amy booked 9,000 pts when the fare was $208; Emily booked 17,000 pts at $225.
  // With the fare now $198 (about 12% below Emily's), Emily's points must fall
  // about 12% too — not to the ~8,567 that Amy's ratio would give.
  const amy = makeFlight({
    id: 'amy',
    bookingDate: '2026-10-07',
    originalCost: { purchaseType: PurchaseType.Points, points: 9000, taxesAndFeesUsd: 5.6 },
    originalMarketCashUsd: 208,
  });
  const emily = makeFlight({
    id: 'emily',
    bookingDate: '2026-10-24',
    originalCost: { purchaseType: PurchaseType.Points, points: 17000, taxesAndFeesUsd: 5.6 },
    originalMarketCashUsd: 225,
  });
  const quote = makeQuote({ cashUsd: 198, pointsEstimated: true });
  const emilyResult = service.compare(emily, quote, {
    ...opts,
    sameFlightAnchors: [{ points: 9000, cashUsd: 208, bookedOn: '2026-10-07' }],
  });
  assert.equal(emilyResult.currentAmount, Math.round((17000 * 198) / 225));
  assert.equal(emilyResult.savingsNative, 17000 - Math.round((17000 * 198) / 225));
  // Amy sees the same current price for the same flight.
  const amyResult = service.compare(amy, quote, {
    ...opts,
    sameFlightAnchors: [{ points: 17000, cashUsd: 225, bookedOn: '2026-10-24' }],
  });
  assert.equal(amyResult.currentAmount, emilyResult.currentAmount);
});