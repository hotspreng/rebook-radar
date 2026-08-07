import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_AWARD_TAXES_USD,
  DEFAULT_CENTS_PER_POINT,
  estimatePointsFromCash,
  impliedCentsPerPoint,
} from './pointsEstimation.js';

test('returns undefined for missing or non-positive cash', () => {
  assert.equal(estimatePointsFromCash(undefined), undefined);
  assert.equal(estimatePointsFromCash(0), undefined);
  assert.equal(estimatePointsFromCash(-50), undefined);
  assert.equal(estimatePointsFromCash(Number.NaN), undefined);
});

test('returns undefined when cash only covers taxes & fees', () => {
  assert.equal(estimatePointsFromCash(DEFAULT_AWARD_TAXES_USD), undefined);
  assert.equal(estimatePointsFromCash(3), undefined);
});

test('estimates points from cash using the default rate', () => {
  // (205.60 - 5.60) / 0.0135 = 14,814.8 -> rounded to nearest 10
  const pts = estimatePointsFromCash(205.6);
  const expected = Math.round((205.6 - DEFAULT_AWARD_TAXES_USD) / DEFAULT_CENTS_PER_POINT / 10) * 10;
  assert.equal(pts, expected);
  assert.equal(pts % 10, 0);
});

test('honors a custom cents-per-point rate', () => {
  const pts = estimatePointsFromCash(105.6, { centsPerPoint: 0.014 });
  // (105.60 - 5.60) / 0.014 = 7142.8 -> 7140
  assert.equal(pts, 7140);
});

test('honors a custom award taxes amount', () => {
  const pts = estimatePointsFromCash(100, { centsPerPoint: 0.01, awardTaxesUsd: 0 });
  assert.equal(pts, 10000);
});

test('rejects a non-positive rate', () => {
  assert.equal(estimatePointsFromCash(200, { centsPerPoint: 0 }), undefined);
});

test('impliedCentsPerPoint derives a booking rate from actual cash + points', () => {
  // $161 market fare, $5.60 taxes, 8,500 pts -> (161 - 5.60) / 8500 dollars/pt.
  const rate = impliedCentsPerPoint(161, 8500, 5.6);
  assert.ok(rate != null);
  assert.ok(Math.abs(rate! - (161 - 5.6) / 8500) < 1e-9);
});

test('impliedCentsPerPoint returns undefined without both actual values', () => {
  assert.equal(impliedCentsPerPoint(undefined, 8500, 5.6), undefined);
  assert.equal(impliedCentsPerPoint(161, undefined, 5.6), undefined);
  assert.equal(impliedCentsPerPoint(0, 8500, 5.6), undefined);
  assert.equal(impliedCentsPerPoint(161, 0, 5.6), undefined);
  // Cash only covers taxes -> no base fare left to value.
  assert.equal(impliedCentsPerPoint(5.6, 8500, 5.6), undefined);
});

test('current points rise when cash rises, using the booking rate', () => {
  // Booked 8,500 pts @ $161 market. Current cash $211 should imply MORE points.
  const rate = impliedCentsPerPoint(161, 8500, 5.6)!;
  const currentPts = estimatePointsFromCash(211, { centsPerPoint: rate, awardTaxesUsd: 5.6 });
  assert.ok(currentPts != null && currentPts > 8500);
  // (211 - 5.60) / rate / 10 rounded * 10
  const expected = Math.round((211 - 5.6) / rate / 10) * 10;
  assert.equal(currentPts, expected);
});
