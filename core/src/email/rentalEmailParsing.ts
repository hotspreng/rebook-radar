import type { ParsedRentalCar, RentalProvider } from '../models/RentalCar.js';
import type { EmailMessage } from './EmailMessage.js';
import { isoDate, isPhone, labelValue, monthNumber, stamp, to24h, toLines } from './emailParsingUtils.js';
import { unwrapForwarded } from './forwardedEmail.js';

/**
 * Pure parsing for car rental reservation emails from Hertz and National.
 *
 * As with hotels, the provider is recognised by the SENDER address (the Gmail
 * search uses the same addresses — see {@link RENTAL_EMAIL_QUERIES}) and
 * forwarded confirmations are unwrapped first.
 */

export type RentalEventType = 'booked' | 'cancelled';

/** One reservation event derived from one email. */
export interface RentalCarEvent {
  type: RentalEventType;
  provider: RentalProvider;
  emailId: string;
  /** When the email was sent (ms since epoch); the ordering key for folding. */
  occurredAt: number;
  confirmationNumber: string;
  /** Present for bookings; for cancellations only when the email described the rental. */
  car?: ParsedRentalCar;
}

const SENDER_PATTERNS: Record<RentalProvider, RegExp> = {
  hertz: /@(?:[a-z0-9-]+\.)*hertz\.com/i,
  national: /@(?:[a-z0-9-]+\.)*nationalcar\.com/i,
};

/** Which rental company sent this `From` header, if any. */
export function rentalProviderFor(from: string | null | undefined): RentalProvider | undefined {
  if (!from) return undefined;
  return (Object.keys(SENDER_PATTERNS) as RentalProvider[]).find((p) => SENDER_PATTERNS[p].test(from));
}

export function isRentalEmail(from: string | null | undefined): boolean {
  return rentalProviderFor(from) !== undefined;
}

/**
 * Gmail searches that find each company's reservation emails. The sender is
 * matched exactly first; the domain-wide query only runs when that finds
 * nothing. Forwards come from the relative's address, so they are found by
 * subject and company name.
 */
export const RENTAL_EMAIL_QUERIES: { provider: RentalProvider | 'forwarded'; primary: string; fallback?: string }[] = [
  {
    provider: 'national',
    primary: 'from:reservations@nationalcar.com',
    fallback: 'from:nationalcar.com subject:(reservation OR confirmed OR canceled OR cancelled)',
  },
  {
    provider: 'hertz',
    primary: 'from:reservations@emails.hertz.com',
    fallback: 'from:hertz.com subject:(reservation OR booking OR confirmed OR canceled OR cancelled)',
  },
  {
    provider: 'forwarded',
    primary: 'subject:(fwd OR fw) (hertz OR "national car")',
  },
];

// --- shared helpers ---------------------------------------------------------

const CANCELLATION_SUBJECT = /\bcancel(?:l?ed|lation)\b/i;
const CONFIRMATION_VALUE = /^[A-Z0-9]{6,14}$/i;
const WEEKDAY = '(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)';

interface Stop {
  location: string;
  date: string;
  time?: string;
  /** Index of the first line after the stop. */
  next: number;
}

/** Location line(s) up to a date line, then an optional time line. Returns undefined when no date follows. */
function readStop(
  lines: string[],
  labelAt: number,
  readDate: (line: string) => { date: string; time?: string } | undefined,
): Stop | undefined {
  const location: string[] = [];
  for (let j = labelAt + 1; j < Math.min(lines.length, labelAt + 6); j += 1) {
    const parsed = readDate(lines[j]!);
    if (parsed) {
      if (location.length === 0) return undefined;
      let time = parsed.time;
      let next = j + 1;
      if (!time) {
        const candidate = lines[next];
        if (candidate && /^\d{1,2}:\d{2}\s*[AaPp]\.?[Mm]\.?$/.test(candidate)) {
          time = to24h(candidate);
          next += 1;
        }
      }
      return { location: location.join(' ').replace(/\s+/g, ' ').trim(), date: parsed.date, time, next };
    }
    location.push(lines[j]!);
  }
  return undefined;
}

function plainConfirmation(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v && CONFIRMATION_VALUE.test(v) ? v.toUpperCase() : undefined;
}

// --- National ---------------------------------------------------------------

/** "Fri, October 23, 2026" */
function nationalDate(line: string): { date: string } | undefined {
  const m = line.match(/^(?:[A-Za-z]{3,9},\s*)?([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  const month = m && monthNumber(m[1]!);
  return m && month ? { date: isoDate(Number(m[3]), month, Number(m[2])) } : undefined;
}

const HOURS_LINE = new RegExp(`^${WEEKDAY}[a-z]*(?:-${WEEKDAY}[a-z]*)?\\s*\\d`, 'i');
const TRAILING_HOURS = new RegExp(`\\s+${WEEKDAY}[a-z]*(?:-[A-Za-z]+)?\\s*\\d{1,2}:\\d{2}.*$`, 'i');
const CITY_LINE = /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/;

/** Street lines, then the "CITY ST ZIP" line, between the pick-up time and the phone number. */
function nationalAddress(lines: string[], from: number, until: number): { address?: string; phone?: string } {
  const street: string[] = [];
  let city: string | undefined;
  let phone: string | undefined;
  for (let i = from; i < Math.min(until, from + 10); i += 1) {
    const line = lines[i]!;
    if (isPhone(line)) {
      phone = line;
      break;
    }
    if (HOURS_LINE.test(line) || /^hours subject to change/i.test(line)) continue;
    const cleaned = line.replace(TRAILING_HOURS, '').trim();
    if (!cleaned) continue;
    if (CITY_LINE.test(cleaned)) city = cleaned.replace(/\s+US$/, '');
    else street.push(cleaned);
  }
  const address = [street.join(' '), city].filter(Boolean).join(', ');
  return { address: address || undefined, phone };
}

function nationalVehicle(lines: string[]): { vehicleClass?: string; vehicleModel?: string } {
  const at = lines.findIndex((l) => /\bor similar$/i.test(l));
  if (at < 1) return {};
  const previous = lines[at - 1]!;
  return {
    vehicleModel: lines[at]!.replace(/\s+/g, ' '),
    vehicleClass: /^vehicle$/i.test(previous) ? undefined : previous,
  };
}

function parseNational(
  m: EmailMessage,
  lines: string[],
  text: string,
): { confirmationNumber?: string; car?: ParsedRentalCar } {
  const confirmationNumber =
    plainConfirmation(labelValue(lines, /confirmation/)) ??
    plainConfirmation(text.match(/confirmation number is:?\s*([A-Z0-9]+)/i)?.[1]);

  const pickupAt = lines.findIndex(
    (l, i) => /^pick[- ]?up$/i.test(l) && readStop(lines, i, nationalDate) !== undefined,
  );
  if (pickupAt < 0) return { confirmationNumber };
  const pickup = readStop(lines, pickupAt, nationalDate)!;

  const returnAt = lines.findIndex(
    (l, i) => i > pickupAt && /^return$/i.test(l) && readStop(lines, i, nationalDate) !== undefined,
  );
  const dropoff = returnAt >= 0 ? readStop(lines, returnAt, nationalDate) : undefined;
  if (!confirmationNumber || !dropoff) return { confirmationNumber };

  const { address, phone } = nationalAddress(lines, pickup.next, returnAt);
  return {
    confirmationNumber,
    car: {
      provider: 'national',
      confirmationNumber,
      pickupLocation: pickup.location,
      pickupAddress: address,
      pickupPhone: phone,
      pickupAt: stamp(pickup.date, pickup.time),
      returnLocation: dropoff.location,
      returnAt: stamp(dropoff.date, dropoff.time),
      ...nationalVehicle(lines),
      driverName: labelValue(lines, /driver name/),
      emailId: m.id,
      bookedAt: new Date(m.internalDate).toISOString(),
    },
  };
}

// --- Hertz ------------------------------------------------------------------

/**
 * Hertz prints "Mar 02 | 12:00 pm" with no year. The year is the earliest one
 * that puts the date on or after `notBefore` (the email date, or the pick-up).
 */
function hertzDateReader(notBefore: () => string): (line: string) => { date: string; time?: string } | undefined {
  return (line) => {
    const m = line.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})\s*\|\s*(\d{1,2}:\d{2}\s*[AaPp]\.?[Mm]\.?)$/);
    const month = m && monthNumber(m[1]!);
    if (!m || !month) return undefined;
    const floor = notBefore();
    const year = Number(floor.slice(0, 4));
    let date = isoDate(year, month, Number(m[2]));
    if (date < floor) date = isoDate(year + 1, month, Number(m[2]));
    return { date, time: to24h(m[3]!) };
  };
}

/** Hertz's number follows "Your confirmation is:" (or "Cancellation:" on a cancellation); other wordings are matched loosely. */
function hertzConfirmation(text: string): string | undefined {
  const exact = plainConfirmation(
    text.match(/confirmation(?: number)? is:?\s*([A-Z0-9]+)/i)?.[1] ?? text.match(/^cancell?ation(?: number)?:?\s*([A-Z0-9]+)/im)?.[1],
  );
  if (exact) return exact;
  const loose = /(?:confirmation|reservation)\s*(?:number|#|no\.?)?\s*(?:is)?\s*:?\s*([A-Z0-9]{8,14})\b/gi;
  for (const m of text.matchAll(loose)) {
    if (/\d/.test(m[1]!)) return plainConfirmation(m[1]);
  }
  return undefined;
}

function parseHertz(
  m: EmailMessage,
  lines: string[],
  text: string,
): { confirmationNumber?: string; car?: ParsedRentalCar } {
  const confirmationNumber = hertzConfirmation(text);

  const sent = new Date(m.internalDate);
  const sentDate = isoDate(sent.getUTCFullYear(), sent.getUTCMonth() + 1, sent.getUTCDate());

  const pickupAt = lines.findIndex((l, i) => {
    if (!/^pick-?up$/i.test(l)) return false;
    return readStop(lines, i, hertzDateReader(() => sentDate)) !== undefined;
  });
  if (pickupAt < 0) return { confirmationNumber };
  const pickup = readStop(lines, pickupAt, hertzDateReader(() => sentDate))!;

  const dropoffAt = lines.findIndex((l, i) => i > pickupAt && /^drop-?off$/i.test(l));
  const dropoff =
    dropoffAt >= 0 ? readStop(lines, dropoffAt, hertzDateReader(() => pickup.date)) : undefined;
  if (!confirmationNumber || !dropoff) return { confirmationNumber };

  const modelAt = lines.findIndex((l) => /^\([A-Z0-9]{2,4}\)\s+\S/.test(l));
  const vehicleModel = modelAt >= 0 ? lines[modelAt]!.replace(/^\([A-Z0-9]{2,4}\)\s+/, '') : undefined;
  const classLine = modelAt >= 0 ? lines[modelAt + 1] : undefined;
  const vehicleClass = classLine && !/upgrade|add-ons|^your /i.test(classLine) ? classLine : undefined;

  const loyaltyAt = lines.findIndex((l) => /^#\d{5,}$/.test(l));
  const nameLine = loyaltyAt > 0 ? lines[loyaltyAt - 1] : undefined;
  const driverName = nameLine && /^[A-Za-z][A-Za-z .'-]{2,}$/.test(nameLine) ? nameLine : undefined;

  return {
    confirmationNumber,
    car: {
      provider: 'hertz',
      confirmationNumber,
      pickupLocation: pickup.location,
      pickupAt: stamp(pickup.date, pickup.time),
      returnLocation: dropoff.location,
      returnAt: stamp(dropoff.date, dropoff.time),
      vehicleClass,
      vehicleModel,
      driverName,
      emailId: m.id,
      bookedAt: new Date(m.internalDate).toISOString(),
    },
  };
}

// --- entry point ------------------------------------------------------------

const PARSERS: Record<
  RentalProvider,
  (m: EmailMessage, lines: string[], text: string) => { confirmationNumber?: string; car?: ParsedRentalCar }
> = {
  hertz: parseHertz,
  national: parseNational,
};

/**
 * Parse one email into a rental event: a booking, or a cancellation. Returns
 * nothing for non-reservation mail (marketing, receipts) from the same senders.
 */
export function parseRentalEmail(message: EmailMessage): RentalCarEvent[] {
  const original = unwrapForwarded(message);
  const provider = rentalProviderFor(original.from);
  if (!provider) return [];

  const lines = toLines(original.body ?? '');
  const outcome = PARSERS[provider](original, lines, lines.join('\n'));
  if (!outcome.confirmationNumber) return [];

  const cancelled = CANCELLATION_SUBJECT.test(original.subject ?? '');
  if (!cancelled && !outcome.car) return [];

  return [
    {
      type: cancelled ? 'cancelled' : 'booked',
      provider,
      emailId: message.id,
      occurredAt: original.internalDate,
      confirmationNumber: outcome.confirmationNumber,
      car: outcome.car,
    },
  ];
}
