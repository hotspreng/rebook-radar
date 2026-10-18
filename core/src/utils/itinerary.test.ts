import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Airline, Cabin, FareType, FlightSource, PurchaseType } from '../models/common.js';
import type { Flight } from '../models/Flight.js';
import type { HotelStay } from '../models/HotelStay.js';
import type { RentalCar } from '../models/RentalCar.js';
import type { BusRide } from '../models/BusRide.js';
import { buildItinerary, buildItineraryHtml } from './itinerary.js';

function makeFlight(overrides: Partial<Flight> = {}): Flight {
  return {
    id: 'flt_1',
    passengerId: 'pax_1',
    airline: Airline.American,
    confirmationNumber: 'QDFZSJ',
    route: { origin: { code: 'ORD' }, destination: { code: 'OGG' } },
    departureDateTime: '2027-01-07T11:55:00',
    arrivalDateTime: '2027-01-07T17:40:00',
    fareType: FareType.Unknown,
    cabin: Cabin.Economy,
    originalCost: { purchaseType: PurchaseType.Cash, cashUsd: 273.1, taxesAndFeesUsd: 34.94 },
    bookingDate: '2026-09-09',
    source: FlightSource.Email,
    monitoring: true,
    createdAt: '2026-09-09T00:00:00Z',
    updatedAt: '2026-09-09T00:00:00Z',
    ...overrides,
  };
}

const outbound = (name: string, id: string): { flight: Flight; passengerName: string } => ({
  flight: makeFlight({
    id,
    segments: [
      {
        origin: { code: 'ORD' },
        destination: { code: 'OGG' },
        departureDateTime: '2027-01-07T11:55:00',
        arrivalDateTime: '2027-01-07T17:40:00',
        flightNumber: 'AA 89',
      },
    ],
  }),
  passengerName: name,
});

const ret = (name: string, id: string): { flight: Flight; passengerName: string } => ({
  flight: makeFlight({
    id,
    route: { origin: { code: 'OGG' }, destination: { code: 'ORD' } },
    departureDateTime: '2027-01-14T08:00:00',
    arrivalDateTime: '2027-01-14T16:30:00',
  }),
  passengerName: name,
});

test('two flights become an Outbound and a Return journey, earliest first', () => {
  // Passed in reverse order on purpose: ordering comes from departure time.
  const text = buildItinerary([ret('Joshua Sprenger', 'b'), outbound('Joshua Sprenger', 'a')]);
  const outIdx = text.indexOf('OUTBOUND JOURNEY');
  const retIdx = text.indexOf('RETURN JOURNEY');
  assert.ok(outIdx >= 0 && retIdx > outIdx, 'outbound must precede return');
  assert.match(text, /Thursday, January 7, 2027/);
  assert.match(text, /^Flight: AA 89$/m);
  assert.match(text, /^From: Chicago, IL – O'Hare International Airport \(ORD\)$/m);
  assert.match(text, /^To: Maui, HI – Kahului Airport \(OGG\)$/m);
  assert.match(text, /Departs: 11:55 AM/);
  assert.match(text, /Arrives: 5:40 PM/);
  assert.match(text, /Cabin: Economy/);
  assert.match(text, /American Airlines/);
});

test('travelers on the same flight are merged into one journey, not repeated', () => {
  const text = buildItinerary([
    outbound('Joshua Sprenger', 'a'),
    outbound('Amy Sprenger', 'b'),
    outbound('Emily Sprenger', 'c'),
    ret('Joshua Sprenger', 'd'),
    ret('Amy Sprenger', 'e'),
    ret('Emily Sprenger', 'f'),
  ]);
  assert.equal(text.match(/OUTBOUND JOURNEY/g)?.length, 1);
  assert.equal(text.match(/RETURN JOURNEY/g)?.length, 1);
  assert.match(text, /^Travelers: Joshua Sprenger, Amy Sprenger, Emily Sprenger$/m);
  // Everyone is on both journeys, so per-journey traveler lines are omitted.
  assert.equal(text.match(/Travelers:/g)?.length, 1);
  // One shared confirmation, printed once per journey.
  assert.equal(text.match(/Confirmation: QDFZSJ/g)?.length, 2);
});

test('a journey carrying only part of the party names its travelers', () => {
  const text = buildItinerary([
    outbound('Joshua Sprenger', 'a'),
    outbound('Amy Sprenger', 'b'),
    ret('Joshua Sprenger', 'c'),
  ]);
  const returnSection = text.slice(text.indexOf('RETURN JOURNEY'));
  assert.match(returnSection, /Travelers: Joshua Sprenger/);
  assert.doesNotMatch(text.slice(0, text.indexOf('RETURN JOURNEY')).split('OUTBOUND JOURNEY')[1]!, /Travelers:/);
});

test('travelers booked under different confirmations list each confirmation', () => {
  const a = outbound('Joshua Sprenger', 'a');
  const b = outbound('Amy Sprenger', 'b');
  b.flight.confirmationNumber = 'ZZZ999';
  const text = buildItinerary([a, b]);
  assert.match(text, /Confirmations: QDFZSJ \(Joshua Sprenger\); ZZZ999 \(Amy Sprenger\)/);
});

test('a same-day connection lists each segment with its layover', () => {
  const flight = makeFlight({
    airline: Airline.AirCanada,
    confirmationNumber: '2K4C2W',
    partnerConfirmationNumber: 'DSPJ1F',
    route: { origin: { code: 'ITH' }, destination: { code: 'ORD' } },
    departureDateTime: '2026-12-15T20:10:00',
    arrivalDateTime: '2026-12-15T23:29:00',
    durationMinutes: undefined,
    segments: [
      {
        origin: { code: 'ITH' },
        destination: { code: 'IAD' },
        departureDateTime: '2026-12-15T20:10:00',
        arrivalDateTime: '2026-12-15T21:30:00',
        flightNumber: 'UA 4954',
      },
      {
        origin: { code: 'IAD' },
        destination: { code: 'ORD' },
        departureDateTime: '2026-12-15T22:15:00',
        arrivalDateTime: '2026-12-15T23:29:00',
        flightNumber: 'UA 421',
      },
    ],
  });
  const text = buildItinerary([{ flight, passengerName: 'Emily Sprenger' }]);

  assert.match(text, /^FLIGHT$/m);
  // Flown by United even though it was booked through Air Canada, so the
  // traveler gets BOTH codes: United's own reference first, then Air Canada's.
  assert.match(text, /^United Airlines$/m);
  assert.match(text, /^United Airlines confirmation: DSPJ1F$/m);
  assert.match(text, /^Air Canada confirmation: 2K4C2W$/m);
  assert.ok(text.indexOf('United Airlines confirmation') < text.indexOf('Air Canada confirmation'));
  assert.match(text, /^Stops: 1 – Washington, DC \(IAD\)$/m);
  // Every segment carries its flight number and spelled-out airports.
  assert.match(text, /^1\. Flight UA 4954$/m);
  assert.match(text, /^ {3}From: Ithaca, NY – Ithaca Tompkins International Airport \(ITH\)$/m);
  assert.match(text, /^ {3}To: Washington, DC – Dulles International Airport \(IAD\)$/m);
  assert.match(text, /Departs 8:10 PM · Arrives 9:30 PM/);
  assert.match(text, /Layover in Washington, DC \(IAD\): 45m/);
  assert.match(text, /^2\. Flight UA 421$/m);
  assert.match(text, /^ {3}To: Chicago, IL – O'Hare International Airport \(ORD\)$/m);
  assert.match(text, /Departs 10:15 PM · Arrives 11:29 PM/);
});

test('a booking through another program without a partner reference notes where it was booked', () => {
  const flight = makeFlight({
    airline: Airline.AirCanada,
    confirmationNumber: '2K4C2W',
    segments: [
      {
        origin: { code: 'ORD' },
        destination: { code: 'OGG' },
        departureDateTime: '2027-01-07T11:55:00',
        flightNumber: 'UA 203',
      },
    ],
  });
  const text = buildItinerary([{ flight, passengerName: 'Amy Sprenger' }]);
  assert.match(text, /^Confirmation: 2K4C2W \(booked via Air Canada\)$/m);
  assert.match(text, /^Flight: UA 203$/m);
});

test('travelers booked under different confirmations keep each partner reference', () => {
  const mk = (name: string, conf: string, partner: string) => ({
    passengerName: name,
    flight: makeFlight({
      airline: Airline.AirCanada,
      confirmationNumber: conf,
      partnerConfirmationNumber: partner,
      segments: [
        {
          origin: { code: 'ORD' },
          destination: { code: 'OGG' },
          departureDateTime: '2027-01-07T11:55:00',
          flightNumber: 'UA 203',
        },
      ],
    }),
  });
  const text = buildItinerary([mk('Joshua Sprenger', 'AAA111', 'UUU111'), mk('Amy Sprenger', 'BBB222', 'UUU222')]);
  assert.match(
    text,
    /Confirmations: AAA111 \/ United Airlines UUU111 \(Joshua Sprenger\); BBB222 \/ United Airlines UUU222 \(Amy Sprenger\)/,
  );
});

test('an overnight arrival states the arrival day', () => {
  const flight = makeFlight({
    route: { origin: { code: 'OGG' }, destination: { code: 'ORD' } },
    departureDateTime: '2027-01-12T17:05:00',
    arrivalDateTime: '2027-01-13T05:03:00',
    durationMinutes: 478,
  });
  const text = buildItinerary([{ flight, passengerName: 'Amy Sprenger' }]);
  assert.match(text, /Departs: 5:05 PM/);
  assert.match(text, /Arrives: Wed, Jan 13 at 5:03 AM/);
  assert.match(text, /Duration: 7h 58m/);
});

test('an airport missing from the lookup falls back to its stored name, then the bare code', () => {
  const flight = makeFlight({
    route: {
      origin: { code: 'ZZA', name: 'Somewhere Regional' },
      destination: { code: 'ZZB' },
    },
  });
  const text = buildItinerary([{ flight, passengerName: 'Amy Sprenger' }]);
  assert.match(text, /^From: Somewhere Regional \(ZZA\)$/m);
  assert.match(text, /^To: ZZB$/m);
});

test('confirmation numbers can be left out', () => {
  const text = buildItinerary([outbound('Joshua Sprenger', 'a')], { includeConfirmation: false });
  assert.doesNotMatch(text, /Confirmation/);
  assert.doesNotMatch(text, /QDFZSJ/);
});

test('prices are never included', () => {
  const text = buildItinerary([outbound('Joshua Sprenger', 'a'), ret('Joshua Sprenger', 'b')]);
  assert.doesNotMatch(text, /\$|points|pts|273/i);
});

test('three or more flights are numbered', () => {
  const mid = makeFlight({
    id: 'mid',
    route: { origin: { code: 'OGG' }, destination: { code: 'LAX' } },
    departureDateTime: '2027-01-10T09:00:00',
    arrivalDateTime: '2027-01-10T16:00:00',
  });
  const text = buildItinerary([
    outbound('Joshua Sprenger', 'a'),
    { flight: mid, passengerName: 'Joshua Sprenger' },
    ret('Joshua Sprenger', 'c'),
  ]);
  assert.match(text, /FLIGHT 1 OF 3/);
  assert.match(text, /FLIGHT 2 OF 3/);
  assert.match(text, /FLIGHT 3 OF 3/);
});

test('no flights yields an empty itinerary', () => {
  assert.equal(buildItinerary([]), '');
  assert.equal(buildItineraryHtml([]), '');
});

/** A connection booked through a partner program: the richest case for the HTML view. */
function partnerConnection(): { flight: Flight; passengerName: string } {
  return {
    passengerName: 'Emily Sprenger',
    flight: makeFlight({
      airline: Airline.AirCanada,
      confirmationNumber: '2K4C2W',
      partnerConfirmationNumber: 'PMF5D6',
      route: { origin: { code: 'ITH' }, destination: { code: 'ORD' } },
      departureDateTime: '2026-12-15T20:10:00',
      arrivalDateTime: '2026-12-15T23:29:00',
      segments: [
        {
          origin: { code: 'ITH' },
          destination: { code: 'IAD' },
          departureDateTime: '2026-12-15T20:10:00',
          arrivalDateTime: '2026-12-15T21:30:00',
          flightNumber: 'UA 4954',
        },
        {
          origin: { code: 'IAD' },
          destination: { code: 'ORD' },
          departureDateTime: '2026-12-15T22:15:00',
          arrivalDateTime: '2026-12-15T23:29:00',
          flightNumber: 'UA 421',
        },
      ],
    }),
  };
}

test('the formatted version carries the same content as the plain text', () => {
  const inputs = [outbound('Joshua Sprenger', 'a'), ret('Joshua Sprenger', 'b')];
  const html = buildItineraryHtml(inputs);
  assert.match(html, /OUTBOUND JOURNEY/);
  assert.match(html, /RETURN JOURNEY/);
  assert.match(html, /Thursday, January 7, 2027/);
  assert.match(html, />AA 89</);
  // Apostrophes are escaped in HTML, so compare against the escaped form.
  assert.match(html, /Chicago, IL – O&#39;Hare International Airport \(ORD\)/);
  assert.match(html, /Departs/);
  assert.match(html, />QDFZSJ</);
  assert.match(html, /Flight Itinerary/);
});

test('the formatted version of a partner connection lists both codes and every segment', () => {
  const html = buildItineraryHtml([partnerConnection()]);
  assert.match(html, /United Airlines confirmation/);
  assert.match(html, />PMF5D6</);
  assert.match(html, /Air Canada confirmation/);
  assert.match(html, />2K4C2W</);
  assert.match(html, /1\. Flight UA 4954/);
  assert.match(html, /2\. Flight UA 421/);
  assert.match(html, /Layover in Washington, DC \(IAD\): 45m/);
  assert.ok(html.indexOf('United Airlines confirmation') < html.indexOf('Air Canada confirmation'));
});

test('the formatted version honors the confirmation toggle and never shows prices', () => {
  const inputs = [outbound('Joshua Sprenger', 'a')];
  const without = buildItineraryHtml(inputs, { includeConfirmation: false });
  assert.doesNotMatch(without, /QDFZSJ|onfirmation/);
  assert.doesNotMatch(buildItineraryHtml(inputs), /\$|273|points|pts/i);
});

test('the formatted version escapes markup in names and airport data', () => {
  const evil = outbound('Bob <script>alert(1)</script> & "Co"', 'a');
  evil.flight.route = { origin: { code: 'ZZA', name: '<img src=x onerror=alert(1)>' }, destination: { code: 'ZZB' } };
  const html = buildItineraryHtml([evil]);
  assert.doesNotMatch(html, /<script|<img/i);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&amp; &quot;Co&quot;/);
});

test('the formatted version is self-contained email-safe markup', () => {
  const html = buildItineraryHtml([partnerConnection()]);
  // Inline styles only: no stylesheet, script, external asset or class hooks.
  assert.doesNotMatch(html, /<style|<script|<link|<img|class=|https?:\/\//i);
  assert.match(html, /<table/);
});

// --- hotel stays -----------------------------------------------------------

const MARRIOTT_STAY: HotelStay = {
  id: 'h1',
  provider: 'marriott',
  hotelName: 'Fairfield by Marriott Inn & Suites New York Manhattan/Central Park',
  address: '538 West 58th Street New York, New York 10019 USA',
  phone: '+1-212-757-8550',
  checkIn: '2027-01-06T15:00:00',
  checkOut: '2027-01-07T11:00:00',
  nights: 1,
  guestNames: ['Jane Traveler'],
  guests: 2,
  rooms: 1,
  roomType: '2 Double Beds',
  confirmationNumber: '2AB345CDEF',
  createdAt: '2026-10-17T00:00:00Z',
  updatedAt: '2026-10-17T00:00:00Z',
};

const AGENT_STAY: HotelStay = {
  ...MARRIOTT_STAY,
  id: 'h2',
  provider: 'frankfurtflyer',
  hotelName: 'Conrad Hong Kong',
  address: 'Hong Kong, China',
  phone: undefined,
  checkIn: '2027-01-14',
  checkOut: '2027-01-17',
  nights: 3,
  roomType: undefined,
  confirmationNumber: undefined,
  bookingReference: 'KABCDE',
};

test('a hotel stay is listed in date order between the flights it falls between', () => {
  const text = buildItinerary([outbound('Joshua Sprenger', 'a'), ret('Joshua Sprenger', 'b')], {
    hotels: [{ ...MARRIOTT_STAY, checkIn: '2027-01-08T15:00:00', checkOut: '2027-01-14T11:00:00' }],
  });
  assert.match(text, /^TRAVEL ITINERARY$/m);
  const out = text.indexOf('OUTBOUND JOURNEY');
  const stay = text.indexOf('HOTEL STAY');
  const back = text.indexOf('RETURN JOURNEY');
  assert.ok(out >= 0 && stay > out && back > stay, 'outbound, then the stay, then the return');
});

test('a hotel stay lists name, address, check-in/out times, nights, guests and confirmation', () => {
  const text = buildItinerary([], { hotels: [MARRIOTT_STAY] });
  assert.match(text, /^HOTEL ITINERARY$/m);
  assert.match(text, /^Travelers: Jane Traveler$/m);
  assert.match(text, /^HOTEL STAY$/m);
  assert.match(text, /^Fairfield by Marriott Inn & Suites New York Manhattan\/Central Park$/m);
  assert.match(text, /^Address: 538 West 58th Street New York, New York 10019 USA$/m);
  assert.match(text, /^Phone: \+1-212-757-8550$/m);
  assert.match(text, /^Check-in: Wednesday, January 6, 2027, from 3:00 PM$/m);
  assert.match(text, /^Check-out: Thursday, January 7, 2027, by 11:00 AM$/m);
  assert.match(text, /^Nights: 1$/m);
  assert.match(text, /^Guest: Jane Traveler \(2 guests\)$/m);
  assert.match(text, /^Room: 2 Double Beds$/m);
  assert.match(text, /^Confirmation: 2AB345CDEF$/m);
});

test('a stay without times shows dates only, and an agent reference names the agent', () => {
  const text = buildItinerary([], { hotels: [AGENT_STAY] });
  assert.match(text, /^Check-in: Thursday, January 14, 2027$/m);
  assert.match(text, /^Check-out: Sunday, January 17, 2027$/m);
  assert.match(text, /^Booking reference \(via Frankfurtflyer\): KABCDE$/m);
  assert.doesNotMatch(text, /^Confirmation:/m);
});

test('hotel confirmation numbers honor the confirmation toggle', () => {
  const text = buildItinerary([], { hotels: [MARRIOTT_STAY, AGENT_STAY], includeConfirmation: false });
  assert.doesNotMatch(text, /2AB345CDEF|KABCDE/);
});

test('the formatted version of a stay carries the same content and escapes markup', () => {
  const html = buildItineraryHtml([outbound('Joshua Sprenger', 'a')], {
    hotels: [{ ...MARRIOTT_STAY, hotelName: 'Inn <b>& Suites</b>' }],
  });
  assert.match(html, /HOTEL STAY/);
  assert.match(html, /Inn &lt;b&gt;&amp; Suites&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>/);
  assert.match(html, /2AB345CDEF/);
  assert.match(html, /Wednesday, January 6, 2027, from 3:00 PM/);
});

// --- car rentals ------------------------------------------------------------

const NATIONAL_CAR: RentalCar = {
  id: 'c1',
  provider: 'national',
  confirmationNumber: '123456789',
  pickupLocation: 'SPRINGFIELD INTL ARPT (SPI)',
  pickupAddress: '100 MAIN ST- SPRING. AIRPORT, SPRINGFIELD IL 62707-0059',
  pickupPhone: '(555) 123-4567',
  pickupAt: '2027-01-07T18:30:00',
  returnLocation: 'SPRINGFIELD INTL ARPT (SPI)',
  returnAt: '2027-01-14T08:00:00',
  vehicleClass: 'Full Size',
  vehicleModel: 'Ford Fusion or similar',
  driverName: 'JANE TRAVELER',
  createdAt: '2026-10-17T00:00:00Z',
  updatedAt: '2026-10-17T00:00:00Z',
};

const HERTZ_CAR: RentalCar = {
  ...NATIONAL_CAR,
  id: 'c2',
  provider: 'hertz',
  confirmationNumber: 'A123B4C56D7',
  pickupLocation: 'DENVER - DENVER INTERNATIONAL AIRPORT (DEN)',
  pickupAddress: undefined,
  pickupPhone: undefined,
  returnLocation: 'Downtown Depot',
  vehicleClass: 'Large Sedan',
  vehicleModel: 'Nissan Altima',
  driverName: undefined,
};

test('a car rental sits in date order between the flights, with the airport spelled out', () => {
  const text = buildItinerary([outbound('Joshua Sprenger', 'a'), ret('Joshua Sprenger', 'b')], {
    rentals: [{ ...HERTZ_CAR, pickupAt: '2027-01-07T18:30:00' }],
  });
  assert.match(text, /^TRAVEL ITINERARY$/m);
  assert.ok(text.indexOf('OUTBOUND JOURNEY') < text.indexOf('CAR RENTAL'));
  assert.ok(text.indexOf('CAR RENTAL') < text.indexOf('RETURN JOURNEY'));
  assert.match(text, /^Pick-up location: Denver, CO – Denver International Airport \(DEN\)$/m);
  assert.match(text, /^Return location: Downtown Depot$/m);
});

test('a car rental lists company, locations, times, vehicle, driver and confirmation', () => {
  const text = buildItinerary([], { rentals: [NATIONAL_CAR] });
  assert.match(text, /^CAR RENTAL ITINERARY$/m);
  assert.match(text, /^Travelers: JANE TRAVELER$/m);
  assert.match(text, /^CAR RENTAL$/m);
  assert.match(text, /^National Car Rental$/m);
  assert.match(text, /^Address: 100 MAIN ST- SPRING\. AIRPORT, SPRINGFIELD IL 62707-0059$/m);
  assert.match(text, /^Phone: \(555\) 123-4567$/m);
  assert.match(text, /^Pick-up: Thursday, January 7, 2027, at 6:30 PM$/m);
  assert.match(text, /^Return location: Same as pick-up$/m);
  assert.match(text, /^Return: Thursday, January 14, 2027, by 8:00 AM$/m);
  assert.match(text, /^Vehicle: Full Size – Ford Fusion or similar$/m);
  assert.match(text, /^Driver: JANE TRAVELER$/m);
  assert.match(text, /^Confirmation: 123456789$/m);
});

test('hotels and rentals together make a travel itinerary; rental confirmations honor the toggle', () => {
  const both = buildItinerary([outbound('Joshua Sprenger', 'a')], {
    hotels: [MARRIOTT_STAY],
    rentals: [NATIONAL_CAR],
    includeConfirmation: false,
  });
  assert.match(both, /^TRAVEL ITINERARY$/m);
  assert.match(both, /HOTEL STAY/);
  assert.match(both, /CAR RENTAL/);
  assert.doesNotMatch(both, /123456789|2AB345CDEF/);
  assert.match(buildItinerary([], { hotels: [MARRIOTT_STAY], rentals: [NATIONAL_CAR] }), /^TRAVEL ITINERARY$/m);
});

test('the formatted version of a rental carries the same content and escapes markup', () => {
  const html = buildItineraryHtml([], { rentals: [{ ...NATIONAL_CAR, vehicleModel: 'Car <i>X</i>' }] });
  assert.match(html, /CAR RENTAL/);
  assert.match(html, /123456789/);
  assert.match(html, /Car &lt;i&gt;X&lt;\/i&gt;/);
  assert.doesNotMatch(html, /<i>/);
});
// --- bus rides --------------------------------------------------------------

const BUS_TO_AIRPORT: BusRide = {
  id: 'b1',
  provider: 'ourbus',
  ticketReference: 'ABCD12',
  departureAt: '2027-01-07T07:15:00',
  arrivalAt: '2027-01-07T08:45:00',
  departureCity: 'Ithaca, NY',
  departureStop: 'Campus Road behind Example Hall',
  arrivalCity: 'Chicago Airport, IL',
  arrivalStop: 'Terminal 1 ground transportation',
  vehicle: 'Motor Coach',
  operator: 'Example Coach Inc',
  passengerNames: ['Jane Traveler', 'John Traveler'],
  createdAt: '2026-10-17T00:00:00Z',
  updatedAt: '2026-10-17T00:00:00Z',
};

const BUS_FROM_AIRPORT: BusRide = {
  ...BUS_TO_AIRPORT,
  id: 'b2',
  ticketReference: 'WXYZ34',
  departureAt: '2027-01-14T17:00:00',
  arrivalAt: '2027-01-14T19:30:00',
  departureCity: 'Rochester, NY',
  departureStop: 'Example Regional Airport, arrivals/lower level',
  arrivalCity: 'Ithaca, NY',
  arrivalStop: undefined,
  operator: undefined,
  passengerNames: [],
};

test('bus transfers are labelled by airport direction and placed in date order', () => {
  const text = buildItinerary([outbound('Joshua Sprenger', 'a'), ret('Joshua Sprenger', 'b')], {
    buses: [BUS_FROM_AIRPORT, BUS_TO_AIRPORT],
  });
  const to = text.indexOf('BUS TO AIRPORT');
  const out = text.indexOf('OUTBOUND JOURNEY');
  const back = text.indexOf('RETURN JOURNEY');
  const from = text.indexOf('BUS FROM AIRPORT');
  assert.ok(to >= 0 && to < out && out < back && back < from, 'bus, outbound, return, bus');
  assert.match(text, /^TRAVEL ITINERARY$/m);
});

test('a bus ride lists stops, times, operator, passengers and ticket reference', () => {
  const text = buildItinerary([], { buses: [BUS_TO_AIRPORT] });
  assert.match(text, /^BUS ITINERARY$/m);
  assert.match(text, /^Travelers: Jane Traveler, John Traveler$/m);
  assert.match(text, /^OurBus$/m);
  assert.match(text, /^From: Ithaca, NY – Campus Road behind Example Hall$/m);
  assert.match(text, /^Departs: 7:15 AM$/m);
  assert.match(text, /^To: Chicago Airport, IL – Terminal 1 ground transportation$/m);
  assert.match(text, /^Arrives: 8:45 AM$/m);
  assert.match(text, /^Operated by: Example Coach Inc$/m);
  assert.match(text, /^Passengers: Jane Traveler, John Traveler$/m);
  assert.match(text, /^Ticket reference: ABCD12$/m);
  assert.doesNotMatch(buildItinerary([], { buses: [BUS_TO_AIRPORT], includeConfirmation: false }), /ABCD12/);
});

test('the formatted version of a bus ride carries the same content and escapes markup', () => {
  const html = buildItineraryHtml([], { buses: [{ ...BUS_TO_AIRPORT, operator: 'A <b>Coach</b>' }] });
  assert.match(html, /BUS TO AIRPORT/);
  assert.match(html, /A &lt;b&gt;Coach&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>Coach/);
  assert.match(html, /ABCD12/);
});