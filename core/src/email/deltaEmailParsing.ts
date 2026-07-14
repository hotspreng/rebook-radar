import { Airline, FareType, PurchaseType } from '../models/common.js';
import {
  RetrievedFlightSegment,
  RetrievedTrip,
  RetrievedTripLeg,
} from '../providers/AirlineProvider.js';
import { EmailMessage } from './EmailMessage.js';
import { ParsedTripEvent, TripEventType } from './TripEvent.js';

/**
 * Pure, framework-agnostic parsing for Delta Air Lines confirmation emails.
 *
 * Delta sends transactional mail from the `delta.com` family of senders
 * (e.g. `DeltaAirLines@e.delta.com`). The reliable source is the flight
 * confirmation / eTicket receipt, which carries the 6-character confirmation
 * number, each operated segment, the traveler list, and a total in either cash
 * ("$318.60") or SkyMiles ("25,000 miles + $5.60").
 *
 * IMPORTANT — these regexes are a best-effort starting point modeled on the
 * United parser. Delta's exact body layout/whitespace should be verified against
 * a real email (enable Debug logging, import, inspect the dumped body) and the
 * SEGMENT / traveler / pricing patterns tuned accordingly. The parser fails soft:
 * an email it can't fully parse still yields its confirmation number + event
 * type when possible, and never corrupts a richer event for the same PNR.
 */

/** Any Delta sender (transactional + marketing), e.g. DeltaAirLines@e.delta.com. */
const DELTA_FROM = /@(?:[a-z0-9-]+\.)*delta\.com/i;

/** True when the sender looks like Delta Air Lines (any address). */
export function isDeltaEmail(from: string | null | undefined): boolean {
  return !!from && DELTA_FROM.test(from);
}

/**
 * Classify a Delta email into a trip event using the SUBJECT line only.
 *   • Booking — "Your Delta flight confirmation (HGKZPQ)" / "Flight Receipt …"
 *               "eTicket Itinerary/Receipt" / "Your trip to Atlanta"
 *   • Change  — "schedule change" / "your flight has changed" / "new time"
 *   • Cancel  — "… has been canceled" / "cancellation" / "refund"
 *
 * Cancellation > change > booking precedence.
 */
export function classifyDeltaEmail(
  subject: string | null | undefined,
): TripEventType | undefined {
  const s = subject ?? '';
  if (/\bcancel(?:l?ed|lation)?\b/i.test(s) || /\brefund(?:ed)?\b/i.test(s)) {
    return TripEventType.Cancelled;
  }
  if (
    /schedule change/i.test(s) ||
    /flight has changed/i.test(s) ||
    /your flight (?:time )?changed/i.test(s) ||
    /new (?:departure )?time/i.test(s) ||
    /itinerary (?:has )?changed/i.test(s)
  ) {
    return TripEventType.Changed;
  }
  if (
    /flight confirmation/i.test(s) ||
    /flight receipt/i.test(s) ||
    /eticket/i.test(s) ||
    /itinerary and receipt/i.test(s) ||
    /booking confirmation/i.test(s) ||
    /reservation confirmation/i.test(s) ||
    /your trip to/i.test(s)
  ) {
    return TripEventType.Booked;
  }
  return undefined;
}

/** Pull the 6-char confirmation number (PNR) from a Delta subject. */
function parsePnrFromSubject(subject: string): string | undefined {
  // "… confirmation (HGKZPQ)", "Confirmation #: HGKZPQ", "receipt - HGKZPQ".
  const parens = subject.match(/\(([A-Z0-9]{6})\)/);
  if (parens) return parens[1]!.toUpperCase();
  const labeled = subject.match(/confirmation\s*(?:number|#|code)?\s*[–\-:]?\s*([A-Z0-9]{6})\b/i);
  if (labeled) return labeled[1]!.toUpperCase();
  const trailing = subject.match(/[–\-]\s*([A-Z0-9]{6})\b/);
  if (trailing) return trailing[1]!.toUpperCase();
  // Last resort: a standalone 6-char record locator that has both a letter and a
  // digit and is not a Delta flight number (DL1234).
  for (const m of subject.matchAll(/\b([A-Z0-9]{6})\b/g)) {
    const token = m[1]!.toUpperCase();
    if (/^DL\d/.test(token)) continue;
    if (/[A-Z]/.test(token) && /\d/.test(token)) return token;
  }
  return undefined;
}

/** Pull the PNR from the body ("Confirmation #: HGKZPQ" / "Confirmation Number HGKZPQ"). */
function parsePnrFromBody(body: string): string | undefined {
  const m = body.match(/Confirmation\s*(?:number|#|code)?\s*[:#]?\s*([A-Z0-9]{6})\b/i);
  return m ? m[1]!.toUpperCase() : undefined;
}

/**
 * Parse one Delta email into a {@link ParsedTripEvent}. Returns `undefined`
 * when it is not a recognizable Delta trip email, or when a booking/change email
 * carries no parseable itinerary (so an empty notification never overwrites a
 * richer receipt during the fold).
 */
export function parseDeltaEmail(message: EmailMessage): ParsedTripEvent | undefined {
  const type = classifyDeltaEmail(message.subject);
  if (!type) return undefined;

  const confirmationNumber =
    parsePnrFromSubject(message.subject ?? '') ?? parsePnrFromBody(message.body ?? '');
  if (!confirmationNumber) return undefined;

  const base: ParsedTripEvent = {
    type,
    emailId: message.id,
    occurredAt: message.internalDate,
    confirmationNumber,
  };

  if (type === TripEventType.Cancelled) return base;

  const trip = parseDeltaTripDetails(message.body ?? '', confirmationNumber);
  if (!trip) return undefined;
  return { ...base, trip };
}

/** One operated segment parsed from a Delta email. */
interface ParsedSegment {
  flightNumber: string;
  origin: string;
  originName: string;
  destination: string;
  destinationName: string;
  departureDateTime: string;
  arrivalDateTime: string;
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/**
 * Parse a date + time into a naive local ISO string, e.g.
 * "Apr 10, 2026" / "April 10, 2026" / "10-Apr-2026" + "6:00 AM"
 * → "2026-04-10T06:00:00". Returns "" when either part can't be read.
 */
function toIso(dateText: string, timeText: string): string {
  let month: string | undefined;
  let day: string | undefined;
  let year: string | undefined;

  const named = dateText.match(/([A-Za-z]{3,9})\s*\.?\s*(\d{1,2}),?\s*(\d{4})/); // Apr 10, 2026
  const dashed = dateText.match(/(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{4})/); // 10-Apr-2026
  if (named) {
    month = MONTHS[named[1]!.slice(0, 3).toLowerCase()];
    day = named[2]!.padStart(2, '0');
    year = named[3]!;
  } else if (dashed) {
    month = MONTHS[dashed[2]!.slice(0, 3).toLowerCase()];
    day = dashed[1]!.padStart(2, '0');
    year = dashed[3]!;
  }
  const tm = timeText.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
  if (!month || !day || !year || !tm) return '';
  let hour = Number.parseInt(tm[1]!, 10) % 12;
  if (/pm/i.test(tm[3]!)) hour += 12;
  return `${year}-${month}-${day}T${String(hour).padStart(2, '0')}:${tm[2]}:00`;
}

/**
 * Match a single flight block in a Delta confirmation/receipt. Delta typically
 * renders a "Departs / Arrives" pair with a city name + code + date + time,
 * followed by the operating flight ("Delta 1234" / "DL 1234"). Tolerant of the
 * blank-line padding Delta inserts.
 *
 *   Departs  Atlanta, GA (ATL)
 *   Fri, Apr 10, 2026  6:00 AM
 *   Arrives  New York-JFK, NY (JFK)
 *   Fri, Apr 10, 2026  8:20 AM
 *   Delta 1234
 */
const SEGMENT_RE =
  /Departs?\b[:\s]*([^()\n]+?)\s*\(([A-Z]{3})\)[\s\S]*?((?:[A-Za-z]{3,9}\s*\.?\s*\d{1,2},?\s*\d{4})|(?:\d{1,2}[-\s][A-Za-z]{3,9}[-\s]\d{4}))[^\n]*?(\d{1,2}:\d{2}\s*[AP]M)[\s\S]*?Arrives?\b[:\s]*([^()\n]+?)\s*\(([A-Z]{3})\)[\s\S]*?((?:[A-Za-z]{3,9}\s*\.?\s*\d{1,2},?\s*\d{4})|(?:\d{1,2}[-\s][A-Za-z]{3,9}[-\s]\d{4}))[^\n]*?(\d{1,2}:\d{2}\s*[AP]M)[\s\S]*?(?:Delta|DL)\s*(\d{1,4})\b/gi;

/** Extract operated segments from a Delta email body, in itinerary order. */
function parseDeltaSegments(body: string): ParsedSegment[] {
  const segments: ParsedSegment[] = [];
  for (const m of body.matchAll(SEGMENT_RE)) {
    const [
      ,
      origName,
      origCode,
      depDate,
      depTime,
      destName,
      destCode,
      arrDate,
      arrTime,
      flightNum,
    ] = m;
    const departureDateTime = toIso(depDate!, depTime!);
    if (!departureDateTime) continue;
    segments.push({
      flightNumber: `DL ${flightNum}`,
      origin: origCode!.toUpperCase(),
      originName: origName!.trim(),
      destination: destCode!.toUpperCase(),
      destinationName: destName!.trim(),
      departureDateTime,
      arrivalDateTime: toIso(arrDate!, arrTime!),
    });
  }
  return segments;
}

const LEG_BREAK_MS = 8 * 60 * 60 * 1000; // > 8h on the ground = a new leg, not a connection.

/**
 * Group operated segments into flown legs. Consecutive segments where the next
 * departs the airport the previous arrived at, within ~8 hours, are a connection
 * (one leg); a longer gap or a different airport starts a new leg (e.g. the
 * return direction of a round trip).
 */
function groupSegmentsIntoLegs(segments: ParsedSegment[]): RetrievedTripLeg[] {
  if (segments.length === 0) return [];
  const legs: ParsedSegment[][] = [[segments[0]!]];
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1]!;
    const cur = segments[i]!;
    const connects = cur.origin === prev.destination;
    const gapMs =
      prev.arrivalDateTime && cur.departureDateTime
        ? new Date(cur.departureDateTime).getTime() - new Date(prev.arrivalDateTime).getTime()
        : Number.POSITIVE_INFINITY;
    if (connects && gapMs >= 0 && gapMs <= LEG_BREAK_MS) {
      legs[legs.length - 1]!.push(cur);
    } else {
      legs.push([cur]);
    }
  }
  return legs.map((segs) => {
    const firstSeg = segs[0]!;
    const lastSeg = segs[segs.length - 1]!;
    const retSegments: RetrievedFlightSegment[] = segs.map((s) => ({
      origin: s.origin,
      destination: s.destination,
      originName: s.originName,
      destinationName: s.destinationName,
      departureDateTime: s.departureDateTime,
      arrivalDateTime: s.arrivalDateTime || undefined,
      flightNumber: s.flightNumber,
    }));
    return {
      origin: firstSeg.origin,
      destination: lastSeg.destination,
      departureDateTime: firstSeg.departureDateTime,
      arrivalDateTime: lastSeg.arrivalDateTime || undefined,
      segments: retSegments.length > 1 ? retSegments : undefined,
    };
  });
}

/** Title-case a traveler name token, e.g. "JOSHUA" → "Joshua". */
function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Parse the traveler list. Delta commonly lists passengers as "LAST/FIRST" in a
 * receipt, or "Passenger  First Last" lines. Emitted as "First Last" so the
 * importer matches a stored passenger by first-initial + last name.
 */
function parseDeltaTravelers(body: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const add = (full: string): void => {
    const key = full.toLowerCase();
    if (full.trim() && !seen.has(key)) {
      seen.add(key);
      names.push(full);
    }
  };

  // "LAST/FIRST" (eTicket receipt style), scoped to a Passenger/Traveler block.
  const start = body.search(/passenger|traveler/i);
  const region = start >= 0 ? body.slice(start) : body;
  for (const m of region.matchAll(/\b([A-Z]{2,})\/([A-Z]{2,})\b/g)) {
    add(`${titleCase(m[2]!)} ${titleCase(m[1]!)}`);
  }
  if (names.length > 0) return names;

  // "Passenger  Emily Sprenger" / "Traveler 1  Emily Sprenger".
  for (const m of body.matchAll(
    /(?:Passenger|Traveler)s?\b[ \t]*\d*[ \t:]*([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+)+)/g,
  )) {
    add(m[1]!.trim().replace(/\s+/g, ' '));
  }
  return names;
}

/**
 * Parse the fare from a Delta email body.
 *   • Award — "25,000 miles + $5.60" / "SkyMiles: 25,000" (+ a "$" taxes line)
 *   • Cash  — "Total: $318.60" / "Total Charged $318.60"
 * Reservation-wide totals are divided by the passenger count so each tracked
 * traveler gets a per-passenger figure.
 */
function parseDeltaPricing(
  body: string,
  passengerCount: number,
): {
  purchaseType?: PurchaseType;
  paidCashUsd?: number;
  paidPoints?: number;
  taxesAndFeesUsd?: number;
} {
  const count = Math.max(1, passengerCount);

  const award = body.match(/([\d,]+)\s*(?:miles|skymiles)\b(?:[^$]*\$\s*([\d,]+(?:\.\d{2})?))?/i);
  if (award) {
    const miles = Number.parseInt(award[1]!.replace(/,/g, ''), 10) / count;
    const taxes = award[2] ? Number.parseFloat(award[2].replace(/,/g, '')) / count : undefined;
    return {
      purchaseType: PurchaseType.Points,
      paidPoints: Math.round(miles),
      taxesAndFeesUsd: taxes != null ? Math.round(taxes * 100) / 100 : undefined,
    };
  }

  const total = body.match(/Total(?:\s*Charged|\s*Cost|\s*Price)?\s*[:]?\s*\$\s*([\d,]+(?:\.\d{2})?)/i);
  if (total) {
    const amount = Number.parseFloat(total[1]!.replace(/,/g, '')) / count;
    return { purchaseType: PurchaseType.Cash, paidCashUsd: Math.round(amount * 100) / 100 };
  }

  return {};
}

/** Build a {@link RetrievedTrip} from a Delta confirmation/receipt body. */
function parseDeltaTripDetails(body: string, confirmationNumber: string): RetrievedTrip | undefined {
  const segments = parseDeltaSegments(body);
  if (segments.length === 0) return undefined;

  const legs = groupSegmentsIntoLegs(segments);
  const first = legs[0];
  if (!first) return undefined;

  const passengerNames = parseDeltaTravelers(body);
  const pricing = parseDeltaPricing(body, passengerNames.length);

  return {
    airline: Airline.Delta,
    confirmationNumber,
    passengerNames,
    origin: first.origin,
    destination: first.destination,
    departureDateTime: first.departureDateTime,
    arrivalDateTime: first.arrivalDateTime,
    durationMinutes: first.durationMinutes,
    segments: first.segments,
    fareType: FareType.Unknown,
    purchaseType: pricing.purchaseType,
    paidCashUsd: pricing.paidCashUsd,
    paidPoints: pricing.paidPoints,
    taxesAndFeesUsd: pricing.taxesAndFeesUsd,
    legs: legs.length > 1 ? legs : undefined,
  };
}
