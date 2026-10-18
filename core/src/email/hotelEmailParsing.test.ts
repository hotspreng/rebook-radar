import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hotelStayKey } from '../models/HotelStay.js';
import {
  foldHotelEmails,
  hotelProviderFor,
  parseHotelEmail,
  unwrapForwarded,
  type EmailMessage,
} from './index.js';

function msg(partial: Partial<EmailMessage>): EmailMessage {
  return {
    id: 'h1',
    internalDate: Date.parse('2026-10-17T05:52:00Z'),
    subject: '',
    from: '',
    body: '',
    ...partial,
  };
}

// Bodies follow the real confirmation layouts (labels, order, wrapping) with
// made-up travelers, numbers and loyalty details.

const MARRIOTT = msg({
  id: 'mar1',
  subject:
    'Reservation Confirmation #2AB345CDEF for Fairfield by Marriott Inn & Suites New York Manhattan/Central Park',
  from: 'Marriott Bonvoy Reservations <reservations@res-marriott.com>',
  body: `
Fairfield by Marriott Inn & Suites New York
Manhattan/Central Park
538 West 58th Street New York, New York 10019 USA
 +1-212-757-8550
You’re ready to go.
Titanium Elite →        100,000 Points
Thank you for booking with us,
Jane Traveler.
We can't wait to host you.

CHECK-IN
Thu, Nov 19, 2026
03:00 PM
CHECK-OUT
Fri, Nov 20, 2026
11:00 AM
Manage Stay
Summary Of Charges
Room 1 Confirmation Number: 2AB345CDEF
2 Double Beds
Guests per room: 2 Adults
FNA Top-Off Award 20,000 Points
Total Points Redeemed 20,000 Points
Rate Details & Cancellation Policy
• FREE cancellation until 05:59 PM hotel time on Mon, 16 Nov, 2026.
Learn more about check-in on the go.
`,
});

const HILTON_BODY = `
Hello JANE, View Account ➞
See you soon, JANE TRAVELER
Your reservation for Jun-08-2026 has been confirmed.
Confirmation #3448000001

Thorvaldsenstraeti 2-6
Reykjavik 101 IS
Maps & Directions>>
+3545133000
Iceland Parliament Hotel, Curio Collection by Hilton
 Monday 
 Jun  08
Check In:   3:00 PM 
 3
Nights
 Thursday 
 Jun  11
Check Out:  11:00 AM 
Your Room Information
Guest Name: JANE TRAVELER
Guests: 1 Adult
Rooms: 1
Room Plan: KING ACCESSIBLE CLASSIC
RM
Your Rate Information STANDARD ROOM REWARD
08-Jun-2026 - 11-Jun-2026 90,000 Points per Night
Total price for Stay 270,000 Points
`;

const HILTON = msg({
  id: 'hil1',
  internalDate: Date.parse('2026-04-01T05:02:00Z'),
  subject: 'Your Jun-08-2026 Confirmation #3448000001',
  from: 'Curio Collection by Hilton Confirmed <noreply@h6.hilton.com>',
  body: HILTON_BODY,
});

const HILTON_FORWARD = msg({
  id: 'hil2',
  internalDate: Date.parse('2026-05-05T15:39:00Z'),
  subject: 'Fwd: Your Jun-08-2026 Confirmation #3448000001',
  from: 'Pat Relative <pat@example.com>',
  body: `Thanks,
.
Pat Relative
---------- Forwarded message ---------
From: Curio Collection by Hilton Confirmed <noreply@h6.hilton.com>
Date: Wed, Apr 1, 2026 at 12:02 AM
Subject: Your Jun-08-2026 Confirmation #3448000001
To: <pat@example.com>
${HILTON_BODY}`,
});

const FRANKFURTFLYER = msg({
  id: 'ff1',
  internalDate: Date.parse('2025-05-25T02:05:00Z'),
  subject: 'Your booking with Frankfurtflyer - Conrad Hong Kong in Hong Kong, China',
  from: 'Frankfurtflyer <hotels@cube-travel.de>',
  body: `
Hello Jane Traveler,
thank you for your booking with FRANKFURTFLYER.
Your travel dates:
Conrad Hong Kong in Hong Kong, China
2025/06/27 - 2025/06/30 (3 nights)
1 Room, 2 Adults
Best regards
Your Frankfurtflyer Hotel Team
`,
  attachments: [{ filename: 'Itinerary_Traveler_2025-06-27_Hong_Kong_KABCDE.pdf', mimeType: 'application/pdf' }],
});

const AMEX = msg({
  id: 'amex1',
  internalDate: Date.parse('2025-12-31T18:52:00Z'),
  subject: 'Confirmed: your trip to Reykjavik',
  from: 'American Express <AmericanExpress@welcome.americanexpress.com>',
  body: `
Here are the details
JANE Q TRAVELER
Account Ending: 1004
Your trip #ZO-AX1023-00001 is confirmed
Thank you for booking through American Express Travel.
Manage My Trips

Trip to Reykjavik
Jun 10, 2026 - Jun 11, 2026
Wednesday, June 10, 2026
The Edition Reykjavik
The Edition Reykjavik
 
AUSTURBAKKI 2
Reykjavik
Iceland, 101
+354-5820000
Hotel Confirmation #: 9070000000001
Check-in:
Wednesday, June 10, 2026
03:00 PM
Check-out:
Thursday, June 11, 2026
11:00 AM
Number of Nights: 1
Room 1
Guest Name: Jane Traveler
Number of Guests: 2
Room Type: Room, 1 King Bed, Courtyard View
12pm check-in
Start your day sooner with 12pm check-in, when available
Cost: $553.64
`,
});

test('hotelProviderFor recognizes each program by sender address', () => {
  assert.equal(hotelProviderFor('Marriott Bonvoy Reservations <reservations@res-marriott.com>'), 'marriott');
  assert.equal(hotelProviderFor('Curio Collection by Hilton Confirmed <noreply@h6.hilton.com>'), 'hilton');
  assert.equal(hotelProviderFor('Frankfurtflyer <hotels@cube-travel.de>'), 'frankfurtflyer');
  assert.equal(hotelProviderFor('x@frankfurtflyer.de'), 'frankfurtflyer');
  assert.equal(hotelProviderFor('American Express <AmericanExpress@welcome.americanexpress.com>'), 'amex');
  assert.equal(hotelProviderFor('no-reply@info.email.aa.com'), undefined);
  assert.equal(hotelProviderFor(undefined), undefined);
});

test('Marriott: parses stay, address, dates, guests and confirmation', () => {
  const [event] = parseHotelEmail(MARRIOTT);
  assert.equal(event?.type, 'booked');
  const stay = event!.stay!;
  assert.equal(stay.provider, 'marriott');
  assert.equal(stay.hotelName, 'Fairfield by Marriott Inn & Suites New York Manhattan/Central Park');
  assert.equal(stay.address, '538 West 58th Street New York, New York 10019 USA');
  assert.equal(stay.phone, '+1-212-757-8550');
  assert.equal(stay.checkIn, '2026-11-19T15:00:00');
  assert.equal(stay.checkOut, '2026-11-20T11:00:00');
  assert.equal(stay.nights, 1);
  assert.equal(stay.confirmationNumber, '2AB345CDEF');
  assert.deepEqual(stay.guestNames, ['Jane Traveler']);
  assert.equal(stay.guests, 2);
  assert.equal(stay.roomType, '2 Double Beds');
});

test('Hilton: reads the year from the rate dates and splits name from address', () => {
  const [event] = parseHotelEmail(HILTON);
  const stay = event!.stay!;
  assert.equal(stay.provider, 'hilton');
  assert.equal(stay.hotelName, 'Iceland Parliament Hotel, Curio Collection by Hilton');
  assert.equal(stay.address, 'Thorvaldsenstraeti 2-6, Reykjavik 101 IS');
  assert.equal(stay.phone, '+3545133000');
  assert.equal(stay.checkIn, '2026-06-08T15:00:00');
  assert.equal(stay.checkOut, '2026-06-11T11:00:00');
  assert.equal(stay.nights, 3);
  assert.equal(stay.confirmationNumber, '3448000001');
  assert.deepEqual(stay.guestNames, ['Jane Traveler']);
  assert.equal(stay.guests, 1);
  assert.equal(stay.rooms, 1);
  assert.equal(stay.roomType, 'King Accessible Classic Room');
});

test('Hilton: falls back to the subject year when there is no rate line', () => {
  const body = HILTON_BODY.replace(/08-Jun-2026 - 11-Jun-2026 90,000 Points per Night/, '');
  const [event] = parseHotelEmail({ ...HILTON, body });
  assert.equal(event!.stay!.checkIn, '2026-06-08T15:00:00');
  assert.equal(event!.stay!.checkOut, '2026-06-11T11:00:00');
});

test('a forwarded confirmation is parsed as the original email', () => {
  const unwrapped = unwrapForwarded(HILTON_FORWARD);
  assert.equal(unwrapped.from, 'Curio Collection by Hilton Confirmed <noreply@h6.hilton.com>');
  assert.equal(unwrapped.subject, 'Your Jun-08-2026 Confirmation #3448000001');
  assert.equal(unwrapped.internalDate, Date.parse('Apr 1, 2026 12:02 AM'));

  const [event] = parseHotelEmail(HILTON_FORWARD);
  assert.equal(event!.stay!.confirmationNumber, '3448000001');
  assert.equal(event!.stay!.hotelName, 'Iceland Parliament Hotel, Curio Collection by Hilton');
  assert.equal(event!.emailId, 'hil2');
});

test('a message that is not a forward is returned unchanged', () => {
  assert.equal(unwrapForwarded(MARRIOTT), MARRIOTT);
});

test('Frankfurtflyer: hotel, dates and the booking reference from the attachment name', () => {
  const [event] = parseHotelEmail(FRANKFURTFLYER);
  const stay = event!.stay!;
  assert.equal(stay.provider, 'frankfurtflyer');
  assert.equal(stay.hotelName, 'Conrad Hong Kong');
  assert.equal(stay.address, 'Hong Kong, China');
  assert.equal(stay.checkIn, '2025-06-27');
  assert.equal(stay.checkOut, '2025-06-30');
  assert.equal(stay.nights, 3);
  assert.equal(stay.guests, 2);
  assert.equal(stay.rooms, 1);
  assert.equal(stay.bookingReference, 'KABCDE');
  assert.equal(stay.confirmationNumber, undefined);
  assert.deepEqual(stay.guestNames, ['Jane Traveler']);
});

test('Frankfurtflyer: still imports without the attachment, keyed by hotel and date', () => {
  const [event] = parseHotelEmail({ ...FRANKFURTFLYER, attachments: undefined });
  assert.equal(event!.stay!.bookingReference, undefined);
  assert.equal(hotelStayKey(event!.stay!), 'frankfurtflyer|CONRAD HONG KONG@2025-06-27');
});

test('AMEX Travel: parses the hotel block with trip number and hotel confirmation', () => {
  const [event] = parseHotelEmail(AMEX);
  const stay = event!.stay!;
  assert.equal(stay.provider, 'amex');
  assert.equal(stay.hotelName, 'The Edition Reykjavik');
  assert.equal(stay.address, 'Austurbakki 2, Reykjavik, Iceland, 101');
  assert.equal(stay.phone, '+354-5820000');
  assert.equal(stay.checkIn, '2026-06-10T15:00:00');
  assert.equal(stay.checkOut, '2026-06-11T11:00:00');
  assert.equal(stay.nights, 1);
  assert.equal(stay.confirmationNumber, '9070000000001');
  assert.equal(stay.bookingReference, 'ZO-AX1023-00001');
  assert.deepEqual(stay.guestNames, ['Jane Traveler']);
  assert.equal(stay.guests, 2);
  assert.equal(stay.rooms, 1);
  assert.equal(stay.roomType, 'Room, 1 King Bed, Courtyard View');
});

test('AMEX Travel: a trip with no hotel (flights only) yields nothing', () => {
  const body = 'Your trip #ZO-AX1023-00002 is confirmed\nFlight AA 100\nORD to LAX';
  assert.deepEqual(parseHotelEmail({ ...AMEX, body }), []);
});

test('marketing mail from a hotel sender yields nothing', () => {
  const promo = msg({
    subject: 'Earn double points this summer',
    from: 'Marriott Bonvoy <offers@email-marriott.com>',
    body: 'Book now and earn.\nCheck-in on the go with the app.',
  });
  assert.deepEqual(parseHotelEmail(promo), []);
});

test('mail from other senders is ignored', () => {
  assert.deepEqual(parseHotelEmail(msg({ from: 'a@b.com', subject: 'Hi', body: MARRIOTT.body })), []);
});

test('fold: the original and its forward are one reservation', () => {
  const result = foldHotelEmails([HILTON, HILTON_FORWARD, MARRIOTT, FRANKFURTFLYER, AMEX]);
  assert.equal(result.stays.length, 4);
  assert.equal(result.cancellations.length, 0);
  assert.deepEqual(
    result.stays.map((s) => s.provider).sort(),
    ['amex', 'frankfurtflyer', 'hilton', 'marriott'],
  );
});

test('fold: a later confirmation replaces an earlier one (modification)', () => {
  const changed = {
    ...MARRIOTT,
    id: 'mar2',
    internalDate: MARRIOTT.internalDate + 86_400_000,
    body: MARRIOTT.body.replace('Fri, Nov 20, 2026', 'Sat, Nov 21, 2026'),
  };
  const { stays } = foldHotelEmails([changed, MARRIOTT]);
  assert.equal(stays.length, 1);
  assert.equal(stays[0]!.checkOut, '2026-11-21T11:00:00');
  assert.equal(stays[0]!.nights, 2);
});

test('fold: a cancellation removes the reservation and is reported', () => {
  const cancel = msg({
    id: 'mar3',
    internalDate: MARRIOTT.internalDate + 86_400_000,
    subject: 'Reservation Cancellation #ZZ9YY8XX7W for Fairfield by Marriott',
    from: 'Marriott Bonvoy Reservations <reservations@res-marriott.com>',
    body: 'Your reservation is cancelled.\nCANCELLATION NUMBER:\nZZ9YY8XX7W\nCONFIRMATION NUMBER:\n2AB345CDEF\nCHECK-IN\nThu, Nov 19, 2026\nCHECK-OUT\nFri, Nov 20, 2026',
  });
  const result = foldHotelEmails([MARRIOTT, cancel]);
  assert.equal(result.stays.length, 0);
  assert.equal(result.cancellations[0]?.confirmationNumber, '2AB345CDEF');
});

test('fold: a booking after a cancellation revives the reservation', () => {
  const cancel = msg({
    id: 'mar3',
    internalDate: MARRIOTT.internalDate + 86_400_000,
    subject: 'Reservation Cancellation #ZZ9YY8XX7W for Fairfield by Marriott',
    from: 'Marriott Bonvoy Reservations <reservations@res-marriott.com>',
    body: 'Your reservation is cancelled.\nCANCELLATION NUMBER:\nZZ9YY8XX7W\nCONFIRMATION NUMBER:\n2AB345CDEF',
  });
  const rebooked = { ...MARRIOTT, id: 'mar4', internalDate: MARRIOTT.internalDate + 2 * 86_400_000 };
  assert.equal(foldHotelEmails([MARRIOTT, cancel, rebooked]).stays.length, 1);
});

test('fold: an AMEX cancellation matches by trip number', () => {
  const cancel = msg({
    id: 'amex2',
    internalDate: AMEX.internalDate + 86_400_000,
    subject: 'Cancelled: your trip to Reykjavik',
    from: 'American Express <AmericanExpress@welcome.americanexpress.com>',
    body: 'Your trip #ZO-AX1023-00001 has been cancelled.',
  });
  const result = foldHotelEmails([AMEX, cancel]);
  assert.equal(result.stays.length, 0);
  assert.equal(result.cancellations[0]?.bookingReference, 'ZO-AX1023-00001');
});

test('a cancellation email with no identifiers is ignored', () => {
  const promo = msg({
    subject: 'Free cancellation on your next stay',
    from: 'Hilton <hiltonhonors@e.hilton.com>',
    body: 'Book direct.',
  });
  assert.deepEqual(parseHotelEmail(promo), []);
});

// Real cancellation layouts, with made-up travelers and numbers.

const MARRIOTT_CANCEL = msg({
  id: 'mar-cx',
  internalDate: Date.parse('2026-10-13T17:14:00Z'),
  subject: 'Reservation Cancellation #11A2B3C4D5 for Courtyard by Marriott Binghamton',
  from: 'Courtyard By Marriott Reservations <reservations@res-marriott.com>',
  body: `
Courtyard by Marriott Binghamton
3801 Vestal Parkway East Vestal, New York 13850
USA
+1-607-644-1000
Greetings, Jane Traveler.
Your reservation is cancelled.
CANCELLATION NUMBER:
11A2B3C4D5
CONFIRMATION NUMBER:
99XYZ8WV7U
CHECK-IN
Fri, Oct 23, 2026
CHECK-OUT
Sat, Oct 24, 2026
Explore Now. Travel Whenever.
`,
});

const MARRIOTT_BINGHAMTON = msg({
  id: 'mar-bk',
  internalDate: Date.parse('2026-10-01T12:00:00Z'),
  subject: 'Reservation Confirmation #99XYZ8WV7U for Courtyard by Marriott Binghamton',
  from: 'Courtyard By Marriott Reservations <reservations@res-marriott.com>',
  body: `
Courtyard by Marriott Binghamton
3801 Vestal Parkway East Vestal, New York 13850
USA
+1-607-644-1000
Thank you for booking with us,
Jane Traveler.
CHECK-IN
Fri, Oct 23, 2026
03:00 PM
CHECK-OUT
Sat, Oct 24, 2026
11:00 AM
Room 1 Confirmation Number: 99XYZ8WV7U
1 King Bed
Guests per room: 1 Adult
`,
});

test('Marriott cancellation: the reservation number is the CONFIRMATION number, not the subject', () => {
  const [event] = parseHotelEmail(MARRIOTT_CANCEL);
  assert.equal(event?.type, 'cancelled');
  assert.equal(event!.confirmationNumber, '99XYZ8WV7U');
  assert.equal(event!.stay?.hotelName, 'Courtyard by Marriott Binghamton');
  assert.equal(event!.stay?.checkIn, '2026-10-23');
});

test('fold: a Marriott cancellation removes the stay it names', () => {
  const result = foldHotelEmails([MARRIOTT_BINGHAMTON, MARRIOTT, MARRIOTT_CANCEL]);
  assert.deepEqual(result.stays.map((s) => s.confirmationNumber), ['2AB345CDEF']);
  assert.equal(result.cancellations[0]?.confirmationNumber, '99XYZ8WV7U');
});

const FF_HEADER = {
  from: 'Frankfurtflyer <hotels@cube-travel.de>',
};

const FF_CANCEL = msg({
  ...FF_HEADER,
  id: 'ff-cx',
  internalDate: Date.parse('2025-05-25T02:07:00Z'),
  subject: 'Cancellation confirmation on Frankfurtflyer | Ref: VEKCDI',
  body: `
Hello Jane Traveler,
Your booking for the Conrad Hong Kong from 2025/06/27 to 2025/06/29 was successfully cancelled.
Cancellation number: HHL CN HKG 27JUN /CX-1707254406, HHL CN RESERVATION CANCELED-NEXT TI
Best regards
`,
});

const FF_FIRST_BOOKING = {
  ...FRANKFURTFLYER,
  id: 'ff0',
  internalDate: Date.parse('2025-05-25T02:03:00Z'),
  body: FRANKFURTFLYER.body.replace('2025/06/30 (3 nights)', '2025/06/29 (2 nights)'),
  attachments: [{ filename: 'Itinerary_Traveler_2025-06-27_Hong_Kong_VEKCDI.pdf' }],
};

test('Frankfurtflyer cancellation: identified by the Ref in the subject, with the cancelled dates', () => {
  const [event] = parseHotelEmail(FF_CANCEL);
  assert.equal(event?.type, 'cancelled');
  assert.equal(event!.bookingReference, 'VEKCDI');
  assert.equal(event!.stay?.hotelName, 'Conrad Hong Kong');
  assert.equal(event!.stay?.checkIn, '2025-06-27');
  assert.equal(event!.stay?.checkOut, '2025-06-29');
});

test('fold: cancelling one Frankfurtflyer booking leaves the re-booked one for the same hotel', () => {
  const result = foldHotelEmails([FF_FIRST_BOOKING, FRANKFURTFLYER, FF_CANCEL]);
  assert.deepEqual(result.stays.map((s) => s.bookingReference), ['KABCDE']);
});

test('a cancellation naming a booking falls back to hotel and date for a stay with no reference', () => {
  const noRef = parseHotelEmail({ ...FRANKFURTFLYER, attachments: undefined })[0]!.stay!;
  const cancel = parseHotelEmail({
    ...FF_CANCEL,
    body: FF_CANCEL.body.replace('2025/06/29', '2025/06/30'),
  })[0]!;
  const result = foldHotelEmails([{ ...FRANKFURTFLYER, attachments: undefined }, { ...FF_CANCEL, body: FF_CANCEL.body.replace('2025/06/29', '2025/06/30') }]);
  assert.equal(noRef.bookingReference, undefined);
  assert.equal(cancel.bookingReference, 'VEKCDI');
  assert.equal(result.stays.length, 0);
});

const AMEX_CANCEL = msg({
  id: 'amex-cx',
  internalDate: Date.parse('2025-06-14T23:05:00Z'),
  subject: 'Cancellation: your trip to Beijing',
  from: 'American Express <AmericanExpress@welcome.americanexpress.com>',
  body: `
Here are your cancellation details
JANE Q TRAVELER
Your trip #7011-5369 has been cancelled
Your trip has been successfully cancelled.
Trip to Beijing
Jun 25, 2025 - Jun 27, 2025
Wednesday, June 25, 2025
The Ritz-carlton, Beijing
The Ritz-carlton, Beijing

83A Jianguo Road
Beijing
Beijing, China, 100025
+86 1059088888
Hotel Confirmation #: 9060000000001
Check-in:
Wednesday, June 25, 2025
Check-out:
Friday, June 27, 2025
Number of Nights: 2
Room 1
Guest Name: Jane Traveler
Number of Guests: 3
Room Type: Deluxe Room, 2 Double Beds, Non
Smoking
Cancellation Policy:
There is no charge for cancellations made before 23:59 on June 24, 2025.
Room 2
Guest Name: Jane Traveler
Number of Guests: 2
Room Type: Deluxe Room, 2 Double Beds, Non
Smoking
`,
});

const AMEX_BEIJING = msg({
  ...AMEX_CANCEL,
  id: 'amex-bk',
  internalDate: Date.parse('2025-05-01T12:00:00Z'),
  subject: 'Confirmed: your trip to Beijing',
  body: AMEX_CANCEL.body.replace('has been cancelled', 'is confirmed'),
});

test('AMEX cancellation: trip number and the hotel confirmation are both captured', () => {
  const [event] = parseHotelEmail(AMEX_CANCEL);
  assert.equal(event?.type, 'cancelled');
  assert.equal(event!.bookingReference, '7011-5369');
  assert.equal(event!.confirmationNumber, '9060000000001');
  assert.equal(event!.stay?.checkIn, '2025-06-25');
});

test('AMEX booking without check-in times keeps dates only and counts every room', () => {
  const [event] = parseHotelEmail(AMEX_BEIJING);
  const stay = event!.stay!;
  assert.equal(stay.checkIn, '2025-06-25');
  assert.equal(stay.checkOut, '2025-06-27');
  assert.equal(stay.rooms, 2);
  assert.equal(stay.guests, 5);
  assert.equal(stay.address, '83A Jianguo Road, Beijing, Beijing, China, 100025');
});

test('fold: an AMEX trip cancellation removes the stay booked under that trip', () => {
  const result = foldHotelEmails([AMEX_BEIJING, AMEX, AMEX_CANCEL]);
  assert.deepEqual(result.stays.map((s) => s.bookingReference), ['ZO-AX1023-00001']);
});
