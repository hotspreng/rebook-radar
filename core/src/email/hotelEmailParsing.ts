import type { HotelProvider, ParsedHotelStay } from '../models/HotelStay.js';
import type { EmailMessage } from './EmailMessage.js';
import { isoDate, isPhone, labelValue, monthNumber, stamp, to24h, toLines } from './emailParsingUtils.js';
import { unwrapForwarded } from './forwardedEmail.js';

/**
 * Pure parsing for hotel reservation emails from Marriott Bonvoy, Hilton
 * Honors, Frankfurtflyer and American Express Travel.
 *
 * Each provider is recognised by its SENDER address (the Gmail search uses the
 * same addresses — see {@link HOTEL_EMAIL_QUERIES}). Confirmations that a
 * relative forwarded on are handled by unwrapping the quoted original first.
 *
 * Parsing is label-driven rather than positional: the HTML-stripped body puts
 * each label and value on the same line or the next one depending on the
 * template, so values are found by their label and read from either place.
 */

export type HotelEventType = 'booked' | 'cancelled';

/** One reservation event derived from one email. */
export interface HotelStayEvent {
  type: HotelEventType;
  provider: HotelProvider;
  emailId: string;
  /** When the email was sent (ms since epoch); the ordering key for folding. */
  occurredAt: number;
  confirmationNumber?: string;
  bookingReference?: string;
  /** Present for bookings; for cancellations only when the email described the stay. */
  stay?: ParsedHotelStay;
}

const SENDER_PATTERNS: Record<HotelProvider, RegExp> = {
  marriott: /@(?:[a-z0-9-]+\.)*[a-z0-9-]*marriott[a-z0-9-]*\.com/i,
  hilton: /@(?:[a-z0-9-]+\.)*hilton\.com/i,
  frankfurtflyer: /@(?:[a-z0-9-]+\.)*(?:cube-travel\.de|frankfurtflyer\.de)/i,
  amex: /@(?:[a-z0-9-]+\.)*americanexpress\.com/i,
};

/** Which hotel program sent this `From` header, if any. */
export function hotelProviderFor(from: string | null | undefined): HotelProvider | undefined {
  if (!from) return undefined;
  return (Object.keys(SENDER_PATTERNS) as HotelProvider[]).find((p) => SENDER_PATTERNS[p].test(from));
}

export function isHotelEmail(from: string | null | undefined): boolean {
  return hotelProviderFor(from) !== undefined;
}

/**
 * Gmail searches that find each program's reservation emails. The sender is
 * matched exactly first; the domain-wide query only runs when that finds
 * nothing (a program that changes its sending address). Forwards come from
 * the relative's address, so they are found by subject and program name.
 */
export const HOTEL_EMAIL_QUERIES: { provider: HotelProvider | 'forwarded'; primary: string; fallback?: string }[] = [
  {
    provider: 'marriott',
    primary: 'from:reservations@res-marriott.com',
    fallback: 'from:res-marriott.com',
  },
  {
    provider: 'hilton',
    primary: 'from:noreply@h6.hilton.com',
    fallback: 'from:hilton.com',
  },
  {
    provider: 'frankfurtflyer',
    primary: 'from:hotels@cube-travel.de',
    fallback: 'from:(cube-travel.de OR frankfurtflyer.de)',
  },
  {
    provider: 'amex',
    primary:
      'from:AmericanExpress@welcome.americanexpress.com subject:(trip OR itinerary OR booking OR hotel OR confirmed OR cancelled OR canceled)',
    fallback: 'from:welcome.americanexpress.com subject:(trip OR confirmed)',
  },
  {
    provider: 'forwarded',
    primary: 'subject:(fwd OR fw) (hilton OR marriott OR frankfurtflyer OR cube-travel OR americanexpress)',
  },
];

// --- text helpers -----------------------------------------------------------

function nightsBetween(checkIn: string, checkOut: string): number | undefined {
  const a = Date.parse(`${checkIn.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${checkOut.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  return Math.round((b - a) / 86_400_000);
}

/** ALL-CAPS text (a common template habit for names) → "Title Case". Mixed case is left alone. */
function tidyCase(value: string): string {
  if (/[a-z]/.test(value) || !/[A-Z]{2}/.test(value)) return value;
  return value.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

const ROOM_ABBREVIATIONS: [RegExp, string][] = [
  [/\bRM\b/gi, 'Room'],
  [/\bSTE\b/gi, 'Suite'],
  [/\bDLX\b/gi, 'Deluxe'],
  [/\bBDRM\b/gi, 'Bedroom'],
];

function tidyRoomType(value: string): string {
  let out = tidyCase(value);
  for (const [pattern, full] of ROOM_ABBREVIATIONS) out = out.replace(pattern, full);
  return out;
}

function dedupeConsecutive(lines: string[]): string[] {
  return lines.filter((line, i) => i === 0 || line !== lines[i - 1]);
}

/** "Check-in" / "Check-out" followed by a weekday-optional date and optional time. */
function parseLabeledDateTime(text: string, label: string): { date: string; time?: string } | undefined {
  const re = new RegExp(
    `${label}\\s*:?\\s*(?:[A-Za-z]{3,9},\\s*)?([A-Za-z]{3,9})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})` +
      `(?:\\s*(?:at\\s*)?(\\d{1,2}:\\d{2}\\s*[AaPp]\\.?[Mm]\\.?))?`,
    'gi',
  );
  for (const m of text.matchAll(re)) {
    const month = monthNumber(m[1]!);
    if (!month) continue;
    return { date: isoDate(Number(m[3]), month, Number(m[2])), time: m[4] ? to24h(m[4]) : undefined };
  }
  return undefined;
}

function cleanNames(names: (string | undefined)[]): string[] {
  const out: string[] = [];
  for (const raw of names) {
    const name = raw?.replace(/[.,]+$/, '').trim();
    if (name && !out.some((n) => n.toLowerCase() === name.toLowerCase())) out.push(tidyCase(name));
  }
  return out;
}

// --- per-provider parsing ---------------------------------------------------

type StayFields = Omit<ParsedHotelStay, 'provider' | 'emailId' | 'bookedAt'>;

interface ProviderOutcome {
  confirmationNumber?: string;
  bookingReference?: string;
  stays: StayFields[];
}

/** Assemble a stay, or nothing when the hotel or dates are missing/inconsistent. */
function buildStay(fields: Omit<StayFields, 'nights' | 'guestNames'> & { guestNames?: string[]; nights?: number }): StayFields | undefined {
  if (!fields.hotelName || !fields.checkIn || !fields.checkOut) return undefined;
  const nights = nightsBetween(fields.checkIn, fields.checkOut);
  if (nights == null || nights < 0) return undefined;
  return { ...fields, guestNames: fields.guestNames ?? [], nights: nights > 0 ? nights : fields.nights };
}

/** Marriott: the hotel name is in the subject; address and phone head the body. */
function parseMarriott(m: EmailMessage, lines: string[], text: string): ProviderOutcome {
  const subject = m.subject ?? '';
  const roomConfirmations = [...text.matchAll(/Room\s*\d+\s*Confirmation Number:?\s*([A-Z0-9]{6,})/gi)].map((r) => r[1]!);
  const subjectNumber = subject.match(/#\s*([A-Z0-9]{6,})/i)?.[1]?.toUpperCase();
  // Cancellation emails list their own "CANCELLATION NUMBER" in the subject and
  // put the reservation's number under a "CONFIRMATION NUMBER" label.
  const labeledNumber = labelValue(lines, /confirmation number/)?.match(/^[A-Z0-9]{6,}$/i)?.[0]?.toUpperCase();
  const confirmationNumber = CANCELLATION_SUBJECT.test(subject)
    ? labeledNumber ?? roomConfirmations[0]?.toUpperCase()
    : subjectNumber ?? labeledNumber ?? roomConfirmations[0]?.toUpperCase();

  const subjectName = subject.match(/#\s*[A-Z0-9]+\s+for\s+(.+)$/i)?.[1]?.trim();
  const checkInLine = lines.findIndex((l) => /^check-?in\b/i.test(l));
  const head = lines.slice(0, checkInLine > 0 ? checkInLine : lines.length);
  const phoneIdx = head.findIndex(isPhone);

  const normalizedName = (subjectName ?? '').toLowerCase().replace(/\s+/g, ' ');
  const addressLines: string[] = [];
  if (phoneIdx > 0) {
    for (let i = phoneIdx - 1; i >= Math.max(0, phoneIdx - 3); i -= 1) {
      const line = head[i]!;
      if (normalizedName && normalizedName.includes(line.toLowerCase())) break;
      addressLines.unshift(line);
    }
  }
  const hotelName = subjectName ?? (phoneIdx > 1 ? head[phoneIdx - 2] : undefined);

  const checkIn = parseLabeledDateTime(text, 'check-?in');
  const checkOut = parseLabeledDateTime(text, 'check-?out');

  const guestCounts = [...text.matchAll(/Guests per room:?\s*(\d+)\s*Adults?(?:,?\s*(\d+)\s*Child(?:ren)?)?/gi)];
  const guests = guestCounts.reduce((sum, g) => sum + Number(g[1]) + Number(g[2] ?? 0), 0);

  const roomLine = lines.findIndex((l) => /^Room\s*\d+\s*Confirmation Number/i.test(l));
  const bedLine = roomLine >= 0 ? lines[roomLine + 1] : undefined;
  const roomType = bedLine && /bed|king|queen|suite|studio|twin/i.test(bedLine) && !/^Guests per room/i.test(bedLine) ? bedLine : undefined;

  const guest = text.match(/thank you for booking with us,?\s*([^\n]+)/i)?.[1];

  const stay = buildStay({
    hotelName: hotelName ?? '',
    address: addressLines.length > 0 ? addressLines.join(', ') : undefined,
    phone: phoneIdx >= 0 ? head[phoneIdx] : undefined,
    checkIn: checkIn ? stamp(checkIn.date, checkIn.time) : '',
    checkOut: checkOut ? stamp(checkOut.date, checkOut.time) : '',
    guestNames: cleanNames([guest]),
    guests: guests > 0 ? guests : undefined,
    rooms: roomConfirmations.length > 0 ? roomConfirmations.length : undefined,
    roomType,
    confirmationNumber,
  });
  return { confirmationNumber, stays: stay ? [stay] : [] };
}

const WEEKDAY_ONLY = /^(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day$/i;
const HOTEL_WORDS =
  /hilton|hotel|inn\b|suites|resort|conrad|curio|doubletree|hampton|embassy|waldorf|canopy|tapestry|lxr|motto|signia|homewood|home2|tru by|graduate|spa\b/i;

/**
 * Hilton lists the property's name and address lines together without
 * labels. The address carries digits (street number, postal code) and the
 * name usually does not, which tells them apart whichever order the
 * template emits them in.
 */
function splitHiltonProperty(candidates: string[]): { name?: string; address?: string } {
  if (candidates.length === 0) return {};
  const noDigits = candidates.filter((c) => !/\d/.test(c));
  const pool = noDigits.length > 0 ? noDigits : candidates;
  const name = pool.length === 1 ? pool[0]! : pool.find((c) => HOTEL_WORDS.test(c)) ?? pool[pool.length - 1]!;
  const address = candidates.filter((c) => c !== name);
  return { name, address: address.length > 0 ? address.join(', ') : undefined };
}

/** Hilton: year-less "Jun 08" headers, with the year in the subject and rate dates. */
function parseHilton(m: EmailMessage, lines: string[], text: string): ProviderOutcome {
  const subject = m.subject ?? '';
  const confirmationNumber = (subject.match(/confirmation\s*#\s*(\d{6,})/i) ?? text.match(/confirmation\s*#\s*(\d{6,})/i))?.[1];

  let checkInDate: string | undefined;
  let checkOutDate: string | undefined;
  const rate = text.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})\s*[-–]\s*(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (rate) {
    const m1 = monthNumber(rate[2]!);
    const m2 = monthNumber(rate[5]!);
    if (m1 && m2) {
      checkInDate = isoDate(Number(rate[3]), m1, Number(rate[1]));
      checkOutDate = isoDate(Number(rate[6]), m2, Number(rate[4]));
    }
  }
  if (!checkInDate) {
    // "Jun-08-2026" in the subject gives the year for the year-less headers.
    const subjectDate = (subject + '\n' + text).match(/([A-Za-z]{3})-(\d{1,2})-(\d{4})/);
    const checkInHeader = text.match(/(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\s+([A-Za-z]{3,9})\s+(\d{1,2})\s+(\d+)\s*Nights?/i);
    const month = subjectDate ? monthNumber(subjectDate[1]!) : undefined;
    if (subjectDate && month) {
      checkInDate = isoDate(Number(subjectDate[3]), month, Number(subjectDate[2]));
      const nights = Number(checkInHeader?.[3] ?? text.match(/(\d+)\s*Nights?/i)?.[1]);
      if (Number.isFinite(nights) && nights > 0) {
        const out = new Date(Date.parse(`${checkInDate}T00:00:00Z`) + nights * 86_400_000);
        checkOutDate = isoDate(out.getUTCFullYear(), out.getUTCMonth() + 1, out.getUTCDate());
      }
    }
  }

  const checkInTime = text.match(/Check\s*In:?\s*(\d{1,2}:\d{2}\s*[AP]M)/i)?.[1];
  const checkOutTime = text.match(/Check\s*Out:?\s*(\d{1,2}:\d{2}\s*[AP]M)/i)?.[1];

  // Property block: everything between the confirmation number and the first
  // weekday of the stay dates, minus the "Maps & Directions" link and phone.
  const confIdx = lines.findIndex((l) => /^confirmation\s*#/i.test(l));
  let endIdx = lines.findIndex((l, i) => i > confIdx && (WEEKDAY_ONLY.test(l) || /^check\s*in\b/i.test(l)));
  if (endIdx < 0) endIdx = lines.length;
  const block = confIdx >= 0 ? lines.slice(confIdx + 1, endIdx) : [];
  const phone = block.find(isPhone);
  const candidates = block.filter((l) => !isPhone(l) && !/^maps\b/i.test(l) && !/^\W*$/.test(l));
  const property = splitHiltonProperty(candidates);

  const guestName = text.match(/Guest Name:?\s*([^\n]+)/i)?.[1];
  const guestMatch = text.match(/Guests:?\s*(\d+)\s*Adults?(?:,?\s*(\d+)\s*Child(?:ren)?)?/i);
  const guests = guestMatch ? Number(guestMatch[1]) + Number(guestMatch[2] ?? 0) : undefined;
  const rooms = Number(text.match(/Rooms:?\s*(\d+)/i)?.[1]) || undefined;

  const planIdx = lines.findIndex((l) => /^Room Plan:?/i.test(l));
  let roomType = planIdx >= 0 ? lines[planIdx]!.replace(/^Room Plan:?\s*/i, '').trim() : undefined;
  const planNext = planIdx >= 0 ? lines[planIdx + 1] : undefined;
  // The plan wraps in narrow layouts, leaving a dangling "RM".
  if (planIdx >= 0 && planNext && /^[A-Z]{1,3}$/.test(planNext)) roomType = `${roomType ?? ''} ${planNext}`.trim();

  const stay = buildStay({
    hotelName: property.name ?? '',
    address: property.address,
    phone,
    checkIn: checkInDate ? stamp(checkInDate, checkInTime ? to24h(checkInTime) : undefined) : '',
    checkOut: checkOutDate ? stamp(checkOutDate, checkOutTime ? to24h(checkOutTime) : undefined) : '',
    guestNames: cleanNames([guestName]),
    guests,
    rooms,
    roomType: roomType ? tidyRoomType(roomType) : undefined,
    confirmationNumber,
  });
  return { confirmationNumber, stays: stay ? [stay] : [] };
}

/**
 * Frankfurtflyer: a short summary in the body; the booking reference exists
 * only in the attached itinerary's filename
 * (`Itinerary_<Surname>_<date>_<City>_<REF>.pdf`).
 */
function parseFrankfurtflyer(m: EmailMessage, lines: string[], text: string): ProviderOutcome {
  // Cancellations name the booking in the subject: "… | Ref: VEKCDI".
  let bookingReference = m.subject?.match(/\bRef:?\s*([A-Z0-9]{5,8})\b/i)?.[1]?.toUpperCase();
  for (const attachment of m.attachments ?? []) {
    if (bookingReference) break;
    const ref = attachment.filename.match(/_([A-Z0-9]{5,8})\.pdf$/i)?.[1];
    if (ref && /^itinerary/i.test(attachment.filename)) bookingReference = ref.toUpperCase();
  }

  // "Your booking for the Conrad Hong Kong from 2025/06/27 to 2025/06/29 was successfully cancelled."
  const cancelled = text.match(
    /booking for (?:the )?(.+?) from (\d{4})\/(\d{2})\/(\d{2}) to (\d{4})\/(\d{2})\/(\d{2})/i,
  );
  if (cancelled) {
    const stay = buildStay({
      hotelName: cancelled[1]!.trim(),
      checkIn: isoDate(Number(cancelled[2]), Number(cancelled[3]), Number(cancelled[4])),
      checkOut: isoDate(Number(cancelled[5]), Number(cancelled[6]), Number(cancelled[7])),
      bookingReference,
    });
    return { bookingReference, stays: stay ? [stay] : [] };
  }

  const dates = text.match(/(\d{4})\/(\d{2})\/(\d{2})\s*[-–]\s*(\d{4})\/(\d{2})\/(\d{2})/);
  const dateIdx = lines.findIndex((l) => /\d{4}\/\d{2}\/\d{2}\s*[-–]\s*\d{4}\/\d{2}\/\d{2}/.test(l));
  const hotelLine = dateIdx > 0 ? lines[dateIdx - 1] : undefined;

  // "Conrad Hong Kong in Hong Kong, China" — the last " in " separates the
  // hotel from the destination.
  let hotelName = hotelLine;
  let address: string | undefined;
  const split = hotelLine?.match(/^(.+) in (.+)$/);
  if (split) {
    hotelName = split[1]!.trim();
    address = split[2]!.trim();
  }

  const occupancy = text.match(/(\d+)\s*Rooms?,?\s*(\d+)\s*Adults?(?:,?\s*(\d+)\s*Child(?:ren)?)?/i);
  const guest = text.match(/Hello\s+([^,\n]+),/i)?.[1];

  const stay = dates
    ? buildStay({
        hotelName: hotelName ?? '',
        address,
        checkIn: isoDate(Number(dates[1]), Number(dates[2]), Number(dates[3])),
        checkOut: isoDate(Number(dates[4]), Number(dates[5]), Number(dates[6])),
        guestNames: cleanNames([guest]),
        guests: occupancy ? Number(occupancy[2]) + Number(occupancy[3] ?? 0) : undefined,
        rooms: occupancy ? Number(occupancy[1]) : undefined,
        bookingReference,
      })
    : undefined;
  return { bookingReference, stays: stay ? [stay] : [] };
}

const AMEX_HEADING_STOP =
  /^(?:(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,|Trip to\b|[A-Z][a-z]{2,8} \d{1,2}, \d{4}\s*[-–]|.*:$)/;

/** AMEX Travel: one block per hotel, introduced by "Hotel Confirmation #:". */
function parseAmex(m: EmailMessage, lines: string[], text: string): ProviderOutcome {
  const bookingReference = (m.subject + '\n' + text).match(/trip\s*#\s*:?\s*([A-Z0-9][A-Z0-9-]{5,})/i)?.[1]?.toUpperCase();

  const confLines = lines.flatMap((l, i) => (/^Hotel Confirmation\s*#/i.test(l) ? [i] : []));
  const stays: StayFields[] = [];

  confLines.forEach((confIdx, n) => {
    const end = confLines[n + 1] ?? lines.length;
    const block = lines.slice(confIdx, end);
    const blockText = block.join('\n');

    const confirmationNumber = labelValue(lines, /Hotel Confirmation\s*#/, confIdx)?.match(/[A-Z0-9-]+/i)?.[0]?.toUpperCase();

    // Walk back from the confirmation line to the date heading above the property.
    const property: string[] = [];
    for (let i = confIdx - 1; i >= Math.max(0, confIdx - 7); i -= 1) {
      const line = lines[i]!;
      if (AMEX_HEADING_STOP.test(line)) break;
      property.unshift(line);
    }
    const phone = property.find(isPhone);
    const textLines = dedupeConsecutive(property.filter((l) => !isPhone(l)));
    const hotelName = textLines[0];
    const address = textLines.slice(1).map(tidyCase).join(', ');

    const checkIn = parseLabeledDateTime(blockText, 'check-?in');
    const checkOut = parseLabeledDateTime(blockText, 'check-?out');

    const guestNames = [...blockText.matchAll(/Guest Name:?\s*([^\n]+)/gi)].map((g) => g[1]);
    const guestCount = [...blockText.matchAll(/Number of Guests:?\s*(\d+)/gi)].reduce((sum, g) => sum + Number(g[1]), 0);
    const roomCount = [...blockText.matchAll(/^Room\s*\d+$/gim)].length;
    const roomType = blockText.match(/Room Type:?\s*([^\n]+)/i)?.[1];

    const stay = buildStay({
      hotelName: hotelName ?? '',
      address: address || undefined,
      phone,
      checkIn: checkIn ? stamp(checkIn.date, checkIn.time) : '',
      checkOut: checkOut ? stamp(checkOut.date, checkOut.time) : '',
      guestNames: cleanNames(guestNames),
      guests: guestCount > 0 ? guestCount : undefined,
      rooms: roomCount > 0 ? roomCount : undefined,
      roomType,
      confirmationNumber,
      bookingReference,
    });
    if (stay) stays.push(stay);
  });

  return { bookingReference, confirmationNumber: stays.length === 1 ? stays[0]!.confirmationNumber : undefined, stays };
}

const PARSERS: Record<HotelProvider, (m: EmailMessage, lines: string[], text: string) => ProviderOutcome> = {
  marriott: parseMarriott,
  hilton: parseHilton,
  frankfurtflyer: parseFrankfurtflyer,
  amex: parseAmex,
};

const CANCELLATION_SUBJECT = /\bcancel(?:l?ed|lation)\b/i;

/**
 * Parse one email into reservation events: one booking per hotel found, or a
 * single cancellation. Returns nothing for non-reservation mail (marketing,
 * statements, flight-only trips) from the same senders.
 */
export function parseHotelEmail(message: EmailMessage): HotelStayEvent[] {
  const original = unwrapForwarded(message);
  const provider = hotelProviderFor(original.from);
  if (!provider) return [];

  const lines = toLines(original.body ?? '');
  const outcome = PARSERS[provider](original, lines, lines.join('\n'));
  const base = { provider, emailId: message.id, occurredAt: original.internalDate };

  if (CANCELLATION_SUBJECT.test(original.subject ?? '')) {
    const described = outcome.stays[0];
    const confirmationNumber = outcome.confirmationNumber;
    const bookingReference = outcome.bookingReference;
    if (!confirmationNumber && !bookingReference && !described) return [];
    return [
      {
        ...base,
        type: 'cancelled',
        confirmationNumber,
        bookingReference,
        stay: described && {
          ...described,
          provider,
          emailId: message.id,
          bookedAt: new Date(original.internalDate).toISOString(),
        },
      },
    ];
  }

  const bookedAt = new Date(original.internalDate).toISOString();
  return outcome.stays.map((stay) => ({
    ...base,
    type: 'booked' as const,
    confirmationNumber: stay.confirmationNumber,
    bookingReference: stay.bookingReference,
    stay: { ...stay, provider, emailId: message.id, bookedAt },
  }));
}
