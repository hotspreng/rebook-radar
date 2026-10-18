/** Small text helpers shared by the hotel and rental-car email parsers. */

const MONTH_INDEX: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export function monthNumber(token: string): number | undefined {
  return MONTH_INDEX[token.slice(0, 3).toLowerCase()];
}

export const pad2 = (n: number): string => String(n).padStart(2, '0');

export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** "3:00 PM" → "15:00" */
export function to24h(text: string): string | undefined {
  const m = text.match(/(\d{1,2}):(\d{2})\s*([AaPp])/);
  if (!m) return undefined;
  let hour = Number(m[1]) % 12;
  if (m[3]!.toLowerCase() === 'p') hour += 12;
  return `${pad2(hour)}:${m[2]}`;
}

/** Wall-clock `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm:00` (never a real instant). */
export function stamp(date: string, time?: string): string {
  return time ? `${date}T${time}:00` : date;
}

export function toLines(body: string): string[] {
  return body
    .replace(/[\u200b-\u200d\u2060\ufeff\u00ad]/g, '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0);
}

const PHONE_LINE = /^\+?\(?\d[\d\s().-]{6,}$/;
export const isPhone = (line: string): boolean => PHONE_LINE.test(line);

/** Value of a "Label: value" pair, where the value may sit on the next line. */
export function labelValue(lines: string[], label: RegExp, from = 0): string | undefined {
  const re = new RegExp(`^(?:${label.source})\\s*:?\\s*(.*)$`, 'i');
  for (let i = from; i < lines.length; i += 1) {
    const m = re.exec(lines[i]!);
    if (!m) continue;
    const inline = m[1]!.trim();
    if (inline) return inline;
    const next = lines[i + 1];
    if (next) return next;
  }
  return undefined;
}
