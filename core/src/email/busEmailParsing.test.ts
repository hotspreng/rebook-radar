import { test } from 'node:test';
import assert from 'node:assert/strict';
import { busAirportDirection, busRideKey } from '../models/BusRide.js';
import { busProviderFor, foldBusEmails, parseBusEmail, type EmailMessage } from './index.js';

function msg(partial: Partial<EmailMessage>): EmailMessage {
  return {
    id: 'b1',
    internalDate: Date.parse('2026-09-12T21:09:00Z'),
    subject: '',
    from: '',
    body: '',
    ...partial,
  };
}

// Bodies follow the real ticket layout with made-up travelers and codes.

const TICKET = msg({
  id: 'bus1',
  subject: 'This is your Ticket and Receipt',
  from: 'mailadmin@ourbus.com <mailadmin@ourbus.com>',
  body: `
Ticket Reference Code
ABCD12
Same great Service,
even better Experience!
DATE OF TRAVEL Fri, Oct 9, 2026
PASSENGER DETAILS
1 Jane Traveler
+1 5551234567
Primary Passenger
Ithaca, NY 02:15 PM
Motor Coach
Campus Road behind Example Hall
Please arrive 15 min prior to stop location for boarding.
Stop Details Directions to Stop
Syracuse Airport, NY 03:45 PM
SYR Airport Terminal A - from within the airport, follow signs
to Ground Transportation, then to the Taxi queue South
which is outside Terminal A
Stop Details
General Information
Your ride will be a Motor Coach
The transportation is provided by Field Trips Example Inc.
Need more space? Explore Add-ons
Purchase Receipt
Ticket Price (1 * $38.00)
Paid Amount $ 30.95
Purchased by Jane Traveler
`,
});

const UPDATE = msg({
  id: 'bus2',
  internalDate: Date.parse('2026-10-11T20:13:00Z'),
  subject: 'OurBus | Important Trip Update - Operator Change',
  from: 'mailadmin@ourbus.com <mailadmin@ourbus.com>',
  body: `
Hi Jane Traveler,
Please note, that there's been a change in the bus operator from First Coach Inc to Second Tours Inc for your upcoming trip due to operational reasons.
Regards,
Team Rally OurBus
Ticket Reference Code
WXYZ34
DATE OF TRAVEL Tue, Oct 13, 2026
PASSENGER DETAILS
1
Jane Traveler
+1 5551234567
Primary Passenger
2
John Traveler
Primary Passenger
Rochester, NY
05:00 PM
Motor Coach
Example Regional Airport, arrivals/lower level.
The bus will stop on the outer roadway in the Shuttles area.
Please arrive 15 min prior to stop location for boarding.
Stop Details
Directions to Stop
Ithaca, NY
07:30 PM
Downtown Ithaca - E. Seneca Street in front of the deli
(Note if arriving by car, use 118 E. Seneca Street for directions)
Stop Details
General Information
Your ride will be a Motor Coach
Transportation provided by First Coach Inc
The transportation is provided by Second Tours Inc
`,
});

test('busProviderFor recognises OurBus and Rally senders', () => {
  assert.equal(busProviderFor('mailadmin@ourbus.com <mailadmin@ourbus.com>'), 'ourbus');
  assert.equal(busProviderFor('Rally <hello@rally.co>'), 'ourbus');
  assert.equal(busProviderFor('someone@gmail.com'), undefined);
});

test('parses an OurBus ticket', () => {
  const [event] = parseBusEmail(TICKET);
  assert.equal(event!.type, 'booked');
  const ride = event!.ride!;
  assert.equal(ride.ticketReference, 'ABCD12');
  assert.equal(ride.departureAt, '2026-10-09T14:15:00');
  assert.equal(ride.arrivalAt, '2026-10-09T15:45:00');
  assert.equal(ride.departureCity, 'Ithaca, NY');
  assert.equal(ride.departureStop, 'Campus Road behind Example Hall');
  assert.equal(ride.arrivalCity, 'Syracuse Airport, NY');
  assert.equal(
    ride.arrivalStop,
    'SYR Airport Terminal A - from within the airport, follow signs to Ground Transportation, then to the Taxi queue South which is outside Terminal A',
  );
  assert.equal(ride.vehicle, 'Motor Coach');
  assert.equal(ride.operator, 'Field Trips Example Inc');
  assert.deepEqual(ride.passengerNames, ['Jane Traveler']);
  assert.equal(busAirportDirection(ride), 'to');
});

test('an operator-change update takes the new operator, reads time on its own line, and lists every passenger', () => {
  const ride = parseBusEmail(UPDATE)[0]!.ride!;
  assert.equal(ride.ticketReference, 'WXYZ34');
  assert.equal(ride.departureAt, '2026-10-13T17:00:00');
  assert.equal(ride.arrivalAt, '2026-10-13T19:30:00');
  assert.equal(ride.operator, 'Second Tours Inc');
  assert.deepEqual(ride.passengerNames, ['Jane Traveler', 'John Traveler']);
  assert.equal(busAirportDirection(ride), 'from');
});

test('a ride past midnight arrives the next day', () => {
  const late = msg({ ...TICKET, body: TICKET.body.replace('02:15 PM', '11:30 PM').replace('03:45 PM', '01:10 AM') });
  assert.equal(parseBusEmail(late)[0]!.ride!.arrivalAt, '2026-10-10T01:10:00');
});

test('a cancellation removes the ticket; a later update revives it', () => {
  const cancel = msg({
    id: 'bus3',
    internalDate: Date.parse('2026-10-05T12:00:00Z'),
    subject: 'Your ticket has been cancelled',
    from: TICKET.from,
    body: 'Ticket Reference Code\nABCD12\nYour ticket was cancelled.',
  });
  assert.equal(parseBusEmail(cancel)[0]!.type, 'cancelled');
  assert.deepEqual(foldBusEmails([TICKET, cancel]).rides, []);
  assert.deepEqual(foldBusEmails([TICKET, cancel]).cancellations, [{ provider: 'ourbus', ticketReference: 'ABCD12' }]);

  const folded = foldBusEmails([TICKET, UPDATE]);
  assert.deepEqual(folded.rides.map(busRideKey), ['ourbus|ABCD12', 'ourbus|WXYZ34']);
  const revived = foldBusEmails([cancel, { ...TICKET, internalDate: cancel.internalDate + 1000 }]);
  assert.equal(revived.rides.length, 1);
});

test('a re-sent ticket for the same reference replaces the earlier one', () => {
  const resent = msg({ ...UPDATE, id: 'bus9', internalDate: UPDATE.internalDate + 5000, body: UPDATE.body.replaceAll('Second Tours Inc', 'Third Tours Inc') });
  const folded = foldBusEmails([UPDATE, resent]);
  assert.equal(folded.rides.length, 1);
  assert.equal(folded.rides[0]!.operator, 'Third Tours Inc');
});

test('ignores marketing mail and other senders', () => {
  assert.deepEqual(parseBusEmail(msg({ from: 'mailadmin@ourbus.com', subject: 'Fall deals', body: 'Save 20%!' })), []);
  assert.deepEqual(parseBusEmail(msg({ from: 'a@gmail.com', subject: 'x', body: TICKET.body })), []);
});

test('unwraps a forwarded ticket', () => {
  const forwarded = msg({
    id: 'fwd',
    from: 'Relative <rel@example.com>',
    subject: `Fwd: ${TICKET.subject}`,
    body: `FYI\n\n---------- Forwarded message ---------\nFrom: ${TICKET.from}\nDate: Sat, Sep 12, 2026 at 5:09 PM\nSubject: ${TICKET.subject}\nTo: me@example.com\n\n${TICKET.body}`,
  });
  assert.equal(parseBusEmail(forwarded)[0]!.ride!.ticketReference, 'ABCD12');
});
