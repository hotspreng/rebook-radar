import type { BusProvider, ParsedBusRide } from '../models/BusRide.js';
import type { EmailMessage } from './EmailMessage.js';
import { isoDate, labelValue, monthNumber, to24h, toLines } from './emailParsingUtils.js';
import { unwrapForwarded } from './forwardedEmail.js';

/**
 * Pure parsing for bus ticket emails (OurBus / Rally). The ticket, and the
 * "operator change" update that repeats the whole ticket, share one layout:
 * a reference code, DATE OF TRAVEL, passengers, then a boarding stop and a
 * final stop, each with a city and a time.
 */

export type BusEventType = 'booked' | 'cancelled';

export interface BusRideEvent {
  type: BusEventType;
  provider: BusProvider;
  emailId: string;
  /** When the email was sent (ms since epoch); the ordering key for folding. */
  occurredAt: number;
  ticketReference: string;
  /** Present for bookings; for cancellations only when the email described the ride. */
  ride?: ParsedBusRide;
}

const SENDER_PATTERNS: Record<BusProvider, RegExp> = {
  ourbus: /@(?:[a-z0-9-]+\.)*(?:ourbus\.com|rally\.co)\b/i,
};

/** Which bus company sent this `From` header, if any. */
export function busProviderFor(from: string | null | undefined): BusProvider | undefined {
  if (!from) return undefined;
  return (Object.keys(SENDER_PATTERNS) as BusProvider[]).find((p) => SENDER_PATTERNS[p].test(from));
}

export function isBusEmail(from: string | null | undefined): boolean {
  return busProviderFor(from) !== undefined;
}

/**
 * Gmail searches that find each company's ticket emails. The sender is matched
 * exactly first; the domain-wide query only runs when that finds nothing.
 * Forwards come from the relative's address, so they are found by subject.
 */
export const BUS_EMAIL_QUERIES: { provider: BusProvider | 'forwarded'; primary: string; fallback?: string }[] = [
  {
    provider: 'ourbus',
    primary: 'from:mailadmin@ourbus.com',
    fallback: 'from:ourbus.com subject:(ticket OR receipt OR trip OR booking OR cancel OR cancelled OR canceled)',
  },
  {
    provider: 'forwarded',
    primary: 'subject:(fwd OR fw) (ourbus OR "ticket and receipt")',
  },
];

const CANCELLATION_SUBJECT = /\bcancel(?:l?ed|lation)\b/i;
const TIME_ONLY = /^\d{1,2}:\d{2}\s*[AaPp]\.?[Mm]\.?$/;
const STOP_HEADER = /^(.+?)\s+(\d{1,2}:\d{2}\s*[AaPp]\.?[Mm]\.?)$/;
/** Lines that end a stop's description. */
const STOP_END = /^(?:please arrive|stop details|directions to stop|general information|okay with|track bus|cancel\b|reschedule)/i;
const NAME_LINE = /^[A-Za-z][A-Za-z .'-]{2,}$/;

interface Stop {
  city: string;
  time: string;
  description?: string;
}

/** A time on its own line belongs to the city line before it. */
function joinTimes(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (TIME_ONLY.test(line) && out.length > 0 && !TIME_ONLY.test(out[out.length - 1]!) && !STOP_HEADER.test(out[out.length - 1]!)) {
      out[out.length - 1] = `${out[out.length - 1]} ${line}`;
    } else out.push(line);
  }
  return out;
}

function readStops(lines: string[], vehicle: string | undefined, from: number): { stops: Stop[]; firstAt: number } {
  const stops: Stop[] = [];
  let firstAt = -1;
  for (let i = from; i < lines.length; i += 1) {
    const header = STOP_HEADER.exec(lines[i]!);
    // A stop header is "City, ST 02:15 PM"; ordinary sentences also can end in a time.
    if (!header || !/^[A-Za-z][A-Za-z .'-]*(?:,\s*[A-Za-z]{2})?$/.test(header[1]!) || STOP_END.test(lines[i]!)) continue;
    const time = to24h(header[2]!);
    if (!time) continue;
    if (firstAt < 0) firstAt = i;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j]!;
      if (STOP_END.test(line) || STOP_HEADER.test(line)) break;
      if (vehicle && line.toLowerCase() === vehicle.toLowerCase()) continue;
      body.push(line);
    }
    stops.push({ city: header[1]!.trim(), time, description: body.join(' ') || undefined });
  }
  return { stops, firstAt };
}

function passengerNames(lines: string[], from: number, until: number): string[] {
  const names: string[] = [];
  for (const raw of lines.slice(from, until)) {
    const line = raw
      .replace(/^\d+\s+/, '')
      .replace(/\s*primary passenger$/i, '')
      .replace(/\s*\+?\d[\d\s().-]{6,}$/, '')
      .trim();
    if (!/passenger/i.test(line) && NAME_LINE.test(line) && !names.includes(line)) names.push(line);
  }
  return names;
}

/** "Ivy Tours & Travels Inc", from the line that names who runs the bus now. */
function operatorOf(text: string): string | undefined {
  const now = text.match(/^The transportation is provided by\s+(.+?)\.?\s*$/im)?.[1];
  if (now) return now.trim();
  const change = text.replace(/\s+/g, ' ').match(/bus operator from .+? to (.+?) for your/i)?.[1];
  return change?.trim();
}

function travelDate(text: string): string | undefined {
  const m = text.match(/DATE OF TRAVEL\s*:?\s*(?:[A-Za-z]{3,9},\s*)?([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/i);
  const month = m && monthNumber(m[1]!);
  return m && month ? isoDate(Number(m[3]), month, Number(m[2])) : undefined;
}

function addDay(date: string): string {
  const d = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + 1));
  return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function parseOurBus(m: EmailMessage, rawLines: string[]): { ticketReference?: string; ride?: ParsedBusRide } {
  const lines = joinTimes(rawLines);
  const text = lines.join('\n');
  const reference = (labelValue(lines, /ticket reference code/) ?? text.match(/Ticket Reference Code\s*:?\s*([A-Z0-9]+)/i)?.[1])
    ?.trim()
    .toUpperCase();
  const ticketReference = reference && /^[A-Z0-9]{5,10}$/.test(reference) ? reference : undefined;

  const date = travelDate(text);
  const vehicle = text.match(/Your ride will be an?\s+([^\n]+)/i)?.[1]?.trim();
  const passengersAt = lines.findIndex((l) => /^passenger details$/i.test(l));
  const { stops, firstAt } = readStops(lines, vehicle, 0);
  if (!ticketReference || !date || stops.length < 2) return { ticketReference };

  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  const arrivalDate = last.time < first.time ? addDay(date) : date;
  return {
    ticketReference,
    ride: {
      provider: 'ourbus',
      ticketReference,
      departureAt: `${date}T${first.time}:00`,
      arrivalAt: `${arrivalDate}T${last.time}:00`,
      departureCity: first.city,
      departureStop: first.description,
      arrivalCity: last.city,
      arrivalStop: last.description,
      vehicle,
      operator: operatorOf(text),
      passengerNames: passengersAt >= 0 && firstAt > passengersAt ? passengerNames(lines, passengersAt + 1, firstAt) : [],
      emailId: m.id,
      bookedAt: new Date(m.internalDate).toISOString(),
    },
  };
}

/**
 * Parse one email into a bus event: a booking (a ticket or an update that
 * repeats it), or a cancellation. Returns nothing for marketing mail.
 */
export function parseBusEmail(message: EmailMessage): BusRideEvent[] {
  const original = unwrapForwarded(message);
  const provider = busProviderFor(original.from);
  if (!provider) return [];

  const outcome = parseOurBus(original, toLines(original.body ?? ''));
  if (!outcome.ticketReference) return [];

  const cancelled = CANCELLATION_SUBJECT.test(original.subject ?? '');
  if (!cancelled && !outcome.ride) return [];

  return [
    {
      type: cancelled ? 'cancelled' : 'booked',
      provider,
      emailId: message.id,
      occurredAt: original.internalDate,
      ticketReference: outcome.ticketReference,
      ride: outcome.ride,
    },
  ];
}
