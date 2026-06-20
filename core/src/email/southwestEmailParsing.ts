import { FareType, PaymentMethod, PurchaseType } from '../models/common.js';
import {
  RetrievedFlightSegment,
  RetrievedTrip,
  RetrievedTripLeg,
} from '../providers/AirlineProvider.js';
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

/** Domains Southwest sends mail from (transactional + marketing). */
const SOUTHWEST_FROM = /(southwest\.com|ifly\.southwest\.com|iluv\.southwest\.com|luv\.southwest\.com)/i;

/**
 * Transactional confirmations/changes/cancellations come ONLY from
 * southwestairlines@ifly.southwest.com. Marketing, statements, and fare sales
 * use other addresses and must be ignored so junk tokens never become trips.
 */
const SOUTHWEST_TRANSACTIONAL_FROM = /ifly\.southwest\.com/i;

/** True when the sender looks like Southwest Airlines (any address). */
export function isSouthwestEmail(from: string | null | undefined): boolean {
  return !!from && SOUTHWEST_FROM.test(from);
}

/** True only for Southwest's transactional sender (ifly.southwest.com). */
export function isTransactionalSouthwestEmail(from: string | null | undefined): boolean {
  return !!from && SOUTHWEST_TRANSACTIONAL_FROM.test(from);
}

/**
 * Extract the 6-character Southwest confirmation number (PNR).
 *
 * Anchored on a "confirmation" label to avoid matching unrelated 6-char tokens.
 * Falls back to a standalone 6-char alphanumeric token that contains a digit.
 */
export function parseConfirmationNumber(text: string | null | undefined): string | undefined {
  if (!text) return undefined;

  // Labeled only: "Confirmation # ABC123", "Confirmation Number: A1B2C3".
  // (No loose 6-char fallback — that matched junk tokens in marketing mail and
  //  manufactured hundreds of phantom "confirmations".)
  const labeled = text.match(
    /confirmation(?:\s*(?:#|no\.?|number|code))?\s*[:#]?\s*([A-Z0-9]{6})\b/i,
  );
  return labeled ? labeled[1]!.toUpperCase() : undefined;
}

/**
 * Classify an email into a trip event type using the SUBJECT line only.
 *
 * Southwest's transactional subjects are distinctive and unambiguous:
 *   • Booking — "You're going to Chicago (Midway) on 10/10 (AAY5FX)!"
 *   • Change  — "…(CS68KD): Your change is confirmed." /
 *               "Southwest Airlines made a change to your 03/29 trip A9ZFRV"
 *   • Cancel  — "…Rochester trip (B4KA4V): This reservation has been canceled."
 *
 * We deliberately do NOT scan the body: every Southwest footer contains words
 * like "cancel" and "confirmation", which previously mis-classified marketing
 * mail as trips. Cancellation > change > booking precedence.
 */
export function classifyEmail(
  subject: string | null | undefined,
  _body?: string | null | undefined,
): TripEventType | undefined {
  const subj = subject ?? '';
  if (isCancellationSubject(subj)) return TripEventType.Cancelled;
  if (isChangeSubject(subj)) return TripEventType.Changed;
  if (isBookingSubject(subj)) return TripEventType.Booked;
  return undefined;
}

function isCancellationSubject(s: string): boolean {
  return (
    /\bcancel(?:l?ed|lation)?\b/i.test(s) && /\b(reservation|trip|flight|itinerary)\b/i.test(s)
  );
}

function isChangeSubject(s: string): boolean {
  return (
    /your change is confirmed/i.test(s) ||
    /made a change to your\b/i.test(s) ||
    /schedule change/i.test(s) ||
    /change(?:d)? to your (?:flight|trip|reservation|itinerary)/i.test(s)
  );
}

function isBookingSubject(s: string): boolean {
  return (
    /you'?re going to\b/i.test(s) ||
    /air reservation/i.test(s) ||
    /booking confirmation/i.test(s) ||
    /reservation confirmation/i.test(s)
  );
}

/** Pull the 6-char PNR out of a transactional subject line. */
function parsePnrFromSubject(subject: string): string | undefined {
  const paren = subject.match(/\(([A-Z0-9]{6})\)/);
  if (paren) return paren[1]!.toUpperCase();
  const trailing = subject.match(/\btrip\s+([A-Z0-9]{6})\b/i);
  return trailing ? trailing[1]!.toUpperCase() : undefined;
}

/**
 * Parse one Southwest email into a {@link ParsedTripEvent}. Returns `undefined`
 * if it is not a recognizable Southwest trip email (no event type or no
 * confirmation number).
 */
export function parseSouthwestEmail(message: EmailMessage): ParsedTripEvent | undefined {
  const type = classifyEmail(message.subject, message.body);
  if (!type) return undefined;

  // PNR comes from the subject (always present in transactional subjects);
  // fall back to a labeled "Confirmation #" in the body.
  const confirmationNumber =
    parsePnrFromSubject(message.subject) ?? parseConfirmationNumber(message.body);
  if (!confirmationNumber) return undefined;

  const base: ParsedTripEvent = {
    type,
    emailId: message.id,
    occurredAt: message.internalDate,
    confirmationNumber,
  };

  if (type === TripEventType.Cancelled) return base;

  return { ...base, trip: parseTripDetails(message.subject, message.body, confirmationNumber) };
}

/** Extract best-effort trip details from a booking/change email. */
function parseTripDetails(
  subject: string,
  body: string,
  confirmationNumber: string,
): RetrievedTrip {
  const passengerNames = parsePassengerNames(subject, body);

  // Email money/points totals ("redeemed 84,000 points", "Total $22.40") cover
  // the ENTIRE reservation — every passenger on the PNR. Each tracked flight,
  // however, belongs to a single passenger, so divide the reservation totals by
  // the passenger count to record one traveler's share. A 2-passenger 84,000-pt
  // round trip then stores 42,000 pt per passenger (later split per direction),
  // not 84,000.
  const passengerCount = Math.max(1, passengerNames.length);
  const perPassenger = (total: number | undefined): number | undefined =>
    total == null ? undefined : total / passengerCount;

  const points = perPassenger(parseTotalPoints(body));
  const totalCash = perPassenger(parseTotalCurrency(body));
  const purchaseType =
    points != null ? PurchaseType.Points : totalCash != null ? PurchaseType.Cash : undefined;
  // On an award booking the only cash charged is taxes/fees (= the total).
  const taxes = perPassenger(parseTaxes(body)) ?? (points != null ? totalCash : undefined);

  const legs = parseLegs(body, subject);
  const first = legs[0];

  // Itemized payment methods (flight credits, LUV vouchers, card) for cash
  // fares funded by credits/vouchers. Points award bookings track their spend
  // via paidPoints instead, so we only itemize cash payments here.
  const payments = purchaseType === PurchaseType.Cash ? parsePayments(body) : undefined;

  return {
    confirmationNumber,
    passengerNames,
    origin: first?.origin ?? '',
    destination: first?.destination ?? '',
    departureDateTime: first?.departureDateTime ?? '',
    arrivalDateTime: first?.arrivalDateTime,
    durationMinutes: first?.durationMinutes,
    segments: first?.segments,
    fareType: parseFare(body),
    purchaseType,
    paidCashUsd: points != null ? undefined : totalCash,
    paidPoints: points,
    taxesAndFeesUsd: taxes,
    payments: payments && payments.length ? payments : undefined,
    legs: legs.length > 1 ? legs : undefined,
  };
}

/**
 * Parse the itinerary into one entry per flown direction.
 *
 * Round-trip / multi-segment confirmations render a "Flight 1:" / "Flight 2:"
 * marker before each leg's day line + DEPARTS/ARRIVES block. We split the body
 * on those markers and parse each segment independently. Single-leg emails have
 * no marker, so we fall back to parsing the whole body as one leg.
 */
function parseLegs(body: string, subject: string): RetrievedTripLeg[] {
  // Split on "Flight 1:", "Flight 2:", … keeping each leg's own text.
  const segments = body.split(/\bFlight\s+\d+\s*:/i);
  // segments[0] is the header before the first marker; the rest are legs.
  const legTexts = segments.length > 1 ? segments.slice(1) : [body];

  const legs: RetrievedTripLeg[] = [];
  for (const text of legTexts) {
    const leg = parseLeg(text, subject);
    if (leg) legs.push(leg);
  }
  return legs;
}

/** Parse a single leg's route, departure, arrival, and duration. */
function parseLeg(text: string, subject: string): RetrievedTripLeg | undefined {
  const [origin, destination] = parseRoute(text);
  const departureDateTime = parseDepartureDateTime(text, subject) ?? '';
  if (!origin && !departureDateTime) return undefined;
  const segments = parseSegments(text, departureDateTime);
  return {
    origin,
    destination,
    departureDateTime,
    arrivalDateTime: parseArrivalDateTime(text, departureDateTime),
    durationMinutes: parseTravelTime(text),
    // Only attach segments when there is an actual connection; a non-stop leg
    // is fully described by origin/destination already.
    segments: segments.length >= 2 ? segments : undefined,
  };
}

/** Airport codes in parentheses, e.g. "Chicago (Midway), IL (MDW)". */
const AIRPORT_CODE = /\(([A-Z]{3})\)/g;

function parseRoute(body: string): [string, string] {
  // Real itinerary: "DEPARTS ROC 05:10 PM … ARRIVES MDW 06:00 PM". For a
  // connecting leg there are multiple DEPARTS/ARRIVES blocks; the true route is
  // the FIRST departure airport to the LAST arrival airport (the final
  // destination), not the first stopover.
  const deps = [...body.matchAll(/\bDEPARTS\b[\s\S]{0,30}?\b([A-Z]{3})\b/gi)];
  const arrs = [...body.matchAll(/\bARRIVES\b[\s\S]{0,30}?\b([A-Z]{3})\b/gi)];
  if (deps.length && arrs.length) {
    return [
      deps[0]![1]!.toUpperCase(),
      arrs[arrs.length - 1]![1]!.toUpperCase(),
    ];
  }

  // Codes in parentheses, e.g. "(MDW) to (LAS)".
  const codes: string[] = [];
  let m: RegExpExecArray | null;
  AIRPORT_CODE.lastIndex = 0;
  while ((m = AIRPORT_CODE.exec(body)) !== null) codes.push(m[1]!);
  if (codes.length >= 2) return [codes[0]!, codes[codes.length - 1]!];

  // "ROC - MDW".
  const dash = body.match(/\b([A-Z]{3})\s*-\s*([A-Z]{3})\b/);
  if (dash) return [dash[1]!.toUpperCase(), dash[2]!.toUpperCase()];

  return [codes[0] ?? '', ''];
}

const NON_NAME = /\b(wanna|anytime|business|select|total|confirmation|depart|arrive|flight|fare|passenger)\b/i;

function parsePassengerNames(subject: string, body: string): string[] {
  // Cancellation/change subjects lead with the passenger:
  // "Emily Jean Sprenger's 11/29 Rochester trip (B4KA4V): …".
  const fromSubject = subject.match(/^\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})'s\b/);
  if (fromSubject) return [fromSubject[1]!.trim()];

  // Booking/change bodies: "PASSENGER\n Emily Jean Sprenger" (Title-cased names;
  // stop before the all-caps "RAPID REWARDS #" label that follows). Match the
  // uppercase "PASSENGER" header specifically to avoid lowercase footer prose.
  const fromBody: string[] = [];
  const re = /\bPASSENGER\b\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+(?:[-'][A-Za-z]+)?){1,3})/g;
  let pm: RegExpExecArray | null;
  while ((pm = re.exec(body)) !== null) {
    const name = pm[1]!.trim();
    if (!fromBody.includes(name)) fromBody.push(name);
  }
  if (fromBody.length) return fromBody.slice(0, 8);

  // Legacy "Passenger(s):" label followed by name lines.
  return parseLabeledPassengers(body);
}

function parseLabeledPassengers(body: string): string[] {
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

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function parseDepartureDateTime(body: string, subject: string): string | undefined {
  // Real itinerary day line: "Saturday, 10/10/2026" + "DEPARTS ROC 05:10 PM".
  const slash = body.match(
    /(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i,
  );
  if (slash) {
    const time = body.match(/\bDEPARTS\b[\s\S]{0,40}?\b[A-Z]{3}\s+(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
    return buildIso(+slash[3]!, +slash[1]!, +slash[2]!, time?.[1]);
  }

  // Generic long form: "Aug 14, 2026 9:35 AM" / "August 14, 2026".
  const longForm = body.match(
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})(?:\s+(\d{1,2}:\d{2})\s*(AM|PM))?/i,
  );
  if (longForm) {
    const month = MONTHS[longForm[1]!.slice(0, 3).toLowerCase()]!;
    const time = longForm[4] && longForm[5] ? `${longForm[4]} ${longForm[5]}` : undefined;
    return buildIso(+longForm[3]!, month, +longForm[2]!, time);
  }

  // Subject fallback: "on 10/10" (booking) or "'s 10/09" (change/cancel).
  const subj =
    subject.match(/\bon\s+(\d{1,2})\/(\d{1,2})\b/i) ?? subject.match(/'s\s+(\d{1,2})\/(\d{1,2})\b/);
  if (subj) {
    const mm = +subj[1]!;
    const dd = +subj[2]!;
    return buildIso(inferYear(mm, dd), mm, dd);
  }
  return undefined;
}

/**
 * Booked arrival time from "ARRIVES MDW 06:00 PM". Reuses the departure date
 * (the itinerary date line) and rolls to the next day for red-eye legs where
 * the arrival clock time is earlier than departure.
 */
function parseArrivalDateTime(body: string, departureIso: string): string | undefined {
  const date = departureIso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!date) return undefined;
  // Use the LAST "ARRIVES" so a connecting leg reports arrival at the final
  // destination, not at the stopover.
  const arrs = [
    ...body.matchAll(/\bARRIVES\b[\s\S]{0,40}?\b[A-Z]{3}\s+(\d{1,2}:\d{2}\s*(?:AM|PM))/gi),
  ];
  const arr = arrs[arrs.length - 1];
  if (!arr) return undefined;

  let iso = buildIso(+date[1]!, +date[2]!, +date[3]!, arr[1]);
  if (iso.slice(11) < departureIso.slice(11)) {
    const next = new Date(`${date[1]}-${date[2]}-${date[3]}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    iso = `${next.toISOString().slice(0, 10)}T${iso.slice(11)}`;
  }
  return iso;
}

/** Parse "Est. Travel Time: 4h 20m" (or "1h 50m" / "45m") into total minutes. */
function parseTravelTime(text: string): number | undefined {
  const m = text.match(/(?:est\.?\s*)?travel time[:\s]*((?:\d+\s*h)?\s*(?:\d+\s*m)?)/i);
  if (!m) return undefined;
  const hours = m[1]!.match(/(\d+)\s*h/i);
  const minutes = m[1]!.match(/(\d+)\s*m/i);
  if (!hours && !minutes) return undefined;
  return (hours ? +hours[1]! * 60 : 0) + (minutes ? +minutes[1]! : 0);
}

/** Build a local (timezone-naive) ISO string the rest of the app can compare. */
function buildIso(year: number, month: number, day: number, time?: string): string {
  let hours = 0;
  let minutes = 0;
  const t = time?.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (t) {
    hours = Number(t[1]) % 12;
    if (/pm/i.test(t[3]!)) hours += 12;
    minutes = Number(t[2]);
  }
  const p = (n: number) => String(n).padStart(2, '0');
  return `${year}-${p(month)}-${p(day)}T${p(hours)}:${p(minutes)}:00`;
}

/** Pick the most likely year for a bare MM/DD (this year, or next if it passed). */
function inferYear(month: number, day: number): number {
  const now = new Date();
  const year = now.getUTCFullYear();
  const candidate = Date.UTC(year, month - 1, day);
  return candidate < now.getTime() - 86_400_000 ? year + 1 : year;
}

function parseFare(body: string): FareType {
  // Matches both legacy (Wanna Get Away/Anytime/Business Select) and the 2025
  // rebrand (Basic/Choice/Choice Preferred/Choice Extra). normalizeFareType
  // maps the matched label onto the FareType enum.
  const m = body.match(
    /(business select|anytime|wanna ?get ?away\s*\+?(?:\s*plus)?|choice extra|choice preferred|choice|basic)/i,
  );
  return normalizeFareType(m?.[0]);
}

/** Total cash near a "Total"/"Grand total"/"Amount" label. */
function parseTotalCurrency(body: string): number | undefined {
  // The real receipt renders "Total \n $ \n 5.60" with whitespace between
  // tokens; [^$] keeps the match from leaping across an earlier dollar amount.
  const m = body.match(
    /\b(?:grand total|total cost|total|amount (?:paid|charged))\b[^$]{0,20}\$\s*([\d,]+\.\d{2})/i,
  );
  return m ? parseCurrency(m[1]) : undefined;
}

function parseTotalPoints(body: string): number | undefined {
  // Only a genuine award redemption marks a booking as Points. Southwest award
  // confirmations always state "You successfully redeemed X Rapid Rewards
  // points for this trip." We anchor on that sentence so marketing footer prose
  // (e.g. "Earn up to 10,000 Rapid Rewards points per night") never mis-flags a
  // cash fare paid with flight credits/vouchers as a points booking.
  const m = body.match(/redeemed\s+([\d,]+)\s+rapid rewards/i);
  return m ? parsePoints(m[1]) : undefined;
}

/**
 * One operated flight block in the itinerary, e.g.
 *   FLIGHT WN #2886 DEPARTS MDW 01:00 PM Chicago (Midway) ARRIVES ATL 03:50 PM
 * The body renders each token on its own line with lots of whitespace, so the
 * pattern tolerates arbitrary blank lines between tokens.
 */
const SEGMENT_RE =
  /FLIGHT\s+WN\s*#?\s*(\d+)[\s\S]{0,80}?DEPARTS\s+([A-Z]{3})\s+(\d{1,2}:\d{2}\s*(?:AM|PM))[\s\S]{0,80}?ARRIVES\s+([A-Z]{3})\s+(\d{1,2}:\d{2}\s*(?:AM|PM))/gi;

/** Build an ISO string for a base date shifted by whole days. */
function isoWithDayOffset(
  year: number,
  month: number,
  day: number,
  offset: number,
  time: string,
): string {
  const dt = new Date(Date.UTC(year, month - 1, day + offset));
  return buildIso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), time);
}

/**
 * Parse each operated segment of a leg (between connections). Times roll to the
 * next day when the clock goes backwards (overnight connections / red-eyes),
 * anchored on the leg's departure date.
 */
function parseSegments(legText: string, departureIso: string): RetrievedFlightSegment[] {
  const date = departureIso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!date) return [];
  const year = +date[1]!;
  const month = +date[2]!;
  const day = +date[3]!;

  const segments: RetrievedFlightSegment[] = [];
  let offset = 0;
  let lastClock = '';
  const clockOf = (iso: string): string => iso.slice(11, 16);

  for (const m of legText.matchAll(SEGMENT_RE)) {
    const depClock = clockOf(buildIso(year, month, day, m[3]));
    if (lastClock && depClock < lastClock) offset += 1;
    const departureDateTime = isoWithDayOffset(year, month, day, offset, m[3]!);

    const arrClock = clockOf(buildIso(year, month, day, m[5]));
    let arrOffset = offset;
    if (arrClock < depClock) arrOffset += 1;
    const arrivalDateTime = isoWithDayOffset(year, month, day, arrOffset, m[5]!);

    offset = arrOffset;
    lastClock = arrClock;

    segments.push({
      origin: m[2]!.toUpperCase(),
      destination: m[4]!.toUpperCase(),
      departureDateTime,
      arrivalDateTime,
      flightNumber: `WN ${m[1]}`,
    });
  }
  return segments;
}

/** Normalize a raw Southwest payment-method label into a clean display label. */
function normalizePaymentLabel(raw: string): string {
  if (/luv/i.test(raw)) return 'Southwest LUV Voucher';
  if (/flight credit/i.test(raw)) return 'Flight Credit';
  if (/travel funds?/i.test(raw)) return 'Travel Funds';
  if (/gift card/i.test(raw)) return 'Gift Card';
  if (/rapid rewards/i.test(raw)) return 'Rapid Rewards points';
  const ending = raw.match(/ending in\s*(\d+)/i);
  if (ending) return `Card ending in ${ending[1]}`;
  return raw.replace(/&reg;|®/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Parse the "Payment" section into the methods used to fund the fare. Southwest
 * renders each as "Payment Amount $X.XX <Method>" with whitespace between
 * tokens. Used to itemize cash fares paid with flight credits / LUV vouchers.
 */
function parsePayments(body: string): PaymentMethod[] {
  const re =
    /Payment Amount[\s\S]{0,40}?\$\s*([\d,]+\.\d{2})[\s\S]{0,80}?(Flight Credit|Southwest[\s\S]{0,20}?LUV[\s\S]{0,20}?Voucher|Travel Funds?|Gift Card|Rapid Rewards[\s\S]{0,20}?points|[A-Za-z ]*ending in\s*\d+|Visa|MasterCard|American Express|Discover)/gi;
  const payments: PaymentMethod[] = [];
  for (const m of body.matchAll(re)) {
    const amountUsd = parseCurrency(m[1]);
    if (amountUsd == null) continue;
    payments.push({ label: normalizePaymentLabel(m[2]!), amountUsd });
  }
  return payments;
}

function parseTaxes(body: string): number | undefined {
  const m =
    body.match(/Security Fee[^$]{0,20}\$\s*([\d,]+\.\d{2})/i) ??
    body.match(/Taxes?\s*(?:&|and)\s*Fees[^$]{0,20}\$\s*([\d,]+\.\d{2})/i);
  return m ? parseCurrency(m[1]) : undefined;
}
