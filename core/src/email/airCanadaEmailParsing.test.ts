import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Airline, Cabin, PurchaseType } from '../models/common.js';
import {
  TripEventType,
  classifyAirCanadaEmail,
  isAirCanadaEmail,
  parseAirCanadaEmail,
} from './index.js';
import type { EmailMessage } from './index.js';

const CONFIRMATION = `
Booking Confirmation
AOGYVQ Issued 13 Sep, 2026
Flights
Departure • Fri 22 Jan, 2027
Economy - Standard Reward
Chicago ORD Vail Eagle EGE
08:44 10:55
O'Hare International Airport, Terminal 1 Eagle County Regional Airport
UA2663 • Operated by United Airlines
Aircraft type: Boeing 737-700
Duration: 3hr 11m
Cabin: Economy (X)
United Airlines booking reference: BRPBNN
Passengers
Joshua Daniel Sprenger
Ticket #: 0142336700170
Seats
ORD ➞ EGE -
Purchase Summary
Aeroplan •••• 4429 15,000 pts
•••• 4518 CAD $46.70
1 Adult
Air Transportation Charges (in points)
Base Fare 15,000 pts
Partner Booking fee $39.00
Taxes, Fees and Charges
September 11th Security Fee - United States $7.70
Grand total 15,000 pts + CAD $46.70
`;

function message(partial: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id: 'ac1',
    internalDate: Date.parse('2026-09-13T03:48:00Z'),
    subject: 'Air Canada - 22 Jan 2027: Chicago - Vail Eagle (Booking reference: AOGYVQ)',
    from: 'Air Canada <notification@notification.aircanada.ca>',
    body: CONFIRMATION,
    ...partial,
  };
}

test('isAirCanadaEmail recognizes Air Canada transactional senders', () => {
  assert.equal(isAirCanadaEmail('Air Canada <notification@notification.aircanada.ca>'), true);
  assert.equal(isAirCanadaEmail('confirmation@aircanada.ca'), true);
  assert.equal(isAirCanadaEmail('Receipts@united.com'), false);
});

test('classifyAirCanadaEmail recognizes bookings and cancellations', () => {
  assert.equal(classifyAirCanadaEmail(message().subject), TripEventType.Booked);
  assert.equal(classifyAirCanadaEmail('Your Air Canada booking has been cancelled'), TripEventType.Cancelled);
});

test('parseAirCanadaEmail parses the supplied Aeroplan reward confirmation', () => {
  const event = parseAirCanadaEmail(message());
  assert.ok(event?.trip);
  assert.equal(event.confirmationNumber, 'AOGYVQ');
  assert.equal(event.trip.airline, Airline.AirCanada);
  assert.equal(event.trip.origin, 'ORD');
  assert.equal(event.trip.destination, 'EGE');
  assert.equal(event.trip.departureDateTime, '2027-01-22T08:44:00');
  assert.equal(event.trip.arrivalDateTime, '2027-01-22T10:55:00');
  assert.equal(event.trip.durationMinutes, 191);
  assert.equal(event.trip.cabin, Cabin.Economy);
  assert.equal(event.trip.purchaseType, PurchaseType.Points);
  assert.equal(event.trip.paidPoints, 15000);
  assert.equal(event.trip.taxesAndFeesUsd, undefined);
  assert.deepEqual(event.trip.foreignTaxesAndFees, { amount: 46.7, currency: 'CAD' });
  assert.deepEqual(event.trip.passengerNames, ['Joshua Daniel Sprenger']);
});

test('parseAirCanadaEmail retains an operated-by partner flight number', () => {
  const event = parseAirCanadaEmail(message());
  assert.ok(event?.trip);
  assert.equal(event.trip.segments?.[0]?.flightNumber, 'UA 2663');
  assert.equal(event.trip.legs, undefined);
});

// Real multi-passenger Aeroplan confirmation body shape (OGG→ORD, overnight,
// 3 travelers). Unlike the single-passenger fixture above, every field sits on
// its OWN line (no combined "ORD ... EGE" / "08:44 10:55" lines), the arrival
// is next-day via a standalone "+1"/"day" pair, the flight number has no
// trailing bullet, and each traveler's name is sandwiched between a "P<n>"
// index marker and a repeated PASSENGER_NAME_START/END wrapper the template
// inserts (one such block per traveler, each with its own "Seats" line).
const MULTI_PASSENGER_CONFIRMATION = `
Booking Confirmation
BIDSWT BOOKING_REFERENCE_END
BOOKING_DATE_START
14 Sep, 2026 BOOKING_DATE_END Issued
Flights
Departure • Tue 12 Jan, 2027
Economy - Standard Reward
Kahului / Maui
OGG
Chicago
ORD
17:05
05:03
+1
day
Kahului Airport
O'Hare International Airport, Terminal 1
UA203
• Operated by
United Airlines
Aircraft type: Boeing 787-10
Duration: 7hr 58m
Cabin: Economy (X)
United Airlines
booking reference:
DSPJ1F
Passengers
Amy United States Sprenger P0 PASSENGER_NAME_START Amy United States Sprenger PASSENGER_NAME_END
Ticket #: 0142336807430
Aeroplan #: 974154429
Seats
OGG ➞ ORD
-
Emily Jean Sprenger P1 PASSENGER_NAME_START Emily Jean Sprenger PASSENGER_NAME_END
Ticket #: 0142336807431
Seats
OGG ➞ ORD
-
Joshua Daniel Sprenger P2 PASSENGER_NAME_START Joshua Daniel Sprenger PASSENGER_NAME_END
Ticket #: 0142336807432
Seats
OGG ➞ ORD
-
Purchase Summary
Aeroplan
•••• 4429
75,000
pts
•••• 4518
CAD $188.70
Grand total
75,000 pts + CAD $188.70
Amy United States Sprenger
25,000 pts + CAD $62.90
Emily Jean Sprenger
25,000 pts + CAD $62.90
Joshua Daniel Sprenger
25,000 pts + CAD $62.90
`;

test('parseAirCanadaEmail parses a multi-passenger Aeroplan confirmation with one field per line', () => {
  const event = parseAirCanadaEmail(
    message({
      subject: 'Air Canada - 12 Jan 2027: Kahului / Maui - Chicago (Booking reference: BIDSWT)',
      body: MULTI_PASSENGER_CONFIRMATION,
    }),
  );
  assert.ok(event?.trip, 'expected a parsed trip');
  const trip = event.trip;
  assert.equal(event.confirmationNumber, 'BIDSWT');
  assert.equal(trip.origin, 'OGG');
  assert.equal(trip.destination, 'ORD');
  assert.equal(trip.departureDateTime, '2027-01-12T17:05:00');
  // Overnight arrival: the standalone "+1"/"day" pair rolls the date forward.
  assert.equal(trip.arrivalDateTime, '2027-01-13T05:03:00');
  assert.equal(trip.durationMinutes, 478);
  assert.equal(trip.segments?.[0]?.flightNumber, 'UA 203');
  assert.deepEqual(trip.passengerNames, [
    'Amy United States Sprenger',
    'Emily Jean Sprenger',
    'Joshua Daniel Sprenger',
  ]);
  // "Grand total" covers all 3 travelers (75,000 pts + CAD $188.70); each
  // tracked flight is for ONE traveler, so the trip carries the per-passenger
  // share — verified against the email's own per-passenger breakdown.
  assert.equal(trip.purchaseType, PurchaseType.Points);
  assert.equal(trip.paidPoints, 25000);
  assert.deepEqual(trip.foreignTaxesAndFees, { amount: 62.9, currency: 'CAD' });
});
