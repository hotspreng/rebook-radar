import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Airline } from '../models/common.js';
import { parseAirlineReceipt, type EmailMessage } from './index.js';

function message(body: string): EmailMessage {
  return {
    id: 'receipt-1',
    internalDate: Date.parse('2026-09-13T22:57:00Z'),
    subject: 'Your trip confirmation (ORD - DEN)',
    from: 'Josh Sprenger <josh.sprenger@gmail.com>',
    body,
  };
}

test('American award receipt becomes only its cash taxes expense', () => {
  const receipt = parseAirlineReceipt(
    message(`
American Airlines <no-reply@info.email.aa.com>
AA 4102
Confirmation code: HBLZAQ
Wednesday, October 14, 2026
ORD
Chicago O'Hare
6:40 AM
DEN
Denver
8:33 AM
Joshua Sprenger - AAdvantage #: 0U5****
New ticket 25,500 miles
Taxes & carrier-imposed fees $5.60
Total paid $5.60 + 25,500 miles
`),
  );

  assert.deepEqual(receipt, {
    airline: Airline.American,
    merchant: 'American Airlines',
    description: 'Airfare ORD to DEN',
    confirmationNumber: 'HBLZAQ',
    transactionDate: '2026-09-13',
    cashPaidUsd: 5.6,
    pointsRedeemed: 25_500,
    origin: 'ORD',
    destination: 'DEN',
  });
});

test('American cash receipt uses the reservation total rather than one passenger fare', () => {
  const receipt = parseAirlineReceipt(
    message(`
American Airlines <no-reply@info.email.aa.com>
AA 4102
Confirmation code: HBLZAQ
Wednesday, October 14, 2026
ORD
Chicago O'Hare
6:40 AM
DEN
Denver
8:33 AM
Joshua Sprenger - AAdvantage #: 0U5****
New ticket $238.16
Taxes & carrier-imposed fees $34.94
Amy Sprenger - AAdvantage #: 2M6****
New ticket $238.16
Taxes & carrier-imposed fees $34.94
Total paid $546.20
`),
  );

  assert.equal(receipt?.cashPaidUsd, 546.2);
  assert.equal(receipt?.pointsRedeemed, undefined);
});

test('United receipt includes airfare and Economy Plus purchases, not the last seat total', () => {
  const receipt = parseAirlineReceipt({
    ...message(`
United Airlines <Receipts@united.com>
Confirmation Number:
CQR0WX
Flight 1 of 2 UA1217 Class: United Economy (W)
Sun, Sep 27, 2026 Sun, Sep 27, 2026
07:00 AM 08:47 AM
Chicago, IL, US (ORD) Denver, CO, US (DEN)
Flight 2 of 2 UA1378 Class: United Economy (W)
Sun, Sep 27, 2026 Sun, Sep 27, 2026
11:41 AM 12:42 PM
Denver, CO, US (DEN) Vail/Eagle, CO, US (EGE)
Traveler Details
SPRENGER/JOSHUADANIEL
Purchase Summary
Airfare: 416.74
Total Per Passenger: 473.20 USD
Total: 473.20 USD
Additional Purchase Summary
Economy Plus Seat: 38.00
Total: 40.85 USD
Additional Purchase Summary
Economy Plus Seat: 88.00
Total: 94.60 USD
Fare Rules
REFUNDABLE
`),
    subject: 'eTicket Itinerary and Receipt for Confirmation CQR0WX',
    from: 'United Airlines <Receipts@united.com>',
  });

  assert.equal(receipt?.merchant, 'United');
  assert.equal(receipt?.cashPaidUsd, 608.65);
  assert.equal(receipt?.confirmationNumber, 'CQR0WX');
});