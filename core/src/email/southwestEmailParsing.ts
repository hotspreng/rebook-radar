import { FareType, PurchaseType } from '../models/common.js';
import { RetrievedTrip } from '../providers/AirlineProvider.js';
import {
  normalizeFareType,
  parseCurrency,
  parsePoints,
} from '../providers/southwestParsing.js';
import { EmailMessage } from './EmailMessage.js';
import { ParsedTripEvent, TripEventType } from './TripEvent.js';

/**
 * Pure, framework-agnostic parsing for Southwest confirmation emails.
 *
 * These heuristics are best-effort and centralized here so they are easy to
 * unit-test and tune against real emails (enable Debug mode to dump raw bodies).
 * They intentionally fail soft: an email that cannot be fully parsed still
 * yields its confirmation number + event type when possible.
 */

/** Domains Southwest sends transactional mail from. */
const SOUTHWEST_FROM = /(southwest\.com|iluv\.southwest\.com|luv\.southwest\.com)/i;

/** True when the sender looks like Southwest Airlines. */
export function isSouthwestEmail(from: string | null | undefined): boolean {
  return !!from && SOUTHWEST_FROM.test(from);
}

/**
 * Extract the 6-character Southwest confirmation number (PNR).
 *
 * Anchored on a "confirmation" label to avoid matching unrelated 6-char tokens.
 * Falls back to a standalone 6-char alphanumeric token that contains a digit.
 */
export function parseConfirmationNumber(text: string | null | undefined): string | undefined {
  if (!text) return undefined;

  // Labeled: "Confirmation # ABC123", "Confirmation Number: A1B2C3", "CONFIRMATION  9XYZ8Q".
  const labeled = text.match(
    /confirmation(?:\s*(?:#|no\.?|number|code))?\s*[:#]?\s*([A-Z0-9]{6})\b/i,
  );
  if (labeled) return labeled[1]!.toUpperCase();

  // Unlabeled fallback: an isolated 6-char code containing at least one digit.
  const loose = text.match(/\b(?=[A-Z0-9]{6}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{6}\b/);
  return loose ? loose[0].toUpperCase() : undefined;
}

/**
 * Classify an email into a trip event type. Cancellation and change signals
 * take precedence over booking signals so a later change/cancel is not
 * mis-read as a fresh booking.
 */
export function classifyEmail(
  subject: string | null | undefined,
  body: string | null | undefined,
): TripEventType | undefined {
  const subj = (subject ?? '').toLowerCase();
  const text = `${subj}\n${(body ?? '').toLowerCase()}`;

  if (isCancellation(subj) || isCancellation(text)) return TripEventType.Cancelled;
  if (isChange(subj) || isChange(text)) return TripEventType.Changed;
  if (isBooking(subj) || isBooking(text)) return TripEventType.Booked;
  return undefined;
}

function isCancellation(t: string): boolean {
  return (
    /\bcancel(?:l?ed|lation)?\b/.test(t) ||
    /reservation (?:has been|was) cancel/.test(t) ||
    /your (?:trip|flight|reservation) (?:is|has been) cancel/.test(t) ||
    /refund confirmation/.test(t) ||
    /travel funds? (?:from|for) (?:your )?cancel/.test(t)
  );
}

function isChange(t: string): boolean {
  return (
    /schedule change/.test(t) ||
    /itinerary (?:has )?(?:changed|updated|change)/.test(t) ||
    /your (?:flight|reservation|trip|itinerary) (?:has been|was|times? have been) (?:changed|updated|modified)/.test(
      t,
    ) ||
    /reaccommodat/.test(t) ||
    /updated (?:itinerary|reservation|flight)/.test(t) ||
    /change to your (?:flight|trip|reservation)/.test(t) ||
    /we(?:'ve| have) (?:changed|updated) your/.test(t)
  );
}

function isBooking(t: string): boolean {
  return (
    /you'?re (?:going|booked|all set)/.test(t) ||
    /air reservation/.test(t) ||
    /booking confirmation/.test(t) ||
    /flight (?:reservation|confirmation)/.test(t) ||
    /reservation confirmation/.test(t) ||
    /confirmation (?:#|number|code)/.test(t) ||
    /ticketless (?:travel|confirmation)/.test(t)
  );
}

/**
 * Parse one Southwest email into a {@link ParsedTripEvent}. Returns `undefined`
 * if it is not a recognizable Southwest trip email (no event type or no
 * confirmation number).
 */
export function parseSouthwestEmail(message: EmailMessage): ParsedTripEvent | undefined {
  const type = classifyEmail(message.subject, message.body);
  if (!type) return undefined;

  const haystack = `${message.subject}\n${message.body}`;
  const confirmationNumber = parseConfirmationNumber(haystack);
  if (!confirmationNumber) return undefined;

  const base: ParsedTripEvent = {
    type,
    emailId: message.id,
    occurredAt: message.internalDate,
    confirmationNumber,
  };

  if (type === TripEventType.Cancelled) return base;

  return { ...base, trip: parseTripDetails(message.body, confirmationNumber) };
}

/** Extract best-effort trip details from a booking/change email body. */
function parseTripDetails(body: string, confirmationNumber: string): RetrievedTrip {
  const [origin, destination] = parseRoute(body);
  const cash = parseTotalCurrency(body);
  const points = parseTotalPoints(body);
  const purchaseType =
    points != null ? PurchaseType.Points : cash != null ? PurchaseType.Cash : undefined;

  return {
    confirmationNumber,
    passengerNames: parsePassengerNames(body),
    origin,
    destination,
    departureDateTime: parseDepartureDateTime(body) ?? '',
    arrivalDateTime: undefined,
    fareType: parseFare(body),
    purchaseType,
    paidCashUsd: cash,
    paidPoints: points,
    taxesAndFeesUsd: parseTaxes(body),
  };
}

/** Airport codes in parentheses, e.g. "Chicago (Midway), IL (MDW)". */
const AIRPORT_CODE = /\(([A-Z]{3})\)/g;

function parseRoute(body: string): [string, string] {
  const codes: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = AIRPORT_CODE.exec(body)) !== null) codes.push(m[1]!);
  if (codes.length >= 2) return [codes[0]!, codes[codes.length - 1]!];

  // Fallback: "ORIGIN to DESTINATION" with city names or bare codes.
  const pair = body.match(/\b([A-Z][A-Za-z .]+?)\s+to\s+([A-Z][A-Za-z .]+?)\b/);
  if (pair) return [pair[1]!.trim(), pair[2]!.trim()];

  return [codes[0] ?? '', ''];
}

const NON_NAME = /\b(wanna|anytime|business|select|total|confirmation|depart|arrive|flight|fare|passenger)\b/i;

function parsePassengerNames(body: string): string[] {
  // Look for a "Passenger(s)" label, then take consecutive name-like lines.
  const section = body.match(/passenger(?:\(s\)|s)?\s*[:\n]\s*([\s\S]{0,200})/i);
  if (!section) return [];
  const block = section[1] ?? '';
  const names: string[] = [];
  for (const rawLine of block.split(/\n/)) {
    let stop = false;
    for (const token of rawLine.split(/;|,(?=\s*[A-Z])/)) {
      const name = token.trim();
      const isName =
        /^[A-Za-z][A-Za-z.'\- ]+[A-Za-z]$/.test(name) &&
        name.split(/\s+/).length >= 2 &&
        !NON_NAME.test(name);
      if (isName) names.push(name);
      else if (names.length > 0) {
        stop = true;
        break;
      }
    }
    if (stop) break;
  }
  return names.slice(0, 8);
}

function parseDepartureDateTime(body: string): string | undefined {
  // "Mon, Aug 14, 2026 9:35 AM" / "August 14, 2026 9:35 AM" / "8/14/2026 9:35 AM"
  const longForm = body.match(
    /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?,?\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?/i,
  );
  const candidate = longForm?.[0] ?? body.match(/\b\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?/i)?.[0];
  if (!candidate) return undefined;
  const parsed = Date.parse(candidate.replace(/^[A-Za-z]+,\s*/, ''));
  return Number.isNaN(parsed) ? candidate.trim() : new Date(parsed).toISOString();
}

function parseFare(body: string): FareType {
  const m = body.match(/(business select|anytime|wanna ?get ?away\s*\+?(?:\s*plus)?)/i);
  return normalizeFareType(m?.[0]);
}

/** Total cash near a "Total"/"Grand total"/"Amount" label. */
function parseTotalCurrency(body: string): number | undefined {
  const m = body.match(/(?:grand total|total|total cost|amount (?:paid|charged))\D{0,20}\$\s?([\d,]+\.\d{2})/i);
  return m ? parseCurrency(m[1]) : undefined;
}

function parseTotalPoints(body: string): number | undefined {
  const m = body.match(/([\d,]+)\s*(?:rapid rewards\s*)?(?:points|pts)\b/i);
  return m ? parsePoints(m[1]) : undefined;
}

function parseTaxes(body: string): number | undefined {
  const m = body.match(/(?:taxes?\s*(?:&|and)?\s*fees|taxes? and fees)\D{0,20}\$\s?([\d,]+\.\d{2})/i);
  return m ? parseCurrency(m[1]) : undefined;
}
