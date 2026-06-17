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
