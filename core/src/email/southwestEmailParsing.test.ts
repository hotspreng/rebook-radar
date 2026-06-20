import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyEmail,
  isSouthwestEmail,
  parseConfirmationNumber,
  parseSouthwestEmail,
  TripEventType,
} from './index.js';
import type { EmailMessage } from './index.js';

function msg(partial: Partial<EmailMessage>): EmailMessage {
  return {
    id: 'm1',
    internalDate: Date.parse('2026-01-01T00:00:00Z'),
    subject: '',
    from: '"Southwest Airlines" <no-reply@iluv.southwest.com>',
    body: '',
    ...partial,
  };
}

test('isSouthwestEmail recognizes Southwest senders', () => {
  assert.equal(isSouthwestEmail('no-reply@iluv.southwest.com'), true);
  assert.equal(isSouthwestEmail('"SWA" <confirmation@luv.southwest.com>'), true);
  assert.equal(isSouthwestEmail('promos@united.com'), false);
});

test('parseConfirmationNumber reads labeled PNRs', () => {
  assert.equal(parseConfirmationNumber('Confirmation # ABC123'), 'ABC123');
  assert.equal(parseConfirmationNumber('CONFIRMATION NUMBER: a1b2c3'), 'A1B2C3');
  assert.equal(parseConfirmationNumber('no code here'), undefined);
});

test('classifyEmail prioritizes cancellation over booking', () => {
  assert.equal(
    classifyEmail('Your reservation has been cancelled', 'Confirmation # ABC123'),
    TripEventType.Cancelled,
  );
  assert.equal(
    classifyEmail('Schedule change to your flight', 'Confirmation ABC123'),
    TripEventType.Changed,
  );
  assert.equal(
    classifyEmail("You're going to Las Vegas!", 'Confirmation # ABC123'),
    TripEventType.Booked,
  );
});

test('parseSouthwestEmail returns a booked event with details', () => {
  const event = parseSouthwestEmail(
    msg({
      subject: "You're going to Las Vegas! Air Reservation Confirmation",
      body: [
        'Confirmation # ABC123',
        'Passenger(s):',
        'Jordan Spreng',
        'Chicago (Midway), IL (MDW) to Las Vegas, NV (LAS)',
        'Mon, Aug 14, 2026 9:35 AM',
        'Wanna Get Away',
        'Total $129.98',
        'Taxes and fees $16.40',
      ].join('\n'),
    }),
  );
  assert.ok(event);
  assert.equal(event.type, TripEventType.Booked);
  assert.equal(event.confirmationNumber, 'ABC123');
  assert.equal(event.trip?.origin, 'MDW');
  assert.equal(event.trip?.destination, 'LAS');
  assert.equal(event.trip?.paidCashUsd, 129.98);
  assert.deepEqual(event.trip?.passengerNames, ['Jordan Spreng']);
});

test('parseSouthwestEmail returns a cancellation without trip details', () => {
  const event = parseSouthwestEmail(
    msg({ subject: 'Your reservation has been cancelled', body: 'Confirmation # ABC123' }),
  );
  assert.ok(event);
  assert.equal(event.type, TripEventType.Cancelled);
  assert.equal(event.confirmationNumber, 'ABC123');
  assert.equal(event.trip, undefined);
});

test('parseSouthwestEmail ignores non-trip emails', () => {
  const event = parseSouthwestEmail(
    msg({ subject: 'Rapid Rewards statement', body: 'You have 50,000 points' }),
  );
  assert.equal(event, undefined);
});

// --- Real Southwest email formats (captured from live Gmail) ---------------

const REAL_BOOKING_BODY = [
  'October 10',
  'ROC',
  'MDW',
  'Rochester to Chicago (Midway)',
  'Confirmation # AAY5FX',
  'Confirmation date: 06/09/2026',
  'PASSENGER',
  'Emily Jean Sprenger',
  'RAPID REWARDS #',
  '608173440',
  'Your itinerary',
  'Saturday, 10/10/2026',
  'Est. Travel Time: 1h 50m',
  'Basic',
  'FLIGHT WN #1308',
  'DEPARTS',
  'ROC 05:10 PM',
  'Rochester',
  'ARRIVES',
  'MDW 06:00 PM',
  'Chicago (Midway)',
  'Payment information',
  'Total cost',
  'Base Fare $ 0.00',
  'U.S. 9/11 Security Fee $ 5.60',
  'Total $ 5.60',
  'You successfully redeemed 11,500 Rapid Rewards points for this trip.',
].join('\n');

test('parses a real Southwest booking email (subject PNR + body fields)', () => {
  const event = parseSouthwestEmail(
    msg({
      from: 'Southwest Airlines <southwestairlines@ifly.southwest.com>',
      subject: "You're going to Chicago (Midway) on 10/10 (AAY5FX)!",
      body: REAL_BOOKING_BODY,
    }),
  );
  assert.ok(event);
  assert.equal(event.type, TripEventType.Booked);
  assert.equal(event.confirmationNumber, 'AAY5FX');
  assert.equal(event.trip?.origin, 'ROC');
  assert.equal(event.trip?.destination, 'MDW');
  assert.deepEqual(event.trip?.passengerNames, ['Emily Jean Sprenger']);
  assert.equal(event.trip?.paidPoints, 11500);
  assert.equal(event.trip?.paidCashUsd, undefined);
  assert.equal(event.trip?.taxesAndFeesUsd, 5.6);
  assert.equal(event.trip?.fareType, 'wanna_get_away'); // "Basic" → Wanna Get Away
  assert.match(event.trip?.departureDateTime ?? '', /^2026-10-10T17:10/);  assert.match(event.trip?.arrivalDateTime ?? '', /^2026-10-10T18:00/);});

test('parses a real Southwest cancellation subject', () => {
  const event = parseSouthwestEmail(
    msg({
      from: 'Southwest Airlines <southwestairlines@ifly.southwest.com>',
      subject:
        "Emily Jean Sprenger's 11/29 Rochester trip (B4KA4V): This reservation has been canceled.",
      body: 'unrelated body text with a cancel-your-reservation footer',
    }),
  );
  assert.ok(event);
  assert.equal(event.type, TripEventType.Cancelled);
  assert.equal(event.confirmationNumber, 'B4KA4V');
  assert.equal(event.trip, undefined);
});

test('parses a real Southwest change-confirmed subject', () => {
  const event = parseSouthwestEmail(
    msg({
      from: 'Southwest Airlines <southwestairlines@ifly.southwest.com>',
      subject: "Emily Jean Sprenger's 04/02 Chicago (Midway) trip (CS68KD): Your change is confirmed.",
      body: REAL_BOOKING_BODY,
    }),
  );
  assert.ok(event);
  assert.equal(event.type, TripEventType.Changed);
  assert.equal(event.confirmationNumber, 'CS68KD');
  assert.deepEqual(event.trip?.passengerNames, ['Emily Jean Sprenger']);
});

test('parses an airline-initiated schedule-change subject (trailing PNR)', () => {
  const event = parseSouthwestEmail(
    msg({
      from: 'Southwest Airlines <southwestairlines@ifly.southwest.com>',
      subject: 'Southwest Airlines made a change to your 03/29 trip A9ZFRV',
      body: REAL_BOOKING_BODY,
    }),
  );
  assert.ok(event);
  assert.equal(event.type, TripEventType.Changed);
  assert.equal(event.confirmationNumber, 'A9ZFRV');
});

test('ignores Southwest marketing subjects (no phantom trips)', () => {
  for (const subject of [
    'Fares from $59 one-way — book now!',
    'Your June Rapid Rewards statement is ready',
    'Last chance: double points this weekend',
  ]) {
    assert.equal(parseSouthwestEmail(msg({ subject, body: 'Confirmation ABC123 cancel' })), undefined);
  }
});
const REAL_ROUND_TRIP_BODY = [
  'July 13',
  '- July 16',
  'MDW',
  'PDX',
  'Confirmation # CLWMNM',
  'Confirmation date: 04/27/2026',
  'PASSENGER',
  'Emily Jean Sprenger',
  'RAPID REWARDS #',
  '608173440',
  'Your itinerary',
  'Flight 1:',
  'Monday, 07/13/2026',
  'Est. Travel Time: 4h 20m',
  'Basic',
  'FLIGHT WN #2468',
  'DEPARTS',
  'MDW 10:05 AM',
  'Chicago (Midway)',
  'ARRIVES',
  'PDX 12:25 PM',
  'Portland, OR',
  'Flight 2:',
  'Thursday, 07/16/2026',
  'Est. Travel Time: 3h 55m',
  'Basic',
  'FLIGHT WN #1357',
  'DEPARTS',
  'PDX 11:50 AM',
  'Portland, OR',
  'ARRIVES',
  'MDW 05:45 PM',
  'Chicago (Midway)',
  'Payment information',
  'Total cost',
  'Total',
  '42,000 pts',
].join('\n');

test('parses a round trip into two legs sharing the confirmation number', () => {
  const event = parseSouthwestEmail(
    msg({
      from: 'Southwest Airlines <southwestairlines@ifly.southwest.com>',
      subject: "You're going to Portland, OR on 07/13 (CLWMNM)!",
      body: REAL_ROUND_TRIP_BODY,
    }),
  );
  assert.ok(event);
  assert.equal(event.type, TripEventType.Booked);
  assert.equal(event.confirmationNumber, 'CLWMNM');

  // Top-level mirrors the first (outbound) leg for backward compatibility.
  assert.equal(event.trip?.origin, 'MDW');
  assert.equal(event.trip?.destination, 'PDX');
  assert.match(event.trip?.departureDateTime ?? '', /^2026-07-13T10:05/);
  assert.match(event.trip?.arrivalDateTime ?? '', /^2026-07-13T12:25/);
  assert.equal(event.trip?.durationMinutes, 260);

  // Both legs are present.
  assert.equal(event.trip?.legs?.length, 2);
  const [outbound, ret] = event.trip!.legs!;
  assert.equal(outbound!.origin, 'MDW');
  assert.equal(outbound!.destination, 'PDX');
  assert.equal(outbound!.durationMinutes, 260);
  assert.equal(ret!.origin, 'PDX');
  assert.equal(ret!.destination, 'MDW');
  assert.match(ret!.departureDateTime, /^2026-07-16T11:50/);
  assert.match(ret!.arrivalDateTime ?? '', /^2026-07-16T17:45/);
  assert.equal(ret!.durationMinutes, 235);
});

// A round trip booked for TWO passengers. The "redeemed 84,000 points" line is
// the all-passengers total for the whole reservation; each tracked flight
// belongs to one traveler, so paidPoints must be the per-passenger share
// (84,000 / 2 = 42,000) — later split per direction into 21,000 each way.
const REAL_MULTI_PASSENGER_BODY = [
  'July 13',
  '- July 16',
  'MDW',
  'PDX',
  'Confirmation # CLWMNM',
  'Confirmation date: 04/27/2026',
  'You successfully redeemed 84,000 Rapid Rewards points for this trip.',
  'PASSENGER',
  'William Sprenger',
  'RAPID REWARDS #',
  '608173042',
  'PASSENGER',
  'Emily Sprenger',
  'RAPID REWARDS #',
  '608173440',
  'Your itinerary',
  'Flight 1:',
  'Monday, 07/13/2026',
  'Est. Travel Time: 4h 20m',
  'Basic',
  'FLIGHT WN #2468',
  'DEPARTS',
  'MDW 10:05 AM',
  'Chicago (Midway)',
  'ARRIVES',
  'PDX 12:25 PM',
  'Portland, OR',
  'Flight 2:',
  'Thursday, 07/16/2026',
  'Est. Travel Time: 3h 55m',
  'Basic',
  'FLIGHT WN #1357',
  'DEPARTS',
  'PDX 11:50 AM',
  'Portland, OR',
  'ARRIVES',
  'MDW 05:45 PM',
  'Chicago (Midway)',
  'Payment information',
  'Total cost',
  'U.S. 9/11 Security Fee $ 22.40',
  'Total $ 22.40',
].join('\n');

test('divides reservation totals by passenger count for a multi-passenger booking', () => {
  const event = parseSouthwestEmail(
    msg({
      from: 'Southwest Airlines <southwestairlines@ifly.southwest.com>',
      subject: "You're going to Portland, OR on 07/13 (CLWMNM)!",
      body: REAL_MULTI_PASSENGER_BODY,
    }),
  );
  assert.ok(event);
  assert.equal(event.confirmationNumber, 'CLWMNM');
  assert.deepEqual(event.trip?.passengerNames, ['William Sprenger', 'Emily Sprenger']);

  // 84,000 redeemed / 2 passengers = 42,000 per-passenger round trip.
  assert.equal(event.trip?.paidPoints, 42000);
  // Taxes ($22.40 for both passengers) likewise become the per-passenger share.
  assert.equal(event.trip?.taxesAndFeesUsd, 11.2);
  assert.equal(event.trip?.legs?.length, 2);
});

// A one-way booking with a connection (MDW → ATL → MSY), funded by flight
// credits + a LUV voucher. The final destination is MSY (last ARRIVES), not the
// ATL stopover, and the fare is Cash even though no card was charged.
const REAL_CONNECTING_PAID_BODY = [
  'November 5',
  'MDW',
  'MSY',
  'Chicago (Midway) to New Orleans',
  'Confirmation # BCVW8J',
  'Confirmation date: 06/17/2026',
  'PASSENGER',
  'Amy Sternig Sprenger',
  'RAPID REWARDS #',
  '132546330',
  'Your itinerary',
  'Flight:',
  'Thursday, 11/05/2026',
  'Est. Travel Time: 4h 20m',
  'Basic',
  'FLIGHT WN #2886',
  'DEPARTS',
  'MDW 01:00 PM',
  'Chicago (Midway)',
  'ARRIVES',
  'ATL 03:50 PM',
  'Atlanta',
  'Stop: Change planes',
  'FLIGHT WN #0833',
  'DEPARTS',
  'ATL 04:45 PM',
  'Atlanta',
  'ARRIVES',
  'MSY 05:20 PM',
  'New Orleans',
  'Payment information',
  'Total cost',
  'Air - BCVW8J',
  'Base Fare $ 120.93',
  'U.S. Transportation Tax $ 9.07',
  'U.S. 9/11 Security Fee $ 5.60',
  'U.S. Flight Segment Tax $ 10.60',
  'U.S. Passenger Facility Chg $ 9.00',
  'Total $ 155.20',
  'Payment',
  'June 17, 2026',
  'Payment Amount $19.01',
  'Flight Credit',
  'June 17, 2026',
  'Payment Amount $80.44',
  'Flight Credit',
  'June 17, 2026',
  'Payment Amount $55.75',
  'Southwest &reg; LUV &reg; Voucher',
].join('\n');

test('uses the final destination (not the stopover) for a connecting flight', () => {
  const event = parseSouthwestEmail(
    msg({
      from: 'Southwest Airlines <southwestairlines@ifly.southwest.com>',
      subject: "You're going to New Orleans on 11/05 (BCVW8J)!",
      body: REAL_CONNECTING_PAID_BODY,
    }),
  );
  assert.ok(event);
  assert.equal(event.confirmationNumber, 'BCVW8J');

  // Route is MDW → MSY, the final destination, not the ATL stopover.
  assert.equal(event.trip?.origin, 'MDW');
  assert.equal(event.trip?.destination, 'MSY');
  assert.match(event.trip?.departureDateTime ?? '', /^2026-11-05T13:00/);
  assert.match(event.trip?.arrivalDateTime ?? '', /^2026-11-05T17:20/);

  // Single direction → no `legs`, but the two operated segments are captured.
  assert.equal(event.trip?.legs, undefined);
  assert.equal(event.trip?.segments?.length, 2);
  const [a, b] = event.trip!.segments!;
  assert.equal(a!.origin, 'MDW');
  assert.equal(a!.destination, 'ATL');
  assert.equal(a!.flightNumber, 'WN 2886');
  assert.match(a!.departureDateTime, /^2026-11-05T13:00/);
  assert.match(a!.arrivalDateTime ?? '', /^2026-11-05T15:50/);
  assert.equal(b!.origin, 'ATL');
  assert.equal(b!.destination, 'MSY');
  assert.equal(b!.flightNumber, 'WN 0833');
  assert.match(b!.departureDateTime, /^2026-11-05T16:45/);
  assert.match(b!.arrivalDateTime ?? '', /^2026-11-05T17:20/);
});

test('classifies a fare paid with flight credits + voucher as Cash, not points', () => {
  const event = parseSouthwestEmail(
    msg({
      from: 'Southwest Airlines <southwestairlines@ifly.southwest.com>',
      subject: "You're going to New Orleans on 11/05 (BCVW8J)!",
      body: REAL_CONNECTING_PAID_BODY,
    }),
  );
  assert.ok(event);

  // Marketing/footer "points" prose must NOT make this a points booking.
  assert.equal(event.trip?.purchaseType, 'cash');
  assert.equal(event.trip?.paidPoints, undefined);
  assert.equal(event.trip?.paidCashUsd, 155.2);

  // The three funding methods are itemized and sum to the total.
  assert.equal(event.trip?.payments?.length, 3);
  const labels = event.trip!.payments!.map((p) => p.label);
  assert.deepEqual(labels, ['Flight Credit', 'Flight Credit', 'Southwest LUV Voucher']);
  const total = event.trip!.payments!.reduce((s, p) => s + (p.amountUsd ?? 0), 0);
  assert.equal(Math.round(total * 100) / 100, 155.2);
});