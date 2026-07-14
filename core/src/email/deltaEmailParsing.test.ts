import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Airline, PurchaseType } from '../models/common.js';
import {
  TripEventType,
  classifyDeltaEmail,
  isDeltaEmail,
  parseDeltaEmail,
} from './index.js';
import type { EmailMessage } from './index.js';

function msg(partial: Partial<EmailMessage>): EmailMessage {
  return {
    id: 'd1',
    internalDate: Date.parse('2026-01-15T00:00:00Z'),
    subject: '',
    from: 'Delta Air Lines <DeltaAirLines@e.delta.com>',
    body: '',
    ...partial,
  };
}

// Best-effort fixture matching the parser's expected layout (cash, one segment).
const CASH_BOOKING = `
Your Delta flight confirmation

Confirmation #: HGKZPQ

Departs Atlanta, GA (ATL)
Fri, Apr 10, 2026  6:00 AM
Arrives New York-JFK, NY (JFK)
Fri, Apr 10, 2026  8:20 AM
Delta 1234

Passenger  Emily Sprenger

Total: $318.60
`;

// Award fixture (SkyMiles + taxes, one segment).
const AWARD_BOOKING = `
Confirmation #: JKLM12

Departs Detroit, MI (DTW)
Sat, May 16, 2026  9:15 AM
Arrives Los Angeles, CA (LAX)
Sat, May 16, 2026  11:05 AM
Delta 2200

Passenger  Amy Sprenger

25,000 miles + $5.60
`;

// Round trip: outbound + a much-later return = two legs sharing one PNR.
const ROUND_TRIP = `
Confirmation #: RT1234

Departs Rochester, NY (ROC)
Mon, Jun 01, 2026  7:00 AM
Arrives Atlanta, GA (ATL)
Mon, Jun 01, 2026  9:30 AM
Delta 100

Departs Atlanta, GA (ATL)
Fri, Jun 05, 2026  5:00 PM
Arrives Rochester, NY (ROC)
Fri, Jun 05, 2026  7:30 PM
Delta 200

Passenger  Emily Sprenger

Total: $412.00
`;

test('isDeltaEmail recognizes Delta senders', () => {
  assert.equal(isDeltaEmail('Delta Air Lines <DeltaAirLines@e.delta.com>'), true);
  assert.equal(isDeltaEmail('confirmation@delta.com'), true);
  assert.equal(isDeltaEmail('Receipts@united.com'), false);
  assert.equal(isDeltaEmail('no-reply@iluv.southwest.com'), false);
});

test('classifyDeltaEmail prioritizes cancel over change over booking', () => {
  assert.equal(classifyDeltaEmail('Your Delta flight has been canceled'), TripEventType.Cancelled);
  assert.equal(classifyDeltaEmail('Schedule change to your upcoming trip'), TripEventType.Changed);
  assert.equal(classifyDeltaEmail('Your Delta flight confirmation (HGKZPQ)'), TripEventType.Booked);
  assert.equal(classifyDeltaEmail('SkyMiles Weekly: deals just for you'), undefined);
});

test('parseDeltaEmail parses a cash booking with segment, passenger, and total', () => {
  const event = parseDeltaEmail(
    msg({ subject: 'Your Delta flight confirmation (HGKZPQ)', body: CASH_BOOKING }),
  );
  assert.ok(event);
  assert.equal(event!.type, TripEventType.Booked);
  assert.equal(event!.confirmationNumber, 'HGKZPQ');
  const trip = event!.trip!;
  assert.equal(trip.airline, Airline.Delta);
  assert.equal(trip.origin, 'ATL');
  assert.equal(trip.destination, 'JFK');
  assert.equal(trip.departureDateTime, '2026-04-10T06:00:00');
  assert.equal(trip.purchaseType, PurchaseType.Cash);
  assert.equal(trip.paidCashUsd, 318.6);
  assert.deepEqual(trip.passengerNames, ['Emily Sprenger']);
});

test('parseDeltaEmail parses an award booking (miles + taxes)', () => {
  const event = parseDeltaEmail(
    msg({ subject: 'Your Delta flight confirmation (JKLM12)', body: AWARD_BOOKING }),
  );
  const trip = event!.trip!;
  assert.equal(trip.purchaseType, PurchaseType.Points);
  assert.equal(trip.paidPoints, 25000);
  assert.equal(trip.taxesAndFeesUsd, 5.6);
  assert.equal(trip.origin, 'DTW');
  assert.equal(trip.destination, 'LAX');
});

test('parseDeltaEmail splits a round trip into two legs sharing the PNR', () => {
  const event = parseDeltaEmail(
    msg({ subject: 'Your Delta flight confirmation (RT1234)', body: ROUND_TRIP }),
  );
  const trip = event!.trip!;
  assert.equal(trip.confirmationNumber, 'RT1234');
  assert.ok(trip.legs);
  assert.equal(trip.legs!.length, 2);
  assert.equal(trip.legs![0]!.origin, 'ROC');
  assert.equal(trip.legs![0]!.destination, 'ATL');
  assert.equal(trip.legs![1]!.origin, 'ATL');
  assert.equal(trip.legs![1]!.destination, 'ROC');
});

test('parseDeltaEmail ignores marketing subjects', () => {
  assert.equal(
    parseDeltaEmail(msg({ subject: 'SkyMiles Weekly: deals just for you', body: CASH_BOOKING })),
    undefined,
  );
});
