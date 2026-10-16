import { AIRLINE_LABELS, Airline, CABIN_LABELS, Cabin } from '../models/common.js';
import type { Airport, Flight, FlightSegment } from '../models/Flight.js';
import { operatingAirline } from '../models/Flight.js';

/** One tracked flight plus the traveler it belongs to. */
export interface ItineraryFlight {
  flight: Flight;
  passengerName: string;
}

export interface ItineraryOptions {
  /** Heading printed at the top. Defaults to "FLIGHT ITINERARY". */
  title?: string;
  /** Include confirmation numbers. Defaults to true. */
  includeConfirmation?: boolean;
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

/** "Chicago O'Hare (ORD)" when a name is known, otherwise just "ORD". */
function formatAirport(airport: Airport): string {
  return airport.name ? `${airport.name} (${airport.code})` : airport.code;
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
  confirmations: { number: string; passengers: string[] }[];
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
    }
    if (!journey.passengers.includes(passengerName)) journey.passengers.push(passengerName);

    const number = flight.confirmationNumber?.trim();
    if (number) {
      let conf = journey.confirmations.find((c) => c.number === number);
      if (!conf) {
        conf = { number, passengers: [] };
        journey.confirmations.push(conf);
      }
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

function describeJourney(journey: Journey, heading: string, allPassengers: string[], includeConfirmation: boolean): string[] {
  const { flight } = journey;
  const lines: string[] = [heading];

  const departs = parseLocal(flight.departureDateTime);
  const arrives = parseLocal(flight.arrivalDateTime);
  const segments = segmentsOf(flight);
  const isConnection = segments.length > 1;

  if (departs) lines.push(formatDay(departs));
  lines.push(carrierName(flight));

  // A nonstop's flight number rides on the route line; a connection lists each
  // segment's flight number in the breakdown below instead.
  const nonstopNumber = !isConnection && segments[0]!.flightNumber ? ` (${segments[0]!.flightNumber})` : '';
  lines.push(`${formatAirport(flight.route.origin)} → ${formatAirport(flight.route.destination)}${nonstopNumber}`);
  if (departs) lines.push(`Departs: ${formatTime(departs)}`);
  if (arrives && departs) lines.push(`Arrives: ${formatEndpoint(arrives, departs)}`);
  if (flight.durationMinutes != null && flight.durationMinutes > 0) {
    lines.push(`Duration: ${formatDuration(flight.durationMinutes)}`);
  }

  if (isConnection) {
    const stopCodes = segments.slice(0, -1).map((s) => s.destination.code);
    lines.push(`Stops: ${stopCodes.length} (${stopCodes.join(', ')})`);
    lines.push('Connection details:');
    segments.forEach((segment, i) => {
      const dep = parseLocal(segment.departureDateTime);
      const arr = parseLocal(segment.arrivalDateTime);
      const label = segment.flightNumber ? `${segment.flightNumber}: ` : '';
      lines.push(`${i + 1}. ${label}${segment.origin.code} → ${segment.destination.code}`);
      if (dep) {
        const arrival = arr ? ` · Arrives ${formatEndpoint(arr, dep)}` : '';
        lines.push(`   Departs ${formatTime(dep)}${arrival}`);
      }
      const nextDep = parseLocal(segments[i + 1]?.departureDateTime);
      if (arr && nextDep) {
        const layover = minutesBetween(arr, nextDep);
        if (layover > 0) lines.push(`   Layover in ${segment.destination.code}: ${formatDuration(layover)}`);
      }
    });
  }

  if (flight.cabin && flight.cabin !== Cabin.Unknown) lines.push(`Cabin: ${CABIN_LABELS[flight.cabin]}`);

  // Only name travelers on a journey when it carries fewer than the whole party.
  const everyoneFlies = allPassengers.every((p) => journey.passengers.includes(p));
  if (!everyoneFlies) lines.push(`Travelers: ${journey.passengers.join(', ')}`);

  if (includeConfirmation && journey.confirmations.length > 0) {
    const bookedVia = operatingAirline(flight) !== flight.airline ? ` (booked via ${AIRLINE_LABELS[flight.airline] ?? flight.airline})` : '';
    if (journey.confirmations.length === 1) {
      lines.push(`Confirmation: ${journey.confirmations[0]!.number}${bookedVia}`);
    } else {
      const each = journey.confirmations.map((c) => `${c.number} (${c.passengers.join(', ')})`).join('; ');
      lines.push(`Confirmations: ${each}${bookedVia}`);
    }
  }

  return lines;
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
  const journeys = groupJourneys(inputs);
  if (journeys.length === 0) return '';

  const includeConfirmation = options.includeConfirmation ?? true;
  const allPassengers: string[] = [];
  for (const journey of journeys) {
    for (const name of journey.passengers) if (!allPassengers.includes(name)) allPassengers.push(name);
  }

  const lines: string[] = [options.title ?? 'FLIGHT ITINERARY'];
  lines.push(`Travelers: ${allPassengers.join(', ')}`);

  journeys.forEach((journey, index) => {
    lines.push('');
    lines.push(...describeJourney(journey, journeyHeading(index, journeys.length), allPassengers, includeConfirmation));
  });

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}
