import { Airline, FareType, PurchaseType } from '../models/common.js';
import {
  RetrievedFlightSegment,
  RetrievedTrip,
} from '../providers/AirlineProvider.js';
import { EmailMessage } from './EmailMessage.js';
import { ParsedTripEvent, TripEventType } from './TripEvent.js';

/**
 * Pure, framework-agnostic parsing for Delta Air Lines confirmation emails.
 *
 * Tuned against real Delta "Award Receipt" emails from `DeltaAirLines@t.delta.com`
 * (subject "Congrats On Your SkyMiles Award Trip"). Delta's HTML-stripped body is
 * unusual compared with other carriers:
 *   • The itinerary lists CITY NAMES ("DENVER", "NYC-KENNEDY", "ITHACA NY"), not
 *     3-letter codes. The airport CODES come from the "Fare Details:" routing line
 *     ("DEN DL X/NYC DL ITH …") and a clean baggage-summary line
 *     ("Tue 23 Feb 2027DEN-ITH") which also carries the YEAR.
 *   • Dates in the itinerary read "Tue, 23FEB" (no year); the year is taken from
 *     the baggage summary, falling back to the ticket "Issue Date: 12JUL26".
 *   • The dollar sign is HTML-encoded as "&#36;" and miles read
 *     "Miles Redeemed 27,100 Miles".
 *
 * The parser fails soft: an email it can't fully parse still yields its
 * confirmation number + event type when possible, and never overwrites a richer
 * event for the same PNR during the fold.
 */

/** Any Delta sender (transactional + marketing), e.g. DeltaAirLines@t.delta.com. */
const DELTA_FROM = /@(?:[a-z0-9-]+\.)*delta\.com/i;

/** True when the sender looks like Delta Air Lines (any address). */
export function isDeltaEmail(from: string | null | undefined): boolean {
  return !!from && DELTA_FROM.test(from);
}

/**
 * Classify a Delta email into a trip event using the SUBJECT line only.
 *   • Booking — "Congrats On Your SkyMiles Award Trip" / "Your Delta flight
 *               confirmation" / "eTicket Receipt" / "Award Receipt"
 *   • Change  — "schedule change" / "your flight has changed" / "new time"
 *   • Cancel  — "… has been canceled" / "cancellation" / "refund"
 *
 * Cancellation > change > booking precedence. Account/marketing subjects
 * (e.g. "Your SkyMiles Account Has Been Updated") match nothing and are skipped.
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
    /award trip/i.test(s) ||
    /award receipt/i.test(s) ||
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
  const parens = subject.match(/\(([A-Z0-9]{6})\)/);
  if (parens) return parens[1]!.toUpperCase();
  const labeled = subject.match(/confirmation\s*(?:number|#|code)?\s*[–\-:]?\s*([A-Z0-9]{6})\b/i);
  if (labeled) return labeled[1]!.toUpperCase();
  return undefined;
}

/** Pull the PNR from the body: "Confirmation Number\n HWGXRS". */
function parsePnrFromBody(body: string): string | undefined {
  const m = body.match(/Confirmation\s*Number\s*[:#]?\s*([A-Z0-9]{6})\b/i);
  if (!m) return undefined;
  const token = m[1]!.toUpperCase();
  // A real record locator mixes letters and digits (avoid all-digit ticket/account
  // numbers that could follow a mislabeled heading).
  return /[A-Z]/.test(token) ? token : undefined;
}

/**
 * Parse one Delta email into a {@link ParsedTripEvent}. Returns `undefined` when
 * it is not a recognizable Delta trip email, or when a booking/change email
 * carries no parseable itinerary (e.g. the "transaction notice" redemption email
 * that has miles but no flights — the full Award Receipt for the same trip wins).
 */
export function parseDeltaEmail(message: EmailMessage): ParsedTripEvent | undefined {
  const type = classifyDeltaEmail(message.subject);
  if (!type) return undefined;

  // Delta's HTML-stripped body has blank/whitespace-only lines between every
  // field. Collapse them (trim each line, drop empties) so the field-per-line
  // itinerary parser sees one value per line.
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

  const trip = parseDeltaTripDetails(body, confirmationNumber);
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

/** "PM"/"AM" clock like "12:20PM" → 24-hour "12:20"; "11:21PM" → "23:21". */
function to24(time: string): string | undefined {
  const m = time.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
  if (!m) return undefined;
  let hour = Number.parseInt(m[1]!, 10) % 12;
  if (/pm/i.test(m[3]!)) hour += 12;
  return `${String(hour).padStart(2, '0')}:${m[2]}`;
}

/** The airport-code sequence for the journey, from the "Fare Details:" routing
 *  line ("DEN DL X/NYC DL ITH …" → [DEN, NYC, ITH]). Airline "DL" separators and
 *  the trailing fare basis are ignored. */
function parseRouteCodes(body: string): string[] {
  const line = body.match(/Fare Details:\s*([^\n]+)/i)?.[1];
  if (!line) return [];
  const tokens = line.trim().split(/\s+/);
  const codes: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!.replace(/^X\//, '');
    if (i % 2 === 0) {
      const m = t.match(/^([A-Z]{3})/);
      if (!m) break;
      codes.push(m[1]!);
    } else if (t !== 'DL') {
      break;
    }
  }
  return codes;
}

/** The date + endpoints from the baggage summary line ("Tue 23 Feb 2027DEN-ITH"),
 *  which is the only place the YEAR appears. */
function parseBaggageSummary(
  body: string,
): { date: string; origin: string; destination: string } | undefined {
  const m = body.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(20\d{2})\s*([A-Z]{3})-([A-Z]{3})\b/);
  if (!m) return undefined;
  const month = MONTHS[m[2]!.slice(0, 3).toLowerCase()];
  if (!month) return undefined;
  return {
    date: `${m[3]}-${month}-${m[1]!.padStart(2, '0')}`,
    origin: m[4]!.toUpperCase(),
    destination: m[5]!.toUpperCase(),
  };
}

/** Fallback trip date from the itinerary marker "Tue, 23FEB" + the ticket
 *  "Issue Date: 12JUL26" (a trip whose month/day precedes issue is next year). */
function parseFallbackDate(body: string): string | undefined {
  const marker = body.match(/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,\s*(\d{1,2})([A-Za-z]{3})/i);
  if (!marker) return undefined;
  const month = MONTHS[marker[2]!.toLowerCase()];
  if (!month) return undefined;
  const day = marker[1]!.padStart(2, '0');

  const issue = body.match(/Issue Date:\s*(\d{1,2})([A-Za-z]{3})(\d{2})/i);
  let year = new Date().getFullYear();
  if (issue) {
    const issueMonth = MONTHS[issue[2]!.toLowerCase()] ?? '01';
    year = 2000 + Number.parseInt(issue[3]!, 10);
    // The trip is after the issue date; if its month/day is earlier, it's next year.
    if (`${month}-${day}` < `${issueMonth}-${issue[1]!.padStart(2, '0')}`) year += 1;
  }
  return `${year}-${month}-${day}`;
}

/** One flight block parsed from the itinerary (flight number + dep/arr times). */
interface ParsedFlight {
  flightNumber: string;
  departureTime: string; // 24h "HH:mm"
  arrivalTime: string; // 24h "HH:mm"
}

/**
 * Match each flight block in the Delta itinerary:
 *
 *   DELTA 532
 *   Delta Main (N)
 *   DENVER
 *   12:20PM
 *   NYC-KENNEDY
 *   06:22PM
 *
 * The cabin line "… (N)" anchors a real segment so the top-of-email seat summary
 * ("DELTA 53227A") is never mistaken for a flight.
 */
const FLIGHT_RE =
  /DELTA\s+(\d+)\*?\s*[\r\n]+[^\r\n]*\([A-Z0-9]\)[^\r\n]*[\r\n]+[^\r\n]+[\r\n]+\s*(\d{1,2}:\d{2}\s*[AP]M)\s*[\r\n]+[^\r\n]+[\r\n]+\s*(\d{1,2}:\d{2}\s*[AP]M)/gi;

function parseFlights(body: string): ParsedFlight[] {
  const flights: ParsedFlight[] = [];
  for (const m of body.matchAll(FLIGHT_RE)) {
    const dep = to24(m[2]!);
    const arr = to24(m[3]!);
    if (!dep || !arr) continue;
    flights.push({ flightNumber: `DL ${m[1]}`, departureTime: dep, arrivalTime: arr });
  }
  return flights;
}

/** Title-case an ALL-CAPS name, e.g. "EMILY JEAN SPRENGER" → "Emily Jean Sprenger". */
function titleCaseName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/** Parse travelers from "Name: EMILY JEAN SPRENGER" lines. */
function parseDeltaTravelers(body: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  // Constrain to a single line ([ \t], not \s) so the name doesn't bleed into
  // the following all-caps lines (e.g. "FLIGHTSEAT", "DELTA 532").
  for (const m of body.matchAll(/Name:[ \t]*([A-Z][A-Z.]+(?:[ \t]+[A-Z][A-Z.]+)+)/g)) {
    const full = titleCaseName(m[1]!);
    const key = full.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      names.push(full);
    }
  }
  return names;
}

/**
 * Parse the fare. Delta Award Receipts read "Miles Redeemed 27,100 Miles" plus a
 * cash "Total Charged - &#36;5.60 USD" (taxes/fees on an award). A pure-cash Delta
 * receipt (no miles) is treated as a cash booking on the total. Reservation-wide
 * amounts are divided by the passenger count.
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
  const money = (raw: string): number => Number.parseFloat(raw.replace(/,/g, ''));
  const totalCharged = body.match(/Total Charged\s*[-:\s]*(?:&#36;|\$)\s*([\d,]+\.\d{2})/i);

  const miles =
    body.match(/Miles Redeemed\s*([\d,]+)\s*Miles/i) ?? body.match(/([\d,]+)\s*Miles\b/i);
  if (miles) {
    const points = Number.parseInt(miles[1]!.replace(/,/g, ''), 10) / count;
    const taxes = totalCharged ? money(totalCharged[1]!) / count : undefined;
    return {
      purchaseType: PurchaseType.Points,
      paidPoints: Math.round(points),
      taxesAndFeesUsd: taxes != null ? Math.round(taxes * 100) / 100 : undefined,
    };
  }

  if (totalCharged) {
    const total = money(totalCharged[1]!) / count;
    return { purchaseType: PurchaseType.Cash, paidCashUsd: Math.round(total * 100) / 100 };
  }
  return {};
}

/** Build a {@link RetrievedTrip} from a Delta Award Receipt body. */
function parseDeltaTripDetails(body: string, confirmationNumber: string): RetrievedTrip | undefined {
  const flights = parseFlights(body);
  if (flights.length === 0) return undefined;

  const routeCodes = parseRouteCodes(body);
  const baggage = parseBaggageSummary(body);
  const date = baggage?.date ?? parseFallbackDate(body);
  if (!date) return undefined;

  const first = flights[0]!;
  const last = flights[flights.length - 1]!;
  const origin = baggage?.origin ?? routeCodes[0];
  const destination = baggage?.destination ?? routeCodes[routeCodes.length - 1];
  if (!origin || !destination) return undefined;

  const departureDateTime = `${date}T${first.departureTime}:00`;
  // Roll arrival to the next day if the clock goes backwards (a red-eye).
  const arrivalDate = last.arrivalTime < first.departureTime ? nextDay(date) : date;
  const arrivalDateTime = `${arrivalDate}T${last.arrivalTime}:00`;

  // Detailed segments when the routing gives every airport in the path.
  let segments: RetrievedFlightSegment[] | undefined;
  if (routeCodes.length === flights.length + 1) {
    segments = flights.map((f, i) => ({
      origin: routeCodes[i]!,
      destination: routeCodes[i + 1]!,
      departureDateTime: `${date}T${f.departureTime}:00`,
      arrivalDateTime: `${date}T${f.arrivalTime}:00`,
      flightNumber: f.flightNumber,
    }));
  }

  const passengerNames = parseDeltaTravelers(body);
  const pricing = parseDeltaPricing(body, passengerNames.length);

  return {
    airline: Airline.Delta,
    confirmationNumber,
    passengerNames,
    origin,
    destination,
    departureDateTime,
    arrivalDateTime,
    segments: segments && segments.length > 1 ? segments : undefined,
    fareType: FareType.Unknown,
    purchaseType: pricing.purchaseType,
    paidCashUsd: pricing.paidCashUsd,
    paidPoints: pricing.paidPoints,
    taxesAndFeesUsd: pricing.taxesAndFeesUsd,
  };
}

/** Add one calendar day to an ISO date ("2027-02-23" → "2027-02-24"). */
function nextDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
