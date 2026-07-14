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
    internalDate: Date.parse('2026-07-12T00:00:00Z'),
    subject: '',
    from: 'Delta Air Lines <DeltaAirLines@t.delta.com>',
    body: '',
    ...partial,
  };
}

// Real Delta "Award Receipt" body shape (DEN→ITH via a JFK connection, award).
const AWARD_RECEIPT = `
 Delta Air Lines
 Confirmation Number
HWGXRS
AWARD RECEIPT
Passenger Info
 Name: EMILY JEAN SPRENGER
FLIGHTSEAT
 DELTA 53227A
 DELTA 539414D
 Tue, 23FEBDEPARTARRIVE
 DELTA 532
 Delta Main (N)
 DENVER
 12:20PM
 NYC-KENNEDY
 06:22PM
 DELTA 5394*
 Delta Main (N)
 NYC-KENNEDY
 10:00PM
 ITHACA NY
 11:21PM
 Award Flight Receipt
 Ticket #: 0062446747598
 Issue Date: 12JUL26
 Miles Redeemed 27,100 Miles
 Total Charged - &#36;5.60 USD
 Fare Details: DEN DL X/NYC DL ITH0.00YSL271/FFX15 USD0.00END
 Tue 23 Feb 2027DEN-ITH
 &#36;45.00USD (50LBS/23KG)
`;

test('isDeltaEmail recognizes Delta senders', () => {
  assert.equal(isDeltaEmail('Delta Air Lines <DeltaAirLines@t.delta.com>'), true);
  assert.equal(isDeltaEmail('DeltaAirLines@e.delta.com'), true);
  assert.equal(isDeltaEmail('Receipts@united.com'), false);
  assert.equal(isDeltaEmail('no-reply@iluv.southwest.com'), false);
});

test('classifyDeltaEmail prioritizes cancel over change over booking', () => {
  assert.equal(classifyDeltaEmail('Your Delta flight has been canceled'), TripEventType.Cancelled);
  assert.equal(classifyDeltaEmail('Schedule change to your upcoming trip'), TripEventType.Changed);
  assert.equal(classifyDeltaEmail('Congrats On Your SkyMiles Award Trip'), TripEventType.Booked);
  // Account/marketing subjects are not trip events.
  assert.equal(classifyDeltaEmail('Your SkyMiles Account Has Been Updated'), undefined);
  assert.equal(classifyDeltaEmail('SkyMiles Weekly: deals just for you'), undefined);
});

test('parseDeltaEmail parses a real Award Receipt (route, date, miles, passenger)', () => {
  const event = parseDeltaEmail(
    msg({ subject: 'Congrats On Your SkyMiles Award Trip', body: AWARD_RECEIPT }),
  );
  assert.ok(event);
  assert.equal(event!.type, TripEventType.Booked);
  assert.equal(event!.confirmationNumber, 'HWGXRS');
  const trip = event!.trip!;
  assert.equal(trip.airline, Airline.Delta);
  assert.equal(trip.origin, 'DEN');
  assert.equal(trip.destination, 'ITH');
  assert.equal(trip.departureDateTime, '2027-02-23T12:20:00');
  assert.equal(trip.arrivalDateTime, '2027-02-23T23:21:00');
  assert.equal(trip.purchaseType, PurchaseType.Points);
  assert.equal(trip.paidPoints, 27100);
  assert.equal(trip.taxesAndFeesUsd, 5.6);
  assert.deepEqual(trip.passengerNames, ['Emily Jean Sprenger']);
});

test('parseDeltaEmail builds per-segment detail from the routing', () => {
  const event = parseDeltaEmail(
    msg({ subject: 'Congrats On Your SkyMiles Award Trip', body: AWARD_RECEIPT }),
  );
  const segs = event!.trip!.segments!;
  assert.equal(segs.length, 2);
  assert.equal(segs[0]!.origin, 'DEN');
  assert.equal(segs[0]!.destination, 'NYC');
  assert.equal(segs[0]!.flightNumber, 'DL 532');
  assert.equal(segs[1]!.origin, 'NYC');
  assert.equal(segs[1]!.destination, 'ITH');
  assert.equal(segs[1]!.flightNumber, 'DL 5394');
});

test('parseDeltaEmail skips a booking email with no parseable itinerary', () => {
  // A "transaction notice" award email carries miles but no flight blocks.
  const notice = `
 An Award Travel transaction has posted to your account.
 Confirmation Number
HWGXRS
 Miles Redeemed 27,100 Miles
 This email is a transaction notice only.
`;
  assert.equal(
    parseDeltaEmail(msg({ subject: 'Congrats On Your SkyMiles Award Trip', body: notice })),
    undefined,
  );
});

test('parseDeltaEmail ignores marketing subjects', () => {
  assert.equal(
    parseDeltaEmail(msg({ subject: 'SkyMiles Weekly: deals just for you', body: AWARD_RECEIPT })),
    undefined,
  );
});
