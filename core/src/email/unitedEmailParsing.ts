import { Airline, FareType, PurchaseType } from '../models/common.js';
import {
  RetrievedFlightSegment,
  RetrievedTrip,
  RetrievedTripLeg,
} from '../providers/AirlineProvider.js';
import { EmailMessage } from './EmailMessage.js';
import { ParsedTripEvent, TripEventType } from './TripEvent.js';

/**
 * Pure, framework-agnostic parsing for United Airlines confirmation emails.
 *
 * The reliable transactional source is the eTicket receipt sent from
 * `Receipts@united.com` ("eTicket Itinerary and Receipt for Confirmation
 * XXXXXX"). It carries the confirmation number, every operated segment, the
 * traveler list, and a clean per-passenger total in either cash ("318.60 USD")
 * or miles ("40,000 miles + 7.20 USD"). Booking-confirmation and schedule-change
 * notifications from `notifications@united.com` are largely image-based with no
 * extractable body, so we anchor on the receipt and skip the rest.
 *
 * These heuristics are best-effort and fail soft: an email that cannot be fully
 * parsed still yields its confirmation number + event type when possible.
 */

/** Any United sender (transactional + marketing). */
const UNITED_FROM = /@united\.com/i;

/** United's transactional receipt sender — the only fully parseable source. */
const UNITED_RECEIPTS_FROM = /receipts@united\.com/i;

/** True when the sender looks like United Airlines (any address). */
export function isUnitedEmail(from: string | null | undefined): boolean {
  return !!from && UNITED_FROM.test(from);
}

/** True only for United's eTicket-receipt sender (Receipts@united.com). */
export function isUnitedReceiptEmail(from: string | null | undefined): boolean {
  return !!from && UNITED_RECEIPTS_FROM.test(from);
}

/**
 * Classify a United email into a trip event using the SUBJECT line only.
 *   • Booking — "eTicket Itinerary and Receipt for Confirmation P0B0FE"
 *               "Your United Airlines booking confirmation – P0B0FE"
 *   • Change  — "Flight UA912 … has a new departure time" / "schedule change"
 *   • Cancel  — "… has been canceled" / "cancellation" / "refund"
 *
 * Cancellation > change > booking precedence.
 */
export function classifyUnitedEmail(
  subject: string | null | undefined,
): TripEventType | undefined {
  const s = subject ?? '';
  if (/\bcancel(?:l?ed|lation)?\b/i.test(s) || /\brefund(?:ed)?\b/i.test(s)) {
    return TripEventType.Cancelled;
  }
  if (
    /new departure time/i.test(s) ||
    /schedule change/i.test(s) ||
    /time has changed/i.test(s) ||
    /itinerary (?:has )?changed/i.test(s)
  ) {
    return TripEventType.Changed;
  }
  if (
    /eTicket Itinerary and Receipt/i.test(s) ||
    /travel itinerary from united/i.test(s) ||
    /booking confirmation/i.test(s) ||
    /reservation confirmation/i.test(s)
  ) {
    return TripEventType.Booked;
  }
  return undefined;
}

/** Pull the 6-char confirmation number (PNR) from a United subject. */
function parsePnrFromSubject(subject: string): string | undefined {
  // "… for Confirmation P0B0FE", "booking confirmation – P0B0FE".
  const labeled = subject.match(/confirmation\s*(?:number)?\s*[–\-:]?\s*([A-Z0-9]{6})\b/i);
  if (labeled) return labeled[1]!.toUpperCase();
  const trailing = subject.match(/[–\-]\s*([A-Z0-9]{6})\b/);
  if (trailing) return trailing[1]!.toUpperCase();
  // Last resort (e.g. cancellation subjects): a standalone 6-char record
  // locator. Require BOTH a letter and a digit and skip flight numbers
  // (UA1211) so we don't mistake those for a PNR.
  for (const m of subject.matchAll(/\b([A-Z0-9]{6})\b/g)) {
    const token = m[1]!.toUpperCase();
    if (/^UA\d/.test(token)) continue;
    if (/[A-Z]/.test(token) && /\d/.test(token)) return token;
  }
  return undefined;
}

/** Pull the PNR from the receipt body ("Confirmation Number:\n P0B0FE"). */
function parsePnrFromBody(body: string): string | undefined {
  const m = body.match(/Confirmation Number:\s*([A-Z0-9]{6})\b/i);
  return m ? m[1]!.toUpperCase() : undefined;
}

/**
 * Parse one United email into a {@link ParsedTripEvent}. Returns `undefined`
 * when it is not a recognizable United trip email, or when a booking/change
 * email carries no parseable itinerary (so an empty notification never
 * overwrites the rich receipt during the fold).
 */
export function parseUnitedEmail(message: EmailMessage): ParsedTripEvent | undefined {
  const type = classifyUnitedEmail(message.subject);
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

  const trip = parseUnitedTripDetails(message.body ?? '', confirmationNumber);
  // A booking/change with no parseable itinerary (e.g. an image-only
  // notification) yields nothing actionable — skip it so the eTicket receipt
  // for the same PNR wins the fold.
  if (!trip) return undefined;
  return { ...base, trip };
}

/** One operated segment parsed from a receipt. */
interface ParsedSegment {
  flightNumber: string;
  origin: string;
  originName: string;
  destination: string;
  destinationName: string;
  departureDateTime: string;
  arrivalDateTime: string;
}

/**
 * Match a single flight block in the eTicket receipt, e.g.:
 *
 *   Flight 1 of 3 UA1211 Class: United Economy (N)
 *   Fri, Apr 10, 2026 Fri, Apr 10, 2026
 *   05:49 PM --> 08:47 PM
 *   Chicago, IL, US (ORD) Syracuse, NY, US (SYR)
 */
const SEGMENT_RE =
  /Flight\s+\d+\s+of\s+\d+\s+UA\s*(\d+)[^\n]*\n\s*([A-Za-z]{3},\s*[A-Za-z]{3}\s*\d{1,2},\s*\d{4})\s+([A-Za-z]{3},\s*[A-Za-z]{3}\s*\d{1,2},\s*\d{4})\s*\n\s*(\d{1,2}:\d{2}\s*[AP]M)\s*-->\s*(\d{1,2}:\d{2}\s*[AP]M)\s*\n\s*([^()\n]+?)\s*\(([A-Z]{3})\)\s+([^()\n]+?)\s*\(([A-Z]{3})\)/gi;

/**
 * Match a single flight block in a shared "Travel itinerary" email (sent from
 * notifications@united.com when a traveler forwards their reservation). This
 * layout has no "Flight N of M" header or per-passenger fare; each segment reads:
 *
 *   UA4853 operated by CommuteAir
 *   Embraer ERJ145
 *   November 24, 2026
 *   7:40 pm   9:19 pm
 *   SYR   1H, 39M
 *   IAD
 *   Syracuse Washington
 *   United Economy (YN)
 *
 * Captures: flight number, date, departure time, arrival time, origin code,
 * destination code. Tolerant of the heavy blank-line padding United inserts.
 */
const ITINERARY_SEGMENT_RE =
  /UA\s*(\d+)\s+operated by[\s\S]*?\n\s*([A-Z][a-z]+\s+\d{1,2},\s*\d{4})\s*\n[\s\S]*?(\d{1,2}:\d{2}\s*[ap]m)\s+(\d{1,2}:\d{2}\s*[ap]m)[\s\S]*?\n\s*([A-Z]{3})\s+\d{1,2}H[^\n]*\n\s*([A-Z]{3})\b/gi;

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** "Apr 10, 2026" or "November 24, 2026" + "05:49 PM" → "2026-04-10T17:49:00". */
function toIso(dateText: string, timeText: string): string {
  const dm = dateText.match(/([A-Za-z]{3,9})\s*(\d{1,2}),\s*(\d{4})/);
  const tm = timeText.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
  if (!dm || !tm) return '';
  const month = MONTHS[dm[1]!.slice(0, 3).toLowerCase()];
  if (!month) return '';
  const day = dm[2]!.padStart(2, '0');
  const year = dm[3]!;
  let hour = Number.parseInt(tm[1]!, 10) % 12;
  if (/pm/i.test(tm[3]!)) hour += 12;
  return `${year}-${month}-${day}T${String(hour).padStart(2, '0')}:${tm[2]}:00`;
}

/** Extract operated segments from an eTicket receipt body, in itinerary order. */
function parseUnitedReceiptSegments(body: string): ParsedSegment[] {
  const segments: ParsedSegment[] = [];
  for (const m of body.matchAll(SEGMENT_RE)) {
    const [, flightNum, depDate, arrDate, depTime, arrTime, origName, origCode, destName, destCode] =
      m;
    const departureDateTime = toIso(depDate!, depTime!);
    if (!departureDateTime) continue;
    segments.push({
      flightNumber: `UA ${flightNum}`,
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

/**
 * Extract operated segments from a shared "Travel itinerary" body. The arrival
 * date is not given separately, so we assume same-day arrival (United schedules
 * these emails for domestic same-day connections; a rare overnight only affects
 * the unused duration, not the tracked departure).
 */
function parseUnitedItinerarySegments(body: string): ParsedSegment[] {
  const segments: ParsedSegment[] = [];
  for (const m of body.matchAll(ITINERARY_SEGMENT_RE)) {
    const [, flightNum, date, depTime, arrTime, origCode, destCode] = m;
    const departureDateTime = toIso(date!, depTime!);
    if (!departureDateTime) continue;
    segments.push({
      flightNumber: `UA ${flightNum}`,
      origin: origCode!.toUpperCase(),
      originName: '',
      destination: destCode!.toUpperCase(),
      destinationName: '',
      departureDateTime,
      arrivalDateTime: toIso(date!, arrTime!),
    });
  }
  return segments;
}

/**
 * Extract every operated segment from a United email body, in itinerary order.
 * Tries the eTicket receipt layout first, then the shared "Travel itinerary"
 * layout sent from notifications@united.com.
 */
function parseUnitedSegments(body: string): ParsedSegment[] {
  const receipt = parseUnitedReceiptSegments(body);
  return receipt.length > 0 ? receipt : parseUnitedItinerarySegments(body);
}

const LEG_BREAK_MS = 8 * 60 * 60 * 1000; // > 8h on the ground = a new leg, not a connection.

/**
 * Group operated segments into flown legs. Consecutive segments where the next
 * departs the same airport it arrived within ~8 hours are a connection (one
 * leg); a longer ground time or a different airport starts a new leg. This
 * mirrors how a round trip (ORD→SYR, then SYR→IAD→ORD the next day) becomes two
 * tracked flights.
 */
function groupSegmentsIntoLegs(segments: ParsedSegment[]): RetrievedTripLeg[] {
  if (segments.length === 0) return [];
  const legs: ParsedSegment[][] = [[segments[0]!]];
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1]!;
    const cur = segments[i]!;
    const connects = cur.origin === prev.destination;
    const gapMs = prev.arrivalDateTime && cur.departureDateTime
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
      // Travel time spans time zones (United flies international); a naive
      // arrival−departure would be wrong, so leave duration unset.
      segments: retSegments.length > 1 ? retSegments : undefined,
    };
  });
}

/** Title-case a traveler name token, e.g. "JOSHUADANIEL" → "Joshuadaniel". */
function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Parse the "Traveler Details" block. United renders each traveler as
 * "LAST/FIRSTMIDDLE" (e.g. "SPRENGER/JOSHUADANIEL"). We emit "First Last"
 * (e.g. "Joshuadaniel Sprenger"), which the importer matches to a stored
 * passenger by first-initial + last name.
 *
 * Matching is scoped to the Traveler Details section (between that heading and
 * "Purchase Summary") so fare-rule codes elsewhere in the receipt
 * (e.g. "NOCBBG/NOASR", "REF/UAONLY") are never mistaken for passengers.
 */
function parseUnitedPassengerNames(body: string): string[] {
  const start = body.search(/Traveler Details/i);
  const region = start >= 0 ? body.slice(start) : body;
  const end = region.search(/Purchase Summary/i);
  const block = end >= 0 ? region.slice(0, end) : region;

  const names: string[] = [];
  const seen = new Set<string>();
  for (const m of block.matchAll(/\b([A-Z]{2,})\/([A-Z]{2,})\b/g)) {
    const last = titleCase(m[1]!);
    const first = titleCase(m[2]!);
    const full = `${first} ${last}`;
    const key = full.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      names.push(full);
    }
  }
  return names;
}

/**
 * Parse travelers from a shared "Travel itinerary" body, which lists each as
 * "Traveler N FIRSTMIDDLE LAST" (e.g. "Traveler 1 EMILYJEAN SPRENGER"). Emitted
 * as "First Last" to match a stored passenger by first-initial + last name.
 */
function parseUnitedItineraryTravelers(body: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(/Traveler[ \t]+\d+[ \t]+([A-Z][A-Za-z]*(?:[ \t]+[A-Z][A-Za-z]*)*)/g)) {
    const full = m[1]!.trim().split(/\s+/).map(titleCase).join(' ');
    const key = full.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      names.push(full);
    }
  }
  return names;
}

/**
 * Resolve the traveler list from either United layout: the receipt's
 * "LAST/FIRST" Traveler Details block, falling back to the shared itinerary's
 * "Traveler N FIRST LAST" lines.
 */
function parseUnitedTravelers(body: string): string[] {
  const receipt = parseUnitedPassengerNames(body);
  return receipt.length > 0 ? receipt : parseUnitedItineraryTravelers(body);
}

/**
 * Parse the fare. United gives a per-passenger total directly on newer
 * receipts ("Total Per Passenger: …"); older receipts only carry a whole-
 * reservation "Total: …", which we divide by the passenger count.
 *   • Cash  — "Total Per Passenger: 318.60 USD" / "Total: 955.80 USD"
 *   • Award — "… 40,000 miles + 7.20 USD" / "… 275,000 miles + 28.00 USD"
 */
function parseUnitedPricing(
  body: string,
  passengerCount: number,
): {
  purchaseType?: PurchaseType;
  paidCashUsd?: number;
  paidPoints?: number;
  taxesAndFeesUsd?: number;
} {
  const count = Math.max(1, passengerCount);
  const perPaxLine = body.match(/Total Per Passenger:\s*([^\n]+)/i)?.[1];
  // Fall back to the reservation Total, divided across passengers.
  const totalLine = body.match(/\bTotal:\s*([^\n]+)/i)?.[1];
  const divisor = perPaxLine ? 1 : count;
  const line = perPaxLine ?? totalLine ?? '';

  const award = line.match(/([\d,]+)\s*miles\s*\+\s*([\d,]+(?:\.\d{2})?)\s*USD/i);
  if (award) {
    const miles = Number.parseInt(award[1]!.replace(/,/g, ''), 10) / divisor;
    const usd = Number.parseFloat(award[2]!.replace(/,/g, '')) / divisor;
    return {
      purchaseType: PurchaseType.Points,
      paidPoints: Math.round(miles),
      taxesAndFeesUsd: Math.round(usd * 100) / 100,
    };
  }

  const cash = line.match(/([\d,]+(?:\.\d{2})?)\s*USD/i);
  if (cash) {
    const total = Number.parseFloat(cash[1]!.replace(/,/g, '')) / divisor;
    // Taxes ≈ total − base airfare when the per-passenger airfare line is present.
    const airfare = body.match(/\bAirfare:\s*([\d,]+(?:\.\d{2})?)/i);
    const base = airfare ? Number.parseFloat(airfare[1]!.replace(/,/g, '')) : undefined;
    const taxes = base != null && base <= total ? Math.round((total - base) * 100) / 100 : undefined;
    return { purchaseType: PurchaseType.Cash, paidCashUsd: total, taxesAndFeesUsd: taxes };
  }

  return {};
}

/** Build a {@link RetrievedTrip} from a United eTicket receipt body. */
function parseUnitedTripDetails(body: string, confirmationNumber: string): RetrievedTrip | undefined {
  const segments = parseUnitedSegments(body);
  if (segments.length === 0) return undefined;

  const legs = groupSegmentsIntoLegs(segments);
  const first = legs[0];
  if (!first) return undefined;

  const passengerNames = parseUnitedTravelers(body);
  const pricing = parseUnitedPricing(body, passengerNames.length);

  return {
    airline: Airline.United,
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
