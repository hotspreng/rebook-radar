import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Airline, Cabin, PurchaseType } from '../models/common.js';
import {
  TripEventType,
  classifyDeltaEmail,
  isDeltaEmail,
  parseDeltaEmail,
} from './index.js';
import type { EmailMessage } from './index.js';
import { EmailTripImportService } from './EmailTripImportService.js';

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
  assert.equal(trip.cabin, Cabin.Economy);
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

function transatlanticReceipt(name: string): string {
  return `
Confirmation Number
ABC123
AWARD RECEIPT
Passenger Info
Name: ${name}
Sat, 20MARDEPARTARRIVE
DELTA 4813*
Delta Comfort Classic (S)
INDIANAPOLIS
04:32PM
MPLS-ST PAUL
05:23PM
DELTA 10
Delta Comfort Classic (S)
MPLS-ST PAUL
06:10PM
LONDON-HEATHROW, GB
07:05AM
Fare Details: IND DL MSP DL X/LON DL
Sat 20 Mar 2027IND-LHR
Issue Date: 12NOV26
Miles Redeemed 57,800 Miles
Total Charged - &#36;5.60 USD
`;
}

test('Delta per-traveler receipts for one PNR fold into one trip with every traveler', () => {
  const svc = new EmailTripImportService();
  const subject = 'Congrats On Your SkyMiles Award Trip';
  const result = svc.fold([
    msg({ id: 'a', subject, internalDate: 1763300000000, body: transatlanticReceipt('JANE Q DOE') }),
    msg({ id: 'b', subject, internalDate: 1763300001000, body: transatlanticReceipt('JOHN DOE') }),
  ]);
  assert.equal(result.active.length, 1);
  const trip = result.active[0]!;
  assert.deepEqual(trip.passengerNames, ['Jane Q Doe', 'John Doe']);
  assert.equal(trip.destination, 'LHR');
  assert.equal(trip.cabin, Cabin.PremiumEconomy);
  // The overnight second segment lands the next day at the real airport.
  assert.equal(trip.segments?.[1]?.destination, 'LHR');
  assert.equal(trip.segments?.[1]?.arrivalDateTime, '2027-03-21T07:05:00');
});
test('a Delta receipt forwarded by a relative is imported from the quoted original', () => {
  const original = transatlanticReceipt('JANE Q DOE');
  const forward = (from: string, body: string) =>
    msg({
      id: 'fwd',
      subject: 'Fwd: Congrats On Your SkyMiles Award Trip',
      from: 'Relative <relative@example.com>',
      internalDate: Date.parse('2026-11-20T00:00:00Z'),
      body: `FYI\n\n---------- Forwarded message ---------\nFrom: ${from}\nDate: Thu, Nov 12, 2026 at 9:00 AM\nSubject: Congrats On Your SkyMiles Award Trip\nTo: Relative <relative@example.com>\n\n${body}`,
    });
  const svc = new EmailTripImportService();

  const plain = svc.fold([forward('Delta Air Lines <DeltaAirLines@t.delta.com>', original)]);
  assert.equal(plain.active.length, 1);
  assert.equal(plain.active[0]!.destination, 'LHR');
  assert.deepEqual(plain.active[0]!.passengerNames, ['Jane Q Doe']);

  const quoted = original.split('\n').map((l) => `> ${l}`).join('\n');
  assert.equal(svc.fold([forward('Delta Air Lines <DeltaAirLines@t.delta.com>', quoted)]).active.length, 1);

  // A forward whose original is not from an airline is not mistaken for a flight.
  assert.equal(svc.fold([forward('Some Shop <orders@example.org>', original)]).active.length, 0);
});