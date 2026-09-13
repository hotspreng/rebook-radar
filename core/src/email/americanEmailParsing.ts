import { Airline, Cabin, FareType, PurchaseType } from '../models/common.js';
import { normalizeCabin } from './cabin.js';
import {
  RetrievedFlightSegment,
  RetrievedTrip,
  RetrievedTripLeg,
} from '../providers/AirlineProvider.js';
import { EmailMessage } from './EmailMessage.js';
import { ParsedTripEvent, TripEventType } from './TripEvent.js';

/**
 * Pure, framework-agnostic parsing for American Airlines confirmation emails.
 *
 * Tuned against real American "trip confirmation and receipt" emails from
 * `no-reply@info.email.aa.com` (subject "Your trip confirmation (ORD - OGG)").
 * The HTML-stripped body is line-oriented: an "AA <n>" line, a full weekday
 * date, then origin/destination code + city + time blocks, and a "Your
 * purchase" section with per-passenger "New ticket $…" amounts.
 *
 * The parser fails soft: an email it can't fully parse still yields its
 * confirmation number (record locator) + event type when possible, and never
 * overwrites a richer event for the same PNR during the fold.
 */

/** Any American Airlines sender (transactional + marketing), e.g.
 *  no-reply@info.email.aa.com, no-reply@aa.com. */
const AMERICAN_FROM = /@(?:[a-z0-9-]+\.)*aa\.com/i;

/** True when the sender looks like American Airlines (any address). */
export function isAmericanEmail(from: string | null | undefined): boolean {
  return !!from && AMERICAN_FROM.test(from);
}

/**
 * Classify an American email into a trip event using the SUBJECT line only.
 *   • Booking — "Your trip confirmation" / "trip to <city>" / "eTicket" /
 *               "You're confirmed" / "reservation confirmation"
 *   • Change  — "schedule change" / "your flight has changed" / "new time"
 *   • Cancel  — "… has been canceled" / "cancellation" / "refund"
 *
 * Cancellation > change > booking precedence. Marketing subjects match nothing.
 */
export function classifyAmericanEmail(
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
    /itinerary (?:has )?changed/i.test(s) ||
    /trip (?:has )?changed/i.test(s)
  ) {
    return TripEventType.Changed;
  }
  if (
    /trip confirmation/i.test(s) ||
    /travel confirmation/i.test(s) ||
    /trip to\b/i.test(s) ||
    /you(?:'|’|)re confirmed/i.test(s) ||
    /you are confirmed/i.test(s) ||
    /reservation confirmation/i.test(s) ||
    /booking confirmation/i.test(s) ||
    /confirmation (?:and receipt|number)/i.test(s) ||
    /eticket/i.test(s) ||
    /your trip\b/i.test(s)
  ) {
    return TripEventType.Booked;
  }
  return undefined;
}

/** Pull the 6-char record locator (PNR) from an American subject. A real
 *  locator mixes letters, so an all-digit token (or "ORD - OGG" route) is
 *  ignored. */
function parsePnrFromSubject(subject: string): string | undefined {
  const parens = subject.match(/\(([A-Z0-9]{6})\)/);
  if (parens && /[A-Z]/.test(parens[1]!)) return parens[1]!.toUpperCase();
  const labeled = subject.match(
    /(?:record locator|confirmation)\s*(?:code|number|#)?\s*[–\-:]?\s*([A-Z0-9]{6})\b/i,
  );
  if (labeled && /[A-Z]/i.test(labeled[1]!)) return labeled[1]!.toUpperCase();
  return undefined;
}

/** Pull the PNR from the body: "Record locator: HKQVML" /
 *  "Confirmation code HKQVML". A real record locator mixes letters (avoids
 *  all-digit ticket/AAdvantage numbers). */
function parsePnrFromBody(body: string): string | undefined {
  const m = body.match(
    /(?:record locator|confirmation\s*(?:code|number|#)?)\s*[:#]?\s*([A-Z0-9]{6})\b/i,
  );
  if (!m) return undefined;
  const token = m[1]!.toUpperCase();
  return /[A-Z]/.test(token) ? token : undefined;
}

/**
 * Parse one American email into a {@link ParsedTripEvent}. Returns `undefined`
 * when it is not a recognizable American trip email, or when a booking/change
 * email carries no parseable itinerary.
 */
export function parseAmericanEmail(message: EmailMessage): ParsedTripEvent | undefined {
  const type = classifyAmericanEmail(message.subject);
  if (!type) return undefined;

  const body = normalizeBody(message.body ?? '');

  const confirmationNumber =
    parsePnrFromSubject(message.subject ?? '') ?? parsePnrFromBody(body);
  if (!confirmationNumber) return undefined;

  const base: ParsedTripEvent = {
    type,
    emailId: message.id,
    occurredAt: message.internalDate,
    confirmationNumber,
  };

  if (type === TripEventType.Cancelled) return base;

  const trip = parseAmericanTripDetails(body, confirmationNumber);
  if (!trip) return undefined;
  return { ...base, trip };
}

/** Trim each line and drop blank lines so one field sits on one line. */
function normalizeBody(body: string): string {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** "PM"/"AM" clock like "12:20 PM" → 24-hour "12:20"; "11:21 PM" → "23:21". */
function to24(time: string): string | undefined {
  const m = time.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
  if (!m) return undefined;
  let hour = Number.parseInt(m[1]!, 10) % 12;
  if (/pm/i.test(m[3]!)) hour += 12;
  return `${String(hour).padStart(2, '0')}:${m[2]}`;
}

// ---------------------------------------------------------------------------
// Itinerary parsing
// ---------------------------------------------------------------------------

/** One flight block parsed from the itinerary. */
interface ParsedFlight {
  flightNumber: string;
  origin: string;
  destination: string;
  date: string; // ISO "YYYY-MM-DD"
  departureTime: string; // 24h "HH:mm"
  arrivalTime: string; // 24h "HH:mm"
}

/** "Thursday, January 7, 2027" (weekday + full month + day + year). */
const WEEKDAY_DATE_RE =
  /^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)[a-z]*,\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/;
/** A bare 3-letter airport code on its own line, e.g. "ORD". */
const AIRPORT_CODE_RE = /^[A-Z]{3}$/;
/** A clock time on its own line, e.g. "11:55 AM". */
const TIME_RE = /^\d{1,2}:\d{2}\s*[AP]M$/i;
/** A flight-number line, e.g. "AA 89" / "AA89". */
const FLIGHT_NO_RE = /^AA\s?(\d{1,4})$/;

/** Parse "Thursday, January 7, 2027" → ISO "2027-01-07", or undefined. */
function parseWeekdayDate(line: string): string | undefined {
  const dm = line.match(WEEKDAY_DATE_RE);
  if (!dm) return undefined;
  const month = MONTHS[dm[1]!.slice(0, 3).toLowerCase()];
  if (!month) return undefined;
  return `${dm[3]}-${month}-${dm[2]!.padStart(2, '0')}`;
}

/**
 * Parse each flight in the itinerary. American's HTML-stripped confirmations
 * put one field per line and lay each segment out as:
 *
 *   Thursday, January 7, 2027   ← date (once per travel day)
 *   ORD                         ← origin code
 *   Chicago O'Hare
 *   11:55 AM                    ← departure time
 *   AA 89                       ← flight number
 *   OGG                         ← destination code
 *   Maui Kahului
 *   5:40 PM                     ← arrival time
 *
 * The flight number sits in the MIDDLE of the block, so for each "AA <n>" line
 * we look BACKWARD for the origin code + departure time (and the most recent
 * date) and FORWARD for the destination code + arrival time. Scanning is bounded
 * by the neighbouring "AA <n>" lines so a connecting itinerary yields one flight
 * each and receipt/marketing text can't leak in.
 */
function parseFlights(body: string): ParsedFlight[] {
  const lines = body.split('\n').map((l) => l.trim());
  const flightIdx: number[] = [];
  lines.forEach((l, i) => {
    if (FLIGHT_NO_RE.test(l)) flightIdx.push(i);
  });

  const flights: ParsedFlight[] = [];
  let lastDate: string | undefined;
  for (let k = 0; k < flightIdx.length; k++) {
    const at = flightIdx[k]!;
    const beforeStart = k > 0 ? flightIdx[k - 1]! + 1 : 0;
    const afterEnd = k + 1 < flightIdx.length ? flightIdx[k + 1]! : lines.length;

    const flightNumber = `AA ${lines[at]!.match(FLIGHT_NO_RE)![1]}`;

    // Look backward from the flight line for departure time, origin code and
    // the segment date (carry the previous segment's date if this block omits
    // it, e.g. a same-day connection).
    let origin: string | undefined;
    let departureTime: string | undefined;
    let date: string | undefined;
    for (let i = at - 1; i >= beforeStart; i--) {
      const line = lines[i]!;
      if (!departureTime && TIME_RE.test(line)) departureTime = line;
      else if (!origin && AIRPORT_CODE_RE.test(line)) origin = line;
      if (!date) {
        const d = parseWeekdayDate(line);
        if (d) date = d;
      }
    }
    date ??= lastDate;

    // Look forward for the destination code and arrival time.
    let destination: string | undefined;
    let arrivalTime: string | undefined;
    for (let i = at + 1; i < afterEnd; i++) {
      const line = lines[i]!;
      if (!destination && AIRPORT_CODE_RE.test(line)) destination = line;
      else if (!arrivalTime && TIME_RE.test(line)) arrivalTime = line;
      if (destination && arrivalTime) break;
    }

    if (!date || !origin || !destination || !departureTime || !arrivalTime) continue;
    const dep24 = to24(departureTime);
    const arr24 = to24(arrivalTime);
    if (!dep24 || !arr24) continue;

    lastDate = date;
    flights.push({
      flightNumber,
      origin,
      destination,
      date,
      departureTime: dep24,
      arrivalTime: arr24,
    });
  }
  return flights;
}

const LEG_BREAK_MS = 8 * 60 * 60 * 1000;

/** Group short same-airport connections into one direction and split longer
 * stopovers or discontinuous routes into separate tracked legs. */
function groupFlightsIntoLegs(flights: ParsedFlight[]): RetrievedTripLeg[] {
  if (flights.length === 0) return [];

  const groups: ParsedFlight[][] = [[flights[0]!]];
  for (let i = 1; i < flights.length; i++) {
    const previous = flights[i - 1]!;
    const current = flights[i]!;
    const previousArrivalDate =
      previous.arrivalTime < previous.departureTime ? nextDay(previous.date) : previous.date;
    const gapMs =
      new Date(`${current.date}T${current.departureTime}:00`).getTime()
      - new Date(`${previousArrivalDate}T${previous.arrivalTime}:00`).getTime();

    if (current.origin === previous.destination && gapMs >= 0 && gapMs <= LEG_BREAK_MS) {
      groups[groups.length - 1]!.push(current);
    } else {
      groups.push([current]);
    }
  }

  return groups.map((group) => {
    const first = group[0]!;
    const last = group[group.length - 1]!;
    const segments: RetrievedFlightSegment[] = group.map((flight) => {
      const arrivalDate =
        flight.arrivalTime < flight.departureTime ? nextDay(flight.date) : flight.date;
      return {
        origin: flight.origin,
        destination: flight.destination,
        departureDateTime: `${flight.date}T${flight.departureTime}:00`,
        arrivalDateTime: `${arrivalDate}T${flight.arrivalTime}:00`,
        flightNumber: flight.flightNumber,
      };
    });
    const lastArrivalDate =
      last.arrivalTime < last.departureTime ? nextDay(last.date) : last.date;
    return {
      origin: first.origin,
      destination: last.destination,
      departureDateTime: `${first.date}T${first.departureTime}:00`,
      arrivalDateTime: `${lastArrivalDate}T${last.arrivalTime}:00`,
      segments: segments.length > 1 ? segments : undefined,
    };
  });
}

const AADVANTAGE_NAME_RE =
  /^([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+)+)\s*[-–]\s*AAdvantage/gm;
const BARE_NAME_RE = /^([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+)+)\s*\nNew ticket\b/gm;

/**
 * Parse traveler names from the "Your purchase" section. Each passenger is
 * printed either as "Name - AAdvantage® #: …" or, for a companion without a
 * loyalty number, as a bare "Name" line immediately above "New ticket".
 */
function parseAmericanTravelers(body: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string): void => {
    const full = raw.replace(/\s+/g, ' ').trim();
    const key = full.toLowerCase();
    if (full && !seen.has(key)) {
      seen.add(key);
      names.push(full);
    }
  };
  for (const m of body.matchAll(AADVANTAGE_NAME_RE)) add(m[1]!);
  for (const m of body.matchAll(BARE_NAME_RE)) add(m[1]!);
  return names;
}

/** Read the seat cabin, e.g. "Class: Economy (B)" → Economy. */
function parseAmericanCabin(body: string): Cabin {
  const m = body.match(
    /\b(Basic Economy|Premium Economy|Flagship Business|Business|Flagship First|First|Main Cabin Extra|Main Cabin|Main|Economy)\b/i,
  );
  return normalizeCabin(m?.[1]);
}

/**
 * Parse the fare. American receipts list per-passenger amounts, so we read the
 * FIRST ticket: "New ticket $238.16" + its "Taxes & carrier-imposed fees
 * $34.94" for a cash booking, or "New ticket 12,500 miles" for an AAdvantage
 * award booking (cash taxes still apply). Marketing "Earn … bonus miles" lines
 * never match because they lack the "New ticket" anchor.
 */
function parseAmericanPricing(body: string): {
  purchaseType?: PurchaseType;
  paidCashUsd?: number;
  paidPoints?: number;
  taxesAndFeesUsd?: number;
} {
  const round2 = (n: number): number => Math.round(n * 100) / 100;

  const taxMatch = body.match(
    /New ticket[\s\S]{0,80}?Taxes?\s*&?\s*carrier-imposed fees\s*\$\s*([\d,]+\.\d{2})/i,
  );
  const taxes = taxMatch ? Number.parseFloat(taxMatch[1]!.replace(/,/g, '')) : undefined;

  const milesMatch = body.match(/New ticket\s+([\d,]+)\s*(?:AAdvantage\s*)?miles/i);
  if (milesMatch) {
    return {
      purchaseType: PurchaseType.Points,
      paidPoints: Number.parseInt(milesMatch[1]!.replace(/,/g, ''), 10),
      taxesAndFeesUsd: taxes,
    };
  }

  const fareMatch = body.match(/New ticket\s*\$\s*([\d,]+\.\d{2})/i);
  if (fareMatch) {
    const base = Number.parseFloat(fareMatch[1]!.replace(/,/g, ''));
    return {
      purchaseType: PurchaseType.Cash,
      paidCashUsd: round2(base + (taxes ?? 0)),
      taxesAndFeesUsd: taxes,
    };
  }
  return {};
}

/** Build a {@link RetrievedTrip} from an American confirmation body. */
function parseAmericanTripDetails(
  body: string,
  confirmationNumber: string,
): RetrievedTrip | undefined {
  const flights = parseFlights(body);
  if (flights.length === 0) return undefined;

  const legs = groupFlightsIntoLegs(flights);
  const firstLeg = legs[0]!;

  const passengerNames = parseAmericanTravelers(body);
  const pricing = parseAmericanPricing(body);

  return {
    airline: Airline.American,
    confirmationNumber,
    passengerNames,
    origin: firstLeg.origin,
    destination: firstLeg.destination,
    departureDateTime: firstLeg.departureDateTime,
    arrivalDateTime: firstLeg.arrivalDateTime,
    segments: firstLeg.segments,
    legs: legs.length > 1 ? legs : undefined,
    fareType: FareType.Unknown,
    cabin: parseAmericanCabin(body),
    purchaseType: pricing.purchaseType,
    paidCashUsd: pricing.paidCashUsd,
    paidPoints: pricing.paidPoints,
    taxesAndFeesUsd: pricing.taxesAndFeesUsd,
  };
}

/** Add one calendar day to an ISO date ("2026-09-09" → "2026-09-10"). */
function nextDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
