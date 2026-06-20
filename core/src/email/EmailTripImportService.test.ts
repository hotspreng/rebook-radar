import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EmailTripImportService } from './index.js';
import type { EmailMessage } from './index.js';

const svc = new EmailTripImportService();
const NOW = new Date('2026-06-01T00:00:00Z');

function email(id: string, date: string, subject: string, body: string): EmailMessage {
  return {
    id,
    internalDate: Date.parse(date),
    subject,
    from: 'no-reply@iluv.southwest.com',
    body,
  };
}

test('a single future booking becomes active', () => {
  const result = svc.fold(
    [
      email(
        'm1',
        '2026-03-01T00:00:00Z',
        "You're going to Las Vegas!",
        'Confirmation # ABC123\n(MDW) to (LAS)\nAug 14, 2026 9:35 AM\nTotal $129.98',
      ),
    ],
    { now: NOW },
  );
  assert.equal(result.active.length, 1);
  assert.equal(result.active[0].confirmationNumber, 'ABC123');
  assert.equal(result.cancelledConfirmations.length, 0);
});

test('booking then cancellation (latest wins) removes the trip', () => {
  const result = svc.fold(
    [
      email('m1', '2026-03-01T00:00:00Z', 'Air Reservation Confirmation', 'Confirmation # ABC123\n(MDW) to (LAS)\nAug 14, 2026 9:35 AM'),
      email('m2', '2026-04-01T00:00:00Z', 'Your reservation has been cancelled', 'Confirmation # ABC123'),
    ],
    { now: NOW },
  );
  assert.equal(result.active.length, 0);
  assert.deepEqual(result.cancelledConfirmations, ['ABC123']);
});

test('booking, change, then cancellation ends cancelled regardless of email order', () => {
  const result = svc.fold(
    [
      email('m3', '2026-05-01T00:00:00Z', 'Your reservation has been cancelled', 'Confirmation # ABC123'),
      email('m1', '2026-03-01T00:00:00Z', 'Air Reservation Confirmation', 'Confirmation # ABC123\n(MDW) to (LAS)\nAug 14, 2026 9:35 AM'),
      email('m2', '2026-04-01T00:00:00Z', 'Schedule change to your flight', 'Confirmation # ABC123\n(MDW) to (LAS)\nAug 15, 2026 10:00 AM'),
    ],
    { now: NOW },
  );
  assert.equal(result.active.length, 0);
  assert.deepEqual(result.cancelledConfirmations, ['ABC123']);
});

test('a change overwrites the itinerary and merges missing fields', () => {
  const result = svc.fold(
    [
      email(
        'm1',
        '2026-03-01T00:00:00Z',
        'Air Reservation Confirmation',
        'Confirmation # ABC123\n(MDW) to (LAS)\nAug 14, 2026 9:35 AM\nTotal $129.98',
      ),
      email(
        'm2',
        '2026-04-01T00:00:00Z',
        'Schedule change to your flight',
        'Confirmation # ABC123\n(MDW) to (LAS)\nAug 16, 2026 6:00 PM',
      ),
    ],
    { now: NOW },
  );
  assert.equal(result.active.length, 1);
  const trip = result.active[0];
  // Departure updated by the change; price retained from the original booking.
  assert.match(trip.departureDateTime, /2026-08-16/);
  assert.equal(trip.paidCashUsd, 129.98);
});

test('a change to a cheaper fare under the same PNR surfaces the original price', () => {
  const result = svc.fold(
    [
      email(
        'm1',
        '2026-03-01T00:00:00Z',
        'Air Reservation Confirmation',
        'Confirmation # ABC123\n(MDW) to (LAS)\nAug 14, 2026 9:35 AM\nTotal $200.00',
      ),
      email(
        'm2',
        '2026-04-01T00:00:00Z',
        'Air Reservation Confirmation',
        'Confirmation # ABC123\n(MDW) to (LAS)\nAug 14, 2026 9:35 AM\nTotal $129.98',
      ),
    ],
    { now: NOW },
  );
  assert.equal(result.active.length, 1);
  const trip = result.active[0];
  // Current fare is the cheaper one; the original (higher) fare is surfaced so
  // the importer can credit the drop as a saving.
  assert.equal(trip.paidCashUsd, 129.98);
  assert.equal(trip.originalPaidCashUsd, 200);
});

test('a change to a higher fare under the same PNR does not surface a saving', () => {
  const result = svc.fold(
    [
      email(
        'm1',
        '2026-03-01T00:00:00Z',
        'Air Reservation Confirmation',
        'Confirmation # ABC123\n(MDW) to (LAS)\nAug 14, 2026 9:35 AM\nTotal $100.00',
      ),
      email(
        'm2',
        '2026-04-01T00:00:00Z',
        'Air Reservation Confirmation',
        'Confirmation # ABC123\n(MDW) to (LAS)\nAug 14, 2026 9:35 AM\nTotal $150.00',
      ),
    ],
    { now: NOW },
  );
  assert.equal(result.active.length, 1);
  assert.equal(result.active[0].originalPaidCashUsd, undefined);
});

test('cancelled trips expose their last-known details for cancel-and-rebook matching', () => {
  const result = svc.fold(
    [
      email(
        'm1',
        '2026-03-01T00:00:00Z',
        'Air Reservation Confirmation',
        'Confirmation # ABC123\n(MDW) to (LAS)\nAug 14, 2026 9:35 AM\nTotal $200.00',
      ),
      email('m2', '2026-04-01T00:00:00Z', 'Your reservation has been cancelled', 'Confirmation # ABC123'),
    ],
    { now: NOW },
  );
  assert.deepEqual(result.cancelledConfirmations, ['ABC123']);
  assert.equal(result.cancelledTrips.length, 1);
  assert.equal(result.cancelledTrips[0].confirmationNumber, 'ABC123');
  assert.equal(result.cancelledTrips[0].paidCashUsd, 200);
});

test('re-booking under the same PNR after a cancellation revives the trip', () => {
  const result = svc.fold(
    [
      email('m1', '2026-03-01T00:00:00Z', 'Air Reservation Confirmation', 'Confirmation # ABC123\n(MDW) to (LAS)\nAug 14, 2026 9:35 AM'),
      email('m2', '2026-03-15T00:00:00Z', 'Your reservation has been cancelled', 'Confirmation # ABC123'),
      email('m3', '2026-04-01T00:00:00Z', 'Air Reservation Confirmation', 'Confirmation # ABC123\n(MDW) to (DEN)\nSep 02, 2026 8:00 AM'),
    ],
    { now: NOW },
  );
  assert.equal(result.active.length, 1);
  assert.equal(result.active[0].destination, 'DEN');
  assert.equal(result.cancelledConfirmations.length, 0);
});

test('past trips are excluded from active', () => {
  const result = svc.fold(
    [
      email('m1', '2026-01-01T00:00:00Z', 'Air Reservation Confirmation', 'Confirmation # OLD999\n(MDW) to (LAS)\nFeb 01, 2026 9:35 AM'),
    ],
    { now: NOW },
  );
  assert.equal(result.active.length, 0);
});

test('distinct confirmations are tracked independently', () => {
  const result = svc.fold(
    [
      email('m1', '2026-03-01T00:00:00Z', 'Air Reservation Confirmation', 'Confirmation # AAA111\n(MDW) to (LAS)\nAug 14, 2026 9:35 AM'),
      email('m2', '2026-03-02T00:00:00Z', 'Air Reservation Confirmation', 'Confirmation # BBB222\n(MDW) to (DEN)\nSep 01, 2026 9:35 AM'),
      email('m3', '2026-03-03T00:00:00Z', 'Your reservation has been cancelled', 'Confirmation # AAA111'),
    ],
    { now: NOW },
  );
  assert.equal(result.active.length, 1);
  assert.equal(result.active[0].confirmationNumber, 'BBB222');
  assert.deepEqual(result.cancelledConfirmations, ['AAA111']);
});
