import { Airline, Cabin, FareType, PurchaseType } from '../models/common.js';
import { normalizeCabin } from './cabin.js';
import {
  RetrievedFlightSegment,
  RetrievedTrip,
  RetrievedTripLeg,
} from '../providers/AirlineProvider.js';
import { EmailMessage } from './EmailMessage.js';
import { ParsedTripEvent, TripEventType } from './TripEvent.js';

/** Air Canada transactional and service-email senders. */
const AIR_CANADA_FROM = /@(?:[a-z0-9-]+\.)*aircanada\.ca/i;

export function isAirCanadaEmail(from: string | null | undefined): boolean {
  return !!from && AIR_CANADA_FROM.test(from);
}

export function classifyAirCanadaEmail(
  subject: string | null | undefined,
): TripEventType | undefined {
  const value = subject ?? '';
  if (/\bcancel(?:l?ed|lation)?\b/i.test(value) || /\brefund(?:ed)?\b/i.test(value)) {
    return TripEventType.Cancelled;
  }
  if (/schedule change|itinerary (?:has )?changed|flight (?:has )?changed|new (?:departure )?time/i.test(value)) {
    return TripEventType.Changed;
  }
  if (/booking confirmation|booking reference|itinerary\/receipt|your booking/i.test(value)) {
    return TripEventType.Booked;
  }
  return undefined;
}

function parseConfirmationNumber(subject: string, body: string): string | undefined {
  const subjectMatch = subject.match(/booking reference\s*:\s*([A-Z0-9]{6})\b/i);
  if (subjectMatch) return subjectMatch[1]!.toUpperCase();

  const labeled = body.match(/(?:booking reference|booking confirmation)\s*:?\s*([A-Z0-9]{6})\b/i);
  if (labeled) return labeled[1]!.toUpperCase();

  const issued = body.match(/^([A-Z0-9]{6})\s+Issued\b/im);
  return issued?.[1]?.toUpperCase();
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

function parseDate(value: string): string | undefined {
  const match = value.match(/(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)?\s*(\d{1,2})\s+([A-Za-z]{3,9}),?\s+(\d{4})/i);
  if (!match) return undefined;
  const month = MONTHS[match[2]!.slice(0, 3).toLowerCase()];
  if (!month) return undefined;
  return `${match[3]}-${month}-${match[1]!.padStart(2, '0')}`;
}

function normalizeTime(value: string): string | undefined {
  const match = value.match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
  if (!match) return undefined;
  let hour = Number.parseInt(match[1]!, 10);
  if (match[3]) {
    hour %= 12;
    if (/pm/i.test(match[3])) hour += 12;
  }
  if (hour > 23) return undefined;
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

function nextDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

interface ParsedSegment {
  origin: string;
  destination: string;
  departureDateTime: string;
  arrivalDateTime: string;
  flightNumber?: string;
  durationMinutes?: number;
}

function parseSegments(body: string): ParsedSegment[] {
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const starts: number[] = [];
  lines.forEach((line, index) => {
    if (/^(?:Departure|Return)\s*[•·-]\s*/i.test(line)) starts.push(index);
  });

  const segments: ParsedSegment[] = [];
  for (let blockIndex = 0; blockIndex < starts.length; blockIndex++) {
    const start = starts[blockIndex]!;
    const end = blockIndex + 1 < starts.length ? starts[blockIndex + 1]! : lines.length;
    const date = parseDate(lines[start]!);
    if (!date) continue;

    let origin: string | undefined;
    let destination: string | undefined;
    let departureTime: string | undefined;
    let arrivalTime: string | undefined;
    let flightNumber: string | undefined;
    let durationMinutes: number | undefined;

    for (let index = start + 1; index < end; index++) {
      const line = lines[index]!;
      if (!origin || !destination) {
        const codes = [...line.matchAll(/\b([A-Z]{3})\b/g)].map((match) => match[1]!);
        if (codes.length >= 2) {
          [origin, destination] = codes;
          continue;
        }
      }

      if (!departureTime || !arrivalTime) {
        const times = [...line.matchAll(/\b(\d{1,2}:\d{2}(?:\s*[AP]M)?)\b/gi)]
          .map((match) => normalizeTime(match[1]!))
          .filter((time): time is string => !!time);
        if (times.length >= 2) {
          [departureTime, arrivalTime] = times;
          continue;
        }
      }

      if (!flightNumber) {
        const flight = line.match(/^([A-Z0-9]{2})\s*(\d{1,4})\s*[•·-]/);
        if (flight) flightNumber = `${flight[1]} ${flight[2]}`;
      }

      if (durationMinutes == null) {
        const duration = line.match(/Duration:\s*(?:(\d+)\s*hr)?\s*(?:(\d+)\s*m)?/i);
        if (duration && (duration[1] || duration[2])) {
          durationMinutes = Number(duration[1] ?? 0) * 60 + Number(duration[2] ?? 0);
        }
      }
    }

    if (!origin || !destination || !departureTime || !arrivalTime) continue;
    const arrivalDate = arrivalTime < departureTime ? nextDay(date) : date;
    segments.push({
      origin,
      destination,
      departureDateTime: `${date}T${departureTime}:00`,
      arrivalDateTime: `${arrivalDate}T${arrivalTime}:00`,
      flightNumber,
      durationMinutes,
    });
  }
  return segments;
}

const LEG_BREAK_MS = 8 * 60 * 60 * 1000;

function groupSegmentsIntoLegs(segments: ParsedSegment[]): RetrievedTripLeg[] {
  if (segments.length === 0) return [];
  const groups: ParsedSegment[][] = [[segments[0]!]];
  for (let index = 1; index < segments.length; index++) {
    const previous = segments[index - 1]!;
    const current = segments[index]!;
    const gap = Date.parse(current.departureDateTime) - Date.parse(previous.arrivalDateTime);
    if (current.origin === previous.destination && gap >= 0 && gap <= LEG_BREAK_MS) {
      groups[groups.length - 1]!.push(current);
    } else {
      groups.push([current]);
    }
  }

  return groups.map((group) => {
    const first = group[0]!;
    const last = group[group.length - 1]!;
    const flightSegments: RetrievedFlightSegment[] = group.map((segment) => ({
      origin: segment.origin,
      destination: segment.destination,
      departureDateTime: segment.departureDateTime,
      arrivalDateTime: segment.arrivalDateTime,
      flightNumber: segment.flightNumber,
    }));
    return {
      origin: first.origin,
      destination: last.destination,
      departureDateTime: first.departureDateTime,
      arrivalDateTime: last.arrivalDateTime,
      durationMinutes: group.length === 1 ? first.durationMinutes : undefined,
      segments: flightSegments,
    };
  });
}

function parseTravelers(body: string): string[] {
  const section = body.match(/Passengers\s*\n([\s\S]*?)(?:\nSeats\b|\nPurchase Summary\b)/i)?.[1] ?? '';
  const names: string[] = [];
  for (const match of section.matchAll(/^([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+)+)\s*\nTicket\s*#:/gim)) {
    names.push(match[1]!.replace(/\s+/g, ' ').trim());
  }
  return [...new Set(names)];
}

function parseCabin(body: string): Cabin {
  const explicit = body.match(/Cabin:\s*([^\n]+)/i)?.[1];
  if (explicit) return normalizeCabin(explicit);
  return normalizeCabin(body.match(/(?:Departure|Return)[^\n]*\n([^\n]+)/i)?.[1]);
}

function parsePoints(body: string): number | undefined {
  const match = body.match(/Grand total\s+([\d,]+)\s*pts\b/i)
    ?? body.match(/Aeroplan[^\n]*?([\d,]+)\s*pts\b/i);
  return match ? Number.parseInt(match[1]!.replace(/,/g, ''), 10) : undefined;
}

function parseCadSurcharge(body: string): number | undefined {
  const match = body.match(/Grand total\s+[\d,]+\s*pts\s*\+\s*CAD\s*\$\s*([\d,]+\.\d{2})/i)
    ?? body.match(/CAD\s*\$\s*([\d,]+\.\d{2})/i);
  return match ? Number.parseFloat(match[1]!.replace(/,/g, '')) : undefined;
}

function parseTrip(body: string, confirmationNumber: string): RetrievedTrip | undefined {
  const segments = parseSegments(body);
  const legs = groupSegmentsIntoLegs(segments);
  if (legs.length === 0) return undefined;
  const first = legs[0]!;
  const points = parsePoints(body);
  const cadSurcharge = parseCadSurcharge(body);

  return {
    airline: Airline.AirCanada,
    confirmationNumber,
    passengerNames: parseTravelers(body),
    origin: first.origin,
    destination: first.destination,
    departureDateTime: first.departureDateTime,
    arrivalDateTime: first.arrivalDateTime,
    durationMinutes: first.durationMinutes,
    segments: first.segments,
    legs: legs.length > 1 ? legs : undefined,
    fareType: FareType.Unknown,
    cabin: parseCabin(body),
    purchaseType: points != null ? PurchaseType.Points : undefined,
    paidPoints: points,
    foreignTaxesAndFees: cadSurcharge == null
      ? undefined
      : { amount: cadSurcharge, currency: 'CAD' },
  };
}

export function parseAirCanadaEmail(message: EmailMessage): ParsedTripEvent | undefined {
  const type = classifyAirCanadaEmail(message.subject);
  if (!type) return undefined;

  const body = message.body ?? '';
  const confirmationNumber = parseConfirmationNumber(message.subject ?? '', body);
  if (!confirmationNumber) return undefined;

  const base: ParsedTripEvent = {
    type,
    emailId: message.id,
    occurredAt: message.internalDate,
    confirmationNumber,
  };
  if (type === TripEventType.Cancelled) return base;

  const trip = parseTrip(body, confirmationNumber);
  return trip ? { ...base, trip } : undefined;
}
