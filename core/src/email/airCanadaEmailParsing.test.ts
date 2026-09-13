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
