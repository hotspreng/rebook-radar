import { AIRLINE_LABELS, Airline, CABIN_LABELS, Cabin } from '../models/common.js';
import type { Airport, Flight, FlightSegment } from '../models/Flight.js';
import { operatingAirline } from '../models/Flight.js';
import { HOTEL_PROVIDER_LABELS, type HotelStay } from '../models/HotelStay.js';
import { RENTAL_PROVIDER_LABELS, type RentalCar } from '../models/RentalCar.js';
import { formatAirportCity, formatAirportName, lookupAirport } from '../data/airports.js';

/** One tracked flight plus the traveler it belongs to. */
export interface ItineraryFlight {
  flight: Flight;
  passengerName: string;
}

export interface ItineraryOptions {
  /** Title defaults: "FLIGHT ITINERARY" / "HOTEL ITINERARY" / "CAR RENTAL ITINERARY" / "TRAVEL ITINERARY". */
  title?: string;
  /** Include confirmation numbers. Defaults to true. */
  includeConfirmation?: boolean;
  /** Hotel stays to list alongside the flights, in date order. */
  hotels?: HotelStay[];
  /** Car rentals to list alongside the flights and stays, in date order. */
  rentals?: RentalCar[];
}

/** Full carrier names for correspondence ("United Airlines", not "United"). */
const AIRLINE_FULL_NAMES: Record<Airline, string> = {
  [Airline.Southwest]: 'Southwest Airlines',
  [Airline.United]: 'United Airlines',
  [Airline.Delta]: 'Delta Air Lines',
  [Airline.American]: 'American Airlines',
  [Airline.AirCanada]: 'Air Canada',
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/**
 * Parse a stored wall-clock date/time ("2026-12-15T20:10:00"). These are local
 * to the airport and carry no timezone, so they are read component-by-component
 * rather than through `Date`, which would shift them into the machine's zone.
 */
function parseLocal(value: string | undefined): LocalDateTime | undefined {
  const m = value?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return undefined;
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
  };
}

/** "Thursday, January 7, 2027" */
function formatDay(t: LocalDateTime): string {
  const weekday = new Date(Date.UTC(t.year, t.month - 1, t.day)).getUTCDay();
  return `${DAY_NAMES[weekday]}, ${MONTH_NAMES[t.month - 1]} ${t.day}, ${t.year}`;
}

/** "Wed, Jan 13" — used only when an arrival lands on a different day. */
function formatShortDay(t: LocalDateTime): string {
  const weekday = new Date(Date.UTC(t.year, t.month - 1, t.day)).getUTCDay();
  return `${DAY_NAMES[weekday]!.slice(0, 3)}, ${MONTH_NAMES[t.month - 1]!.slice(0, 3)} ${t.day}`;
}

/** "8:10 PM" */
function formatTime(t: LocalDateTime): string {
  const suffix = t.hour >= 12 ? 'PM' : 'AM';
  const hour = t.hour % 12 === 0 ? 12 : t.hour % 12;
  return `${hour}:${String(t.minute).padStart(2, '0')} ${suffix}`;
}

function sameDay(a: LocalDateTime, b: LocalDateTime): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

function minutesBetween(a: LocalDateTime, b: LocalDateTime): number {
  const toMs = (t: LocalDateTime): number => Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute);
  return Math.round((toMs(b) - toMs(a)) / 60_000);
}

/** 125 → "2h 5m" */
function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Spelled-out airport with its code after: "Chicago, IL – O'Hare International Airport (ORD)". */
function airportLabel(airport: Airport): string {
  return formatAirportName(airport.code, airport.name);
}

/** "11:55 AM" or, when the arrival is on another day, "Wed, Jan 13 at 5:03 AM". */
function formatEndpoint(time: LocalDateTime, relativeTo: LocalDateTime): string {
  return sameDay(time, relativeTo) ? formatTime(time) : `${formatShortDay(time)} at ${formatTime(time)}`;
}

/** Display name of the carrier flying a flight, e.g. "United Airlines". */
function carrierName(flight: Flight): string {
  const operating = operatingAirline(flight);
  return AIRLINE_FULL_NAMES[operating] ?? AIRLINE_LABELS[operating] ?? operating;
}

/** Travelers sharing one flight leg, merged into a single journey. */
interface Journey {
  flight: Flight;
  passengers: string[];
  confirmations: { number: string; partner?: string; passengers: string[] }[];
}

/**
 * Merge tracked flights into journeys. Flights with the same route and
 * departure time are the same physical flight, so a family booked together
 * (one tracked flight per traveler) collapses to a single journey that lists
 * everyone, rather than repeating identical flight details per person.
 */
function groupJourneys(inputs: ItineraryFlight[]): Journey[] {
  const byLeg = new Map<string, Journey>();
  for (const { flight, passengerName } of inputs) {
    const key = [
      flight.route.origin.code,
      flight.route.destination.code,
      flight.departureDateTime.slice(0, 16),
    ].join('|');
    let journey = byLeg.get(key);
    if (!journey) {
      journey = { flight, passengers: [], confirmations: [] };
      byLeg.set(key, journey);
    } else if (!journey.flight.segments?.length && flight.segments?.length) {
      // Travelers on one flight can be at different stages of an import; show
      // the record that knows the flight numbers.
      journey.flight = flight;
    }
    if (!journey.passengers.includes(passengerName)) journey.passengers.push(passengerName);

    const number = flight.confirmationNumber?.trim();
    if (number) {
      let conf = journey.confirmations.find((c) => c.number === number);
      if (!conf) {
        conf = { number, passengers: [] };
        journey.confirmations.push(conf);
      }
      conf.partner ??= flight.partnerConfirmationNumber?.trim() || undefined;
      if (!conf.passengers.includes(passengerName)) conf.passengers.push(passengerName);
    }
  }
  return [...byLeg.values()].sort((a, b) => a.flight.departureDateTime.localeCompare(b.flight.departureDateTime));
}

function journeyHeading(index: number, total: number): string {
  if (total === 1) return 'FLIGHT';
  if (total === 2) return index === 0 ? 'OUTBOUND JOURNEY' : 'RETURN JOURNEY';
  return `FLIGHT ${index + 1} OF ${total}`;
}

/** The flight's operated segments, or a single synthetic one for a nonstop. */
function segmentsOf(flight: Flight): FlightSegment[] {
  if (flight.segments && flight.segments.length > 0) return flight.segments;
  return [
    {
      origin: flight.route.origin,
      destination: flight.route.destination,
      departureDateTime: flight.departureDateTime,
      arrivalDateTime: flight.arrivalDateTime,
    },
  ];
}

interface Field {
  label: string;
  value: string;
}

/** One operated flight inside a connection. */
interface SegmentView {
  /** "Flight UA 4954", or "ITH → IAD" when the number is unknown. */
  title: string;
  from: string;
  to: string;
  /** "Departs 8:10 PM · Arrives 9:30 PM" */
  times?: string;
  /** "Layover in Washington, DC (IAD): 45m" — shown after the segment. */
  layover?: string;
}

/**
 * Everything printed for one itinerary section, independent of output format.
 * A hotel stay uses the same shape as a flight journey (`carrier` holds the
 * hotel name), so both renderers draw either without special cases.
 */
interface JourneyView {
  heading: string;
  date?: string;
  /** The airline for a flight; the hotel name for a stay. */
  carrier: string;
  /** Flight / From / To / Departs / Arrives / Duration. */
  details: Field[];
  /** "1 – Washington, DC (IAD)"; only for connections. */
  stops?: string;
  segments: SegmentView[];
  /** Cabin and, for a partial party, Travelers. */
  extras: Field[];
  confirmations: Field[];
}

interface ItineraryView {
  title: string;
  htmlTitle: string;
  travelers: string[];
  /** Flights and hotel stays, in date order. */
  journeys: JourneyView[];
}

/**
 * Booking references for a journey. When a flight is booked through one
 * airline's program but flown by another (e.g. Aeroplan on United), the
 * traveler needs BOTH codes: the operating airline's own reference for its
 * check-in and agents (listed first), and the booking program's.
 */
function confirmationFields(journey: Journey): Field[] {
  const { flight, confirmations } = journey;
  if (confirmations.length === 0) return [];

  const flownBy = carrierName(flight);
  const bookedWith = AIRLINE_FULL_NAMES[flight.airline] ?? AIRLINE_LABELS[flight.airline] ?? flight.airline;
  const viaPartner = operatingAirline(flight) !== flight.airline;

  if (confirmations.length === 1) {
    const conf = confirmations[0]!;
    if (conf.partner) {
      return [
        { label: `${flownBy} confirmation`, value: conf.partner },
        { label: `${bookedWith} confirmation`, value: conf.number },
      ];
    }
    return [{ label: 'Confirmation', value: `${conf.number}${viaPartner ? ` (booked via ${bookedWith})` : ''}` }];
  }

  const each = confirmations
    .map((c) => {
      const codes = c.partner ? `${c.number} / ${flownBy} ${c.partner}` : c.number;
      return `${codes} (${c.passengers.join(', ')})`;
    })
    .join('; ');
  return [{ label: 'Confirmations', value: `${each}${viaPartner ? ` (booked via ${bookedWith})` : ''}` }];
}

function describeJourney(journey: Journey, heading: string, allPassengers: string[], includeConfirmation: boolean): JourneyView {
  const { flight } = journey;
  const departs = parseLocal(flight.departureDateTime);
  const arrives = parseLocal(flight.arrivalDateTime);
  const segments = segmentsOf(flight);
  const isConnection = segments.length > 1;

  const details: Field[] = [];
  // A nonstop's flight number goes up front; a connection lists the number of
  // every segment in the breakdown instead.
  if (!isConnection && segments[0]!.flightNumber) details.push({ label: 'Flight', value: segments[0]!.flightNumber });
  details.push({ label: 'From', value: airportLabel(flight.route.origin) });
  details.push({ label: 'To', value: airportLabel(flight.route.destination) });
  if (departs) details.push({ label: 'Departs', value: formatTime(departs) });
  if (arrives && departs) details.push({ label: 'Arrives', value: formatEndpoint(arrives, departs) });
  if (flight.durationMinutes != null && flight.durationMinutes > 0) {
    details.push({ label: 'Duration', value: formatDuration(flight.durationMinutes) });
  }

  let stops: string | undefined;
  const segmentViews: SegmentView[] = [];
  if (isConnection) {
    const stopNames = segments.slice(0, -1).map((s) => formatAirportCity(s.destination.code, s.destination.name));
    stops = `${stopNames.length} – ${stopNames.join(', ')}`;
    segments.forEach((segment, i) => {
      const dep = parseLocal(segment.departureDateTime);
      const arr = parseLocal(segment.arrivalDateTime);
      const view: SegmentView = {
        title: segment.flightNumber ? `Flight ${segment.flightNumber}` : `${segment.origin.code} → ${segment.destination.code}`,
        from: airportLabel(segment.origin),
        to: airportLabel(segment.destination),
      };
      if (dep) view.times = `Departs ${formatTime(dep)}${arr ? ` · Arrives ${formatEndpoint(arr, dep)}` : ''}`;
      const nextDep = parseLocal(segments[i + 1]?.departureDateTime);
      if (arr && nextDep) {
        const layover = minutesBetween(arr, nextDep);
        if (layover > 0) {
          const where = formatAirportCity(segment.destination.code, segment.destination.name);
          view.layover = `Layover in ${where}: ${formatDuration(layover)}`;
        }
      }
      segmentViews.push(view);
    });
  }

  const extras: Field[] = [];
  if (flight.cabin && flight.cabin !== Cabin.Unknown) extras.push({ label: 'Cabin', value: CABIN_LABELS[flight.cabin] });
  // Only name travelers on a journey when it carries fewer than the whole party.
  const everyoneFlies = allPassengers.every((p) => journey.passengers.includes(p));
  if (!everyoneFlies) extras.push({ label: 'Travelers', value: journey.passengers.join(', ') });

  return {
    heading,
    date: departs ? formatDay(departs) : undefined,
    carrier: carrierName(flight),
    details,
    stops,
    segments: segmentViews,
    extras,
    confirmations: includeConfirmation ? confirmationFields(journey) : [],
  };
}

/** "2026-11-19T15:00:00" or "2025-06-27" (time unknown). */
function parseStayMoment(value: string): { day: LocalDateTime; hasTime: boolean } | undefined {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return undefined;
  return {
    day: { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: Number(m[4] ?? 0), minute: Number(m[5] ?? 0) },
    hasTime: m[4] !== undefined,
  };
}

/** "Thursday, November 19, 2026, from 3:00 PM" — the time is added only when known. */
function stayDateLabel(value: string, timePrefix: string): string {
  const moment = parseStayMoment(value);
  if (!moment) return value;
  const day = formatDay(moment.day);
  return moment.hasTime ? `${day}, ${timePrefix} ${formatTime(moment.day)}` : day;
}

function describeStay(stay: HotelStay, includeConfirmation: boolean): JourneyView {
  const checkIn = parseStayMoment(stay.checkIn);
  const details: Field[] = [];
  if (stay.address) details.push({ label: 'Address', value: stay.address });
  if (stay.phone) details.push({ label: 'Phone', value: stay.phone });
  details.push({ label: 'Check-in', value: stayDateLabel(stay.checkIn, 'from') });
  details.push({ label: 'Check-out', value: stayDateLabel(stay.checkOut, 'by') });
  if (stay.nights != null && stay.nights > 0) {
    details.push({ label: 'Nights', value: String(stay.nights) });
  }

  const extras: Field[] = [];
  const party = stay.guests != null ? `${stay.guests} ${stay.guests === 1 ? 'guest' : 'guests'}` : undefined;
  if (stay.guestNames.length > 0) {
    const names = stay.guestNames.join(', ');
    extras.push({
      label: stay.guestNames.length > 1 ? 'Guests' : 'Guest',
      value: party && stay.guestNames.length < (stay.guests ?? 0) ? `${names} (${party})` : names,
    });
  } else if (party) {
    extras.push({ label: 'Guests', value: String(stay.guests) });
  }
  if (stay.rooms != null && stay.rooms > 1) extras.push({ label: 'Rooms', value: String(stay.rooms) });
  if (stay.roomType) extras.push({ label: 'Room', value: stay.roomType });

  const confirmations: Field[] = [];
  if (includeConfirmation) {
    if (stay.confirmationNumber) confirmations.push({ label: 'Confirmation', value: stay.confirmationNumber });
    if (stay.bookingReference) {
      confirmations.push({
        label: `Booking reference (via ${HOTEL_PROVIDER_LABELS[stay.provider]})`,
        value: stay.bookingReference,
      });
    }
  }

  return {
    heading: 'HOTEL STAY',
    date: checkIn ? formatDay(checkIn.day) : undefined,
    carrier: stay.hotelName,
    details,
    segments: [],
    extras,
    confirmations,
  };
}

function describeRental(car: RentalCar, includeConfirmation: boolean): JourneyView {
  const pickup = parseStayMoment(car.pickupAt);
  const details: Field[] = [{ label: 'Pick-up location', value: rentalLocationLabel(car.pickupLocation) }];
  if (car.pickupAddress) details.push({ label: 'Address', value: car.pickupAddress });
  if (car.pickupPhone) details.push({ label: 'Phone', value: car.pickupPhone });
  details.push({ label: 'Pick-up', value: stayDateLabel(car.pickupAt, 'at') });
  details.push({
    label: 'Return location',
    value: car.returnLocation === car.pickupLocation ? 'Same as pick-up' : rentalLocationLabel(car.returnLocation),
  });
  details.push({ label: 'Return', value: stayDateLabel(car.returnAt, 'by') });
  const vehicle = [car.vehicleClass, car.vehicleModel].filter(Boolean).join(' – ');
  if (vehicle) details.push({ label: 'Vehicle', value: vehicle });

  const extras: Field[] = [];
  if (car.driverName) extras.push({ label: 'Driver', value: car.driverName });

  return {
    heading: 'CAR RENTAL',
    date: pickup ? formatDay(pickup.day) : undefined,
    carrier: RENTAL_PROVIDER_LABELS[car.provider],
    details,
    segments: [],
    extras,
    confirmations: includeConfirmation ? [{ label: 'Confirmation', value: car.confirmationNumber }] : [],
  };
}

/** "ROCHESTER INTL ARPT (ROC)" → the spelled-out airport when the code is in the lookup table. */
function rentalLocationLabel(location: string): string {
  const code = location.match(/\(([A-Z]{3})\)\s*$/)?.[1];
  return code && lookupAirport(code) ? formatAirportName(code) : location;
}

function buildView(inputs: ItineraryFlight[], options: ItineraryOptions): ItineraryView | undefined {
  const journeys = groupJourneys(inputs);
  const stays = options.hotels ?? [];
  const cars = options.rentals ?? [];
  if (journeys.length === 0 && stays.length === 0 && cars.length === 0) return undefined;

  const includeConfirmation = options.includeConfirmation ?? true;
  const travelers: string[] = [];
  for (const journey of journeys) {
    for (const name of journey.passengers) if (!travelers.includes(name)) travelers.push(name);
  }
  // Without flights there are no passengers, so name the hotel guests and drivers instead.
  if (journeys.length === 0) {
    const names = [...stays.flatMap((s) => s.guestNames), ...cars.map((c) => c.driverName ?? '')];
    for (const name of names) if (name && !travelers.includes(name)) travelers.push(name);
  }

  const sections: { sortKey: string; view: JourneyView }[] = [
    ...journeys.map((journey, index) => ({
      sortKey: journey.flight.departureDateTime.slice(0, 16),
      view: describeJourney(journey, journeyHeading(index, journeys.length), travelers, includeConfirmation),
    })),
    ...stays.map((stay) => ({
      // A date-only check-in sorts as the usual mid-afternoon check-in time.
      sortKey: stay.checkIn.length > 10 ? stay.checkIn.slice(0, 16) : `${stay.checkIn}T15:00`,
      view: describeStay(stay, includeConfirmation),
    })),
    ...cars.map((car) => ({
      sortKey: car.pickupAt.length > 10 ? car.pickupAt.slice(0, 16) : `${car.pickupAt}T12:00`,
      view: describeRental(car, includeConfirmation),
    })),
  ].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  const kind =
    journeys.length > 0
      ? stays.length + cars.length > 0 ? 'Travel' : 'Flight'
      : stays.length > 0 ? (cars.length > 0 ? 'Travel' : 'Hotel') : 'Car Rental';
  return {
    title: options.title ?? `${kind.toUpperCase()} ITINERARY`,
    htmlTitle: options.title ?? `${kind} Itinerary`,
    travelers,
    journeys: sections.map((s) => s.view),
  };
}

function renderText(view: ItineraryView): string {
  const lines: string[] = [view.title];
  if (view.travelers.length > 0) lines.push(`Travelers: ${view.travelers.join(', ')}`);

  for (const j of view.journeys) {
    lines.push('', j.heading);
    if (j.date) lines.push(j.date);
    lines.push(j.carrier);
    for (const f of j.details) lines.push(`${f.label}: ${f.value}`);
    if (j.stops) lines.push(`Stops: ${j.stops}`);
    if (j.segments.length > 0) {
      lines.push('Connection details:');
      j.segments.forEach((s, i) => {
        lines.push(`${i + 1}. ${s.title}`, `   From: ${s.from}`, `   To: ${s.to}`);
        if (s.times) lines.push(`   ${s.times}`);
        if (s.layover) lines.push(`   ${s.layover}`);
      });
    }
    for (const f of [...j.extras, ...j.confirmations]) lines.push(`${f.label}: ${f.value}`);
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

/** Escape text for safe inclusion in HTML (names and airport data are user/email sourced). */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const NAVY = '#12355b';
const FONT = "font-family:'Segoe UI',Helvetica,Arial,sans-serif;";

/** One label/value row of a journey's detail table. */
function htmlRow(label: string, value: string, emphasize = false): string {
  const valueStyle = emphasize
    ? "padding:3px 0;font-weight:700;font-family:Consolas,'Courier New',monospace;letter-spacing:0.5px;color:#1f2933"
    : 'padding:3px 0;color:#1f2933';
  return (
    `<tr><td width="120" valign="top" style="padding:3px 12px 3px 0;color:#6b7785">${esc(label)}</td>` +
    `<td valign="top" style="${valueStyle}">${esc(value)}</td></tr>`
  );
}

function htmlSegment(s: SegmentView, index: number): string {
  const parts = [
    `<div style="font-weight:700;color:${NAVY}">${index + 1}. ${esc(s.title)}</div>`,
    `<div><span style="color:#6b7785">From:</span> ${esc(s.from)}</div>`,
    `<div><span style="color:#6b7785">To:</span> ${esc(s.to)}</div>`,
  ];
  if (s.times) parts.push(`<div style="color:#52606d">${esc(s.times)}</div>`);
  if (s.layover) parts.push(`<div style="color:#b45309;margin-top:2px">${esc(s.layover)}</div>`);
  return (
    `<div style="background:#f4f7fa;border-left:3px solid ${NAVY};padding:8px 12px;margin:8px 0">` +
    `${parts.join('')}</div>`
  );
}

function htmlJourney(j: JourneyView): string {
  const rows = j.details.map((f) => htmlRow(f.label, f.value));
  if (j.stops) rows.push(htmlRow('Stops', j.stops));

  const detailsTable = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join('')}</table>`;
  const segments = j.segments.length > 0 ? j.segments.map(htmlSegment).join('') : '';
  const extraRows = [
    ...j.extras.map((f) => htmlRow(f.label, f.value)),
    ...j.confirmations.map((f) => htmlRow(f.label, f.value, true)),
  ];
  const footer = extraRows.length > 0
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;border-top:1px solid #e4e9ef"><tr><td style="padding-top:8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${extraRows.join('')}</table></td></tr></table>`
    : '';

  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #d3dce6;border-collapse:collapse;margin:0 0 16px">` +
    `<tr><td bgcolor="${NAVY}" style="background:${NAVY};color:#ffffff;padding:9px 14px;font-size:12px;font-weight:700;letter-spacing:1px">${esc(j.heading)}</td>` +
    `<td bgcolor="${NAVY}" align="right" style="background:${NAVY};color:#cfe0f3;padding:9px 14px;font-size:13px">${esc(j.date ?? '')}</td></tr>` +
    `<tr><td colspan="2" style="padding:12px 14px">` +
    `<div style="font-size:16px;font-weight:700;color:${NAVY};margin:0 0 8px">${esc(j.carrier)}</div>` +
    `${detailsTable}${segments}${footer}</td></tr></table>`
  );
}

function renderHtml(view: ItineraryView): string {
  return (
    `<div style="${FONT}color:#1f2933;font-size:14px;line-height:1.45;max-width:600px">` +
    `<div style="font-size:22px;font-weight:700;color:${NAVY};margin:0 0 4px">${esc(view.htmlTitle)}</div>` +
    (view.travelers.length > 0
      ? `<div style="color:#52606d;margin:0 0 16px"><strong style="color:#1f2933">Travelers:</strong> ${esc(view.travelers.join(', '))}</div>`
      : '') +
    `${view.journeys.map(htmlJourney).join('')}</div>`
  );
}

/**
 * Build a plain-text itinerary suitable for pasting into an email.
 *
 * With two journeys they are titled "Outbound Journey" and "Return Journey";
 * with one it is a single "Flight"; with more, "Flight N of M". Layout avoids
 * column alignment and box drawing so it reads correctly in proportional-font
 * mail clients. Prices are deliberately omitted — this is meant to be shared.
 */
export function buildItinerary(inputs: ItineraryFlight[], options: ItineraryOptions = {}): string {
  const view = buildView(inputs, options);
  return view ? renderText(view) : '';
}

/**
 * The same itinerary as formatted HTML — a fragment of inline-styled tables
 * (no stylesheet, scripts or external assets) so it survives being pasted into
 * Gmail, Outlook and Apple Mail. Content is identical to {@link buildItinerary};
 * only the presentation differs. All text is HTML-escaped.
 */
export function buildItineraryHtml(inputs: ItineraryFlight[], options: ItineraryOptions = {}): string {
  const view = buildView(inputs, options);
  return view ? renderHtml(view) : '';
}
