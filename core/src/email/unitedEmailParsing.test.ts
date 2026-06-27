import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Airline, PurchaseType } from '../models/common.js';
import {
  TripEventType,
  classifyUnitedEmail,
  isUnitedEmail,
  parseUnitedEmail,
} from './index.js';
import type { EmailMessage } from './index.js';

function msg(partial: Partial<EmailMessage>): EmailMessage {
  return {
    id: 'u1',
    internalDate: Date.parse('2026-01-15T00:00:00Z'),
    subject: '',
    from: 'United Airlines <Receipts@united.com>',
    body: '',
    ...partial,
  };
}

// Real eTicket receipt body shape (cash, multi-segment round trip).
const CASH_RECEIPT = `
Confirmation Number:
 P0B0FE
 Flight 1 of 3 UA1211 Class: United Economy (N)
 Fri, Apr 10, 2026 Fri, Apr 10, 2026
 05:49 PM --> 08:47 PM
 Chicago, IL, US (ORD) Syracuse, NY, US (SYR)
 Flight 2 of 3 UA4853 Class: United Economy (N)
 Sat, Apr 11, 2026 Sat, Apr 11, 2026
 07:40 PM --> 09:08 PM
 Syracuse, NY, US (SYR) Washington, DC, US (IAD)
 Flight 3 of 3 UA1738 Class: United Economy (N)
 Sat, Apr 11, 2026 Sat, Apr 11, 2026
 10:30 PM --> 11:43 PM
 Washington, DC, US (IAD) Chicago, IL, US (ORD)
 Traveler Details
 SPRENGER/AMYSTERNIG
 SPRENGER/JOSHUADANIEL
 SPRENGER/EMILYJEAN
 Purchase Summary
 Method of payment: Visa ending in 7031
 Airfare: 258.60
 Total Per Passenger: 318.60 USD
 Total: 955.80 USD
`;

// Real award receipt body shape (miles, single segment one-way).
const AWARD_RECEIPT = `
 Confirmation Number:
 BYJFG4
 Flight 1 of 1 UA912 Class: United Economy (XN)
 Sun, Jun 07, 2026 Mon, Jun 08, 2026
 09:15 PM --> 08:30 AM
 Chicago, IL, US (ORD) Reykjavík, IS (KEF)
 Traveler Details
 SPRENGER/JOSHUADANIEL
 SPRENGER/AMYSTERNIG
 SPRENGER/EMILYJEAN
 SPRENGER/CLAIREMARIE
 SPRENGER/HENRYJAMES
 Purchase Summary
 Method of payment: MileagePlus XXXXX175 / American Express ending in 1005
 Airfare: 0.00
 Total Per Passenger: 40,000 miles + 7.20 USD
 Total: 200,000 miles + 36.00 USD
`;

test('isUnitedEmail recognizes United senders', () => {
  assert.equal(isUnitedEmail('United Airlines <Receipts@united.com>'), true);
  assert.equal(isUnitedEmail('notifications@united.com'), true);
  assert.equal(isUnitedEmail('no-reply@iluv.southwest.com'), false);
});

test('classifyUnitedEmail prioritizes cancel over change over booking', () => {
  assert.equal(
    classifyUnitedEmail('Your United flight has been canceled'),
    TripEventType.Cancelled,
  );
  assert.equal(
    classifyUnitedEmail('Flight UA912 from Chicago to Reykjavík has a new departure time'),
    TripEventType.Changed,
  );
  assert.equal(
    classifyUnitedEmail('eTicket Itinerary and Receipt for Confirmation P0B0FE'),
    TripEventType.Booked,
  );
  assert.equal(classifyUnitedEmail('Travel like a pro'), undefined);
});

test('parseUnitedEmail parses a cash round-trip receipt into two legs', () => {
  const event = parseUnitedEmail(
    msg({ subject: 'eTicket Itinerary and Receipt for Confirmation P0B0FE', body: CASH_RECEIPT }),
  );
  assert.ok(event);
  assert.equal(event!.type, TripEventType.Booked);
  assert.equal(event!.confirmationNumber, 'P0B0FE');
  const trip = event!.trip!;
  assert.equal(trip.airline, Airline.United);
  assert.equal(trip.purchaseType, PurchaseType.Cash);
  assert.equal(trip.paidCashUsd, 318.6);
  assert.equal(trip.taxesAndFeesUsd, 60);
  // The 23h ground stop in Syracuse splits the trip into two legs; the
  // IAD connection stays within the second leg.
  assert.equal(trip.legs?.length, 2);
  assert.equal(trip.origin, 'ORD');
  assert.equal(trip.destination, 'SYR');
  assert.equal(trip.legs![1]!.origin, 'SYR');
  assert.equal(trip.legs![1]!.destination, 'ORD');
  assert.equal(trip.legs![1]!.segments?.length, 2);
  assert.equal(trip.departureDateTime, '2026-04-10T17:49:00');
  assert.deepEqual(
    trip.passengerNames.map((n) => n.toLowerCase()),
    ['amysternig sprenger', 'joshuadaniel sprenger', 'emilyjean sprenger'],
  );
});

test('parseUnitedEmail parses an award one-way receipt with miles + taxes', () => {
  const event = parseUnitedEmail(
    msg({ subject: 'eTicket Itinerary and Receipt for Confirmation BYJFG4', body: AWARD_RECEIPT }),
  );
  assert.ok(event);
  const trip = event!.trip!;
  assert.equal(trip.airline, Airline.United);
  assert.equal(trip.purchaseType, PurchaseType.Points);
  assert.equal(trip.paidPoints, 40000);
  assert.equal(trip.taxesAndFeesUsd, 7.2);
  assert.equal(trip.legs, undefined); // single leg → no legs array
  assert.equal(trip.origin, 'ORD');
  assert.equal(trip.destination, 'KEF');
  assert.equal(trip.passengerNames.length, 5);
});

test('parseUnitedEmail skips a booking email with no parseable itinerary', () => {
  // Image-only schedule-change/notification bodies strip to whitespace.
  const event = parseUnitedEmail(
    msg({
      from: 'United Airlines <notifications@united.com>',
      subject: 'Your United Airlines booking confirmation – P0B0FE',
      body: '   \n  \n ',
    }),
  );
  assert.equal(event, undefined);
});

test('parseUnitedEmail divides a whole-reservation award total and ignores fare-rule codes', () => {
  // Older receipts carry only a reservation Total (no per-passenger line) and a
  // fare-rule code that looks like a "LAST/FIRST" name.
  const body = `
 Confirmation Number:
 EZ29M9
 Flight 1 of 2 UA2645 Class: United Economy (XN)
 Thu, Jun 12, 2025 Thu, Jun 12, 2025
 06:30 AM --> 09:09 AM
 Chicago, IL, US (ORD) San Francisco, CA, US (SFO)
 Flight 2 of 2 UA875 Class: United Economy (E)
 Thu, Jun 12, 2025 Fri, Jun 13, 2025
 10:55 AM --> 01:55 PM
 San Francisco, CA, US (SFO) Tokyo, JP (HND)
 Traveler Details
 SPRENGER/JACKSONJOSEPH
 SPRENGER/MAEVENANNE
 SPRENGER/AMYSTERNIG
 SPRENGER/EMILYJEAN
 SPRENGER/JOSHUADANIEL
 Purchase Summary
 Total: 275,000 miles + 28.00 USD
 Award Rules
 NON-END/-TRAN/-REF/UAONLY
`;
  const event = parseUnitedEmail(
    msg({ subject: 'eTicket Itinerary and Receipt for Confirmation EZ29M9', body }),
  );
  assert.ok(event);
  const trip = event!.trip!;
  // 5 real travelers — the "REF/UAONLY" fare-rule code must NOT count.
  assert.equal(trip.passengerNames.length, 5);
  assert.equal(trip.purchaseType, PurchaseType.Points);
  assert.equal(trip.paidPoints, 55000); // 275,000 / 5
  assert.equal(trip.taxesAndFeesUsd, 5.6); // 28.00 / 5
  // ORD->SFO->HND is one leg (short SFO connection).
  assert.equal(trip.legs, undefined);
  assert.equal(trip.origin, 'ORD');
  assert.equal(trip.destination, 'HND');
});

test('parseUnitedEmail parses a shared "Travel itinerary" email from notifications', () => {
  // Forwarded itinerary layout: full month names, lowercase am/pm, no fare,
  // "Confirmation number: …" in body, "Traveler N FIRST LAST".
  const body = `
 Flight itinerary for EMILYJEAN SPRENGER
 EMILYJEAN SPRENGER has requested that United Airlines send you this itinerary.
 November 24, 2026
 UA4853 operated by CommuteAir
 Embraer ERJ145
 November 24, 2026
 7:40 pm   9:19 pm
 SYR   1H, 39M
 IAD
 Syracuse Washington
 United Economy (YN)
   CONNECTION 1H, 4M
 November 24, 2026
 UA421 operated by United Airlines
 Boeing 737 MAX 9
 November 24, 2026
 10:23 pm   11:37 pm
 IAD   2H, 14M
 ORD
 Washington Chicago
 United Economy (YN)
 Traveler(s)
 Traveler 1 EMILYJEAN SPRENGER
Confirmation number: N0RQFD
`;
  const event = parseUnitedEmail(
    msg({
      from: 'United Airlines <notifications@united.com>',
      subject: 'Travel itinerary from United Airlines',
      body,
    }),
  );
  assert.ok(event);
  assert.equal(event!.type, TripEventType.Booked);
  assert.equal(event!.confirmationNumber, 'N0RQFD');
  const trip = event!.trip!;
  assert.equal(trip.airline, Airline.United);
  assert.equal(trip.origin, 'SYR');
  assert.equal(trip.destination, 'ORD');
  assert.equal(trip.departureDateTime, '2026-11-24T19:40:00');
  // SYR->IAD->ORD with a ~1h IAD connection is one leg with two segments.
  assert.equal(trip.legs, undefined);
  assert.equal(trip.segments?.length, 2);
  // Single traveler — "Confirmation" on the next line must NOT bleed into it.
  assert.deepEqual(trip.passengerNames, ['Emilyjean Sprenger']);
  // Shared itineraries carry no fare.
  assert.equal(trip.purchaseType, undefined);
  assert.equal(trip.paidCashUsd, undefined);
  assert.equal(trip.paidPoints, undefined);
});

test('parseUnitedEmail returns a cancellation event without trip details', () => {
  const event = parseUnitedEmail(
    msg({ subject: 'Your reservation P0B0FE has been canceled', body: '' }),
  );
  assert.ok(event);
  assert.equal(event!.type, TripEventType.Cancelled);
  assert.equal(event!.confirmationNumber, 'P0B0FE');
  assert.equal(event!.trip, undefined);
});
