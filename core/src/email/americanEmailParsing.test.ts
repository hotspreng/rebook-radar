import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Airline, Cabin, PurchaseType } from '../models/common.js';
import {
  TripEventType,
  classifyAmericanEmail,
  isAmericanEmail,
  parseAmericanEmail,
} from './index.js';
import type { EmailMessage } from './index.js';

function msg(partial: Partial<EmailMessage>): EmailMessage {
  return {
    id: 'aa1',
    internalDate: Date.parse('2026-09-09T17:19:00Z'),
    subject: '',
    from: 'American Airlines <no-reply@info.email.aa.com>',
    body: '',
    ...partial,
  };
}

// Real American "trip confirmation and receipt" body shape (ORD→OGG, cash,
// three passengers), as the Gmail HTML-strip hands it to the parser. Each field
// lands on its own line and the "AA <n>" flight number sits in the MIDDLE of
// the segment block: date, origin code + city + departure time come BEFORE it,
// destination code + city + arrival time come AFTER it.
const TRIP_CONFIRMATION = `
Your trip confirmation and receipt
You can check in via the American app 24 hours before your trip and get your mobile boarding pass.
Confirmation code:
QDFZSJ
Thursday, January 7, 2027
ORD
Chicago O'Hare
11:55 AM
AA 89
OGG
Maui Kahului
5:40 PM
Seat: 30J, 30L, 29L
Class: Economy (B)
Meals: Snack
Manage your trip
Limited time: Earn up to 125,000 bonus miles*
Find the Citi® / AAdvantage® card that's right for you. Terms apply.
Learn more
Your purchase
Joshua Sprenger - AAdvantage® #: 0U5****
New ticket $238.16
Taxes & carrier-imposed fees $34.94
Ticket #: 0012375884819
Standard Seat (ORD-OGG) $32.13
Taxes & carrier-imposed fees $1.06
Document #: 0010655826037
Amy Sprenger - AAdvantage® #: 2M6****
New ticket $238.16
Taxes & carrier-imposed fees $34.94
Ticket #: 0012375884821
Standard Seat (ORD-OGG) $32.13
Taxes & carrier-imposed fees $1.06
Document #: 0010655826038
Emily Sprenger
New ticket $238.16
Taxes & carrier-imposed fees $34.94
Ticket #: 0012375884823
Standard Seat (ORD-OGG) $32.13
Taxes & carrier-imposed fees $1.06
Document #: 0010655826039
Total cost (all passengers) $918.87
Your payment
Visa (ending 4518) $567.07
American Airlines Gift Card $351.80
Total paid $918.87
`;

test('isAmericanEmail recognizes American senders', () => {
  assert.equal(isAmericanEmail('American Airlines <no-reply@info.email.aa.com>'), true);
  assert.equal(isAmericanEmail('no-reply@aa.com'), true);
  assert.equal(isAmericanEmail('DeltaAirLines@t.delta.com'), false);
  assert.equal(isAmericanEmail('Receipts@united.com'), false);
  assert.equal(isAmericanEmail('no-reply@iluv.southwest.com'), false);
});

test('classifyAmericanEmail prioritizes cancel over change over booking', () => {
  assert.equal(
    classifyAmericanEmail('Your American Airlines trip has been canceled'),
    TripEventType.Cancelled,
  );
  assert.equal(
    classifyAmericanEmail('Schedule change to your upcoming trip'),
    TripEventType.Changed,
  );
  assert.equal(classifyAmericanEmail('Your trip confirmation (ORD - OGG)'), TripEventType.Booked);
  // Marketing / account subjects are not trip events.
  assert.equal(classifyAmericanEmail('Earn up to 125,000 bonus miles'), undefined);
  assert.equal(classifyAmericanEmail('AAdvantage statement: your miles summary'), undefined);
});

test('parseAmericanEmail parses a real trip confirmation (route, date, fare, passengers)', () => {
  const event = parseAmericanEmail(
    msg({ subject: 'Your trip confirmation (ORD - OGG)', body: TRIP_CONFIRMATION }),
  );
  assert.ok(event, 'expected a parsed event');
  assert.equal(event.type, TripEventType.Booked);
  assert.equal(event.confirmationNumber, 'QDFZSJ');

  const trip = event.trip;
  assert.ok(trip, 'expected trip details');
  assert.equal(trip.airline, Airline.American);
  assert.equal(trip.origin, 'ORD');
  assert.equal(trip.destination, 'OGG');
  assert.equal(trip.departureDateTime, '2027-01-07T11:55:00');
  assert.equal(trip.arrivalDateTime, '2027-01-07T17:40:00');
  assert.equal(trip.segments, undefined); // single non-stop
  assert.equal(trip.cabin, Cabin.Economy);
  assert.equal(trip.purchaseType, PurchaseType.Cash);
  assert.equal(trip.paidCashUsd, 273.1); // 238.16 fare + 34.94 taxes
  assert.equal(trip.taxesAndFeesUsd, 34.94);
  assert.deepEqual(trip.passengerNames, [
    'Joshua Sprenger',
    'Amy Sprenger',
    'Emily Sprenger',
  ]);
});

test('parseAmericanEmail splits a multi-direction reservation into tracked legs', () => {
  const body = `
Your trip confirmation and receipt
Confirmation code: ABC123
Thursday, January 7, 2027
ORD
Chicago O'Hare
8:00 AM
AA 101
DFW
Dallas Fort Worth
10:30 AM
AA 202
OGG
Maui Kahului
2:00 PM
Thursday, January 14, 2027
OGG
Maui Kahului
3:00 PM
AA 303
LAX
Los Angeles
10:00 PM
Friday, January 15, 2027
LAX
Los Angeles
9:00 AM
AA 404
ORD
Chicago O'Hare
3:00 PM
Joshua Sprenger
New ticket $500.00
Taxes & carrier-imposed fees $50.00
`;

  const event = parseAmericanEmail(
    msg({ subject: 'Your trip confirmation (ABC123)', body }),
  );
  assert.ok(event?.trip);
  assert.equal(event.trip.origin, 'ORD');
  assert.equal(event.trip.destination, 'OGG');
  assert.equal(event.trip.segments?.length, 2);
  assert.equal(event.trip.legs?.length, 3);
  assert.deepEqual(
    event.trip.legs?.map((leg) => [leg.origin, leg.destination]),
    [['ORD', 'OGG'], ['OGG', 'LAX'], ['LAX', 'ORD']],
  );
});

test('parseAmericanEmail ignores a marketing email with no itinerary', () => {
  const event = parseAmericanEmail(
    msg({
      subject: 'Earn up to 125,000 bonus miles',
      body: 'Find the Citi / AAdvantage card that is right for you. Terms apply.',
    }),
  );
  assert.equal(event, undefined);
});

test('parseAmericanEmail returns a bare event for a cancellation', () => {
  const event = parseAmericanEmail(
    msg({
      subject: 'Your trip has been canceled',
      body: 'Confirmation code: QDFZSJ\nYour trip has been canceled.',
    }),
  );
  assert.ok(event);
  assert.equal(event.type, TripEventType.Cancelled);
  assert.equal(event.confirmationNumber, 'QDFZSJ');
  assert.equal(event.trip, undefined);
});
