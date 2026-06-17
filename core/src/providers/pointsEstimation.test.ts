import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_AWARD_TAXES_USD,
  DEFAULT_CENTS_PER_POINT,
  estimatePointsFromCash,
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
