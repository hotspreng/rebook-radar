import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rentalCarKey } from '../models/RentalCar.js';
import { foldRentalEmails, parseRentalEmail, rentalProviderFor, type EmailMessage } from './index.js';

function msg(partial: Partial<EmailMessage>): EmailMessage {
  return {
    id: 'r1',
    internalDate: Date.parse('2026-10-11T15:03:00Z'),
    subject: '',
    from: '',
    body: '',
    ...partial,
  };
}

// Bodies follow the real layouts (labels, order, wrapping) with made-up
// travelers and numbers.

const NATIONAL = msg({
  id: 'nat1',
  subject: 'Confirmed: National Car Rental Reservation at SPRINGFIELD INTL ARPT on October 23, 2026 (SPI)',
  from: 'National Car Reservations <reservations@nationalcar.com>',
  body: `
 Confirmation:
123456789
Your Reservation is Confirmed.
Thanks for choosing National. You reserved a Full Size vehicle on October 23, 2026
at SPRINGFIELD INTL ARPT.
Your confirmation number is: 123456789
Itinerary
PICK UP
SPRINGFIELD INTL ARPT (SPI) 
Fri, October 23, 2026
9:00 AM
100 MAIN ST- SPRING.
AIRPORT
Sun 7:00 AM-11:59 PM
Mon-Fri12:00 AM-12:30 AM,7:00 AM-11:59 PM
Sat 12:00 AM-12:30 AM,7:00 AM-10:00 PM
Hours subject to change. Please call to verify.
SPRINGFIELD IL 62707-0059 US
(555) 123-4567
SPRINGFIELD INTL ARPT (SPI)  Arrival Instructions

Upon arrival, please proceed to the National Car Rental booth.
RETURN
SPRINGFIELD INTL ARPT (SPI) 
Sun, October 25, 2026
8:00 PM
Vehicle
Full Size
Ford Fusion or similar
Auto Unspecified Drive
RATES & CHARGES
Vehicle    
TIME & DISTANCE 3 DAILY @ $41.00 $123.00
Estimated Total
(includes taxes and fees) $164.00
PAYMENT
Pay at counter  
DRIVER INFORMATION:
Driver Name: JANE TRAVELER
Emerald Club #: 111222333
`,
});

const NATIONAL_CANCEL = msg({
  id: 'nat2',
  internalDate: Date.parse('2026-10-12T15:03:00Z'),
  subject: 'Canceled: National Car Rental Reservation at SPRINGFIELD INTL ARPT on October 23, 2026 (SPI)',
  from: 'National Car Reservations <reservations@nationalcar.com>',
  body: `
 Confirmation:
123456789
The Reservation is Canceled.
The cancellation number is: 123456789
Canceled Reservation Details
PICK UP
SPRINGFIELD INTL ARPT (SPI)
Fri, October 23, 2026
9:00 AM
100 MAIN ST Sun 7:00 AM-5:00 PM
Mon-Fri 7:00 AM-6:00 PM
  Hours subject to change. Please call to verify.
SPRINGFIELD IL 62707-0059 US
(555) 123-4567
RETURN
SPRINGFIELD INTL ARPT (SPI)
Sun, October 25, 2026
 

8:00 PM
Vehicle
Full Size
Ford Fusion  or similar
`,
});

const HERTZ = msg({
  id: 'hz1',
  internalDate: Date.parse('2026-10-18T18:38:00Z'),
  subject: 'Jane, thanks for booking!',
  from: 'Hertz <reservations@emails.hertz.com>',
  body: `
Jane Traveler
#12345678
 
Your reservation is set, Jane!
 
Thanks for booking! Your confirmation is: A123B4C56D7
 
YOUR RESERVATION
 
(F0) Nissan Altima
 
Large Sedan
 
Upgrade options
 
Your add-ons:
Free unlimited miles
 
 Pickup
 
DENVER - DENVER
INTERNATIONAL AIRPORT (DEN)
 
Mar 02 | 12:00 pm
 
 Drop-off
 
DENVER - DENVER
INTERNATIONAL AIRPORT (DEN)
 
Mar 06 | 12:00 pm
 
Manage reservation
PRICE DETAILS
Total at pickup $229.69
Pick up:
Our location is off airport.
`,
});

test('rentalProviderFor recognises the senders', () => {
  assert.equal(rentalProviderFor('National Car Reservations <reservations@nationalcar.com>'), 'national');
  assert.equal(rentalProviderFor('Hertz <reservations@emails.hertz.com>'), 'hertz');
  assert.equal(rentalProviderFor('Someone <a@gmail.com>'), undefined);
});

test('parses a National confirmation', () => {
  const [event] = parseRentalEmail(NATIONAL);
  assert.equal(event!.type, 'booked');
  assert.deepEqual(
    { ...event!.car!, emailId: undefined, bookedAt: undefined },
    {
      provider: 'national',
      confirmationNumber: '123456789',
      pickupLocation: 'SPRINGFIELD INTL ARPT (SPI)',
      pickupAddress: '100 MAIN ST- SPRING. AIRPORT, SPRINGFIELD IL 62707-0059',
      pickupPhone: '(555) 123-4567',
      pickupAt: '2026-10-23T09:00:00',
      returnLocation: 'SPRINGFIELD INTL ARPT (SPI)',
      returnAt: '2026-10-25T20:00:00',
      vehicleClass: 'Full Size',
      vehicleModel: 'Ford Fusion or similar',
      driverName: 'JANE TRAVELER',
      emailId: undefined,
      bookedAt: undefined,
    },
  );
});

test('parses a National cancellation, keeping the confirmation number', () => {
  const [event] = parseRentalEmail(NATIONAL_CANCEL);
  assert.equal(event!.type, 'cancelled');
  assert.equal(event!.confirmationNumber, '123456789');
  assert.equal(event!.car!.pickupAddress, '100 MAIN ST, SPRINGFIELD IL 62707-0059');
  assert.equal(event!.car!.returnAt, '2026-10-25T20:00:00');
});

test('parses a Hertz confirmation and infers the year from the email date', () => {
  const [event] = parseRentalEmail(HERTZ);
  const car = event!.car!;
  assert.equal(event!.type, 'booked');
  assert.equal(car.confirmationNumber, 'A123B4C56D7');
  assert.equal(car.pickupLocation, 'DENVER - DENVER INTERNATIONAL AIRPORT (DEN)');
  assert.equal(car.pickupAt, '2027-03-02T12:00:00');
  assert.equal(car.returnAt, '2027-03-06T12:00:00');
  assert.equal(car.vehicleModel, 'Nissan Altima');
  assert.equal(car.vehicleClass, 'Large Sedan');
  assert.equal(car.driverName, 'Jane Traveler');
});

test('Hertz dates earlier in the same year stay in that year; a return across New Year rolls over', () => {
  const sameYear = msg({
    ...HERTZ,
    internalDate: Date.parse('2026-01-05T12:00:00Z'),
    body: HERTZ.body.replace('Mar 06', 'Jan 03'),
  });
  const car = parseRentalEmail(sameYear)[0]!.car!;
  assert.equal(car.pickupAt, '2026-03-02T12:00:00');
  assert.equal(car.returnAt, '2027-01-03T12:00:00');
});

test('ignores marketing mail from the same senders', () => {
  assert.deepEqual(
    parseRentalEmail(msg({ from: 'Hertz <reservations@emails.hertz.com>', subject: 'Save 20% this fall', body: 'Book now!' })),
    [],
  );
});

test('unwraps a forwarded confirmation', () => {
  const forwarded = msg({
    id: 'fwd1',
    from: 'Relative <rel@example.com>',
    subject: `Fwd: ${NATIONAL.subject}`,
    body: `Look at this\n\n---------- Forwarded message ---------\nFrom: ${NATIONAL.from}\nDate: Sun, Oct 11, 2026 at 11:03 AM\nSubject: ${NATIONAL.subject}\nTo: me@example.com\n\n${NATIONAL.body}`,
  });
  const [event] = parseRentalEmail(forwarded);
  assert.equal(event!.car!.confirmationNumber, '123456789');
});

test('folding: latest wins and a cancellation removes the reservation', () => {
  const booked = foldRentalEmails([NATIONAL, HERTZ]);
  assert.equal(booked.cars.length, 2);

  const afterCancel = foldRentalEmails([NATIONAL_CANCEL, NATIONAL, HERTZ]);
  assert.deepEqual(
    afterCancel.cars.map((c) => rentalCarKey(c)),
    ['hertz|A123B4C56D7'],
  );
  assert.deepEqual(afterCancel.cancellations, [{ provider: 'national', confirmationNumber: '123456789' }]);

  const revived = foldRentalEmails([NATIONAL_CANCEL, { ...NATIONAL, internalDate: NATIONAL_CANCEL.internalDate + 1000 }]);
  assert.equal(revived.cars.length, 1);
});

const HERTZ_CANCEL = msg({
  id: 'hz2',
  internalDate: Date.parse('2026-10-18T21:43:00Z'),
  subject: 'Jane, Your reservation has been canceled!',
  from: 'Hertz <reservations@emails.hertz.com>',
  body: `
Your reservation has been
canceled, Jane!
Cancellation: A123B4C56D7
Jane Traveler
#12345678
CANCELED RESERVATION
Pickup
DENVER - DENVER
INTERNATIONAL AIRPORT (DEN)
Mar 02 | 12:00 pm
Drop-off
DENVER - DENVER
INTERNATIONAL AIRPORT (DEN)
Mar 06 | 12:00 pm
Book a new reservation
`,
});

test('parses a Hertz cancellation and removes the booking it names', () => {
  const [event] = parseRentalEmail(HERTZ_CANCEL);
  assert.equal(event!.type, 'cancelled');
  assert.equal(event!.confirmationNumber, 'A123B4C56D7');
  assert.equal(event!.car!.pickupAt, '2027-03-02T12:00:00');

  assert.deepEqual(foldRentalEmails([HERTZ, HERTZ_CANCEL]).cars, []);
  assert.equal(foldRentalEmails([HERTZ_CANCEL, HERTZ]).cars.length, 0, 'order of arrival, not of the list, decides');
  assert.deepEqual(foldRentalEmails([HERTZ, HERTZ_CANCEL]).cancellations, [
    { provider: 'hertz', confirmationNumber: 'A123B4C56D7' },
  ]);
});
test('opening hours glued onto the street are dropped, and "( DEN )" is tidied to "(DEN)"', () => {
  const body = NATIONAL.body
    .replace('SPRINGFIELD INTL ARPT (SPI)', 'SPRINGFIELD INTL ARPT ( SPI )')
    .replace(/100 MAIN ST- SPRING\.\nAIRPORT\nSun[^\n]*\nMon-Fri[^\n]*\nSat[^\n]*\nHours subject to change\. Please call to verify\.\n/, '100 MAIN ST Sun-Sat 24 HOURS\n');
  const car = parseRentalEmail(msg({ ...NATIONAL, body }))[0]!.car!;
  assert.equal(car.pickupAddress, '100 MAIN ST, SPRINGFIELD IL 62707-0059');
  assert.equal(car.pickupLocation, 'SPRINGFIELD INTL ARPT (SPI)');
  assert.equal(car.returnLocation, 'SPRINGFIELD INTL ARPT (SPI)');
});