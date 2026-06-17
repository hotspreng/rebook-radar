import { FareType } from '../models/common.js';

/**
 * Pure, framework-agnostic parsing helpers for Southwest data. Kept separate
 * from any browser/Playwright code so they are trivially unit-testable and
 * portable to a web client.
 */

/** Parse a currency string like "$129", "129.98 USD", "$1,234.50" → number. */
export function parseCurrency(input: string | null | undefined): number | undefined {
  if (!input) return undefined;
  const cleaned = input.replace(/[^0-9.]/g, '');
  if (!cleaned) return undefined;
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : undefined;
}

/** Parse a points string like "12,000 pts", "9000 points" → number. */
export function parsePoints(input: string | null | undefined): number | undefined {
  if (!input) return undefined;
  const cleaned = input.replace(/[^0-9]/g, '');
  if (!cleaned) return undefined;
  const value = Number.parseInt(cleaned, 10);
  return Number.isFinite(value) ? value : undefined;
}

/** Map Southwest fare label text to a FareType enum value. */
export function normalizeFareType(label: string | null | undefined): FareType {
  if (!label) return FareType.Unknown;
  const l = label.toLowerCase();
  // 2025 fare rebrand: Basic / Choice / Choice Preferred / Choice Extra.
  if (l.includes('choice extra')) return FareType.BusinessSelect;
  if (l.includes('choice preferred')) return FareType.WannaGetAwayPlus;
  if (l.includes('choice')) return FareType.Anytime;
  if (l.includes('basic')) return FareType.WannaGetAway;
  // Legacy fare names.
  if (l.includes('business')) return FareType.BusinessSelect;
  if (l.includes('anytime')) return FareType.Anytime;
  if (l.includes('plus')) return FareType.WannaGetAwayPlus;
  if (l.includes('wanna') || l.includes('get away')) return FareType.WannaGetAway;
  return FareType.Unknown;
}

/** Detect whether page text indicates a CAPTCHA / human-verification wall. */
export function looksLikeCaptcha(pageText: string | null | undefined): boolean {
  if (!pageText) return false;
  const l = pageText.toLowerCase();
  return (
    l.includes('captcha') ||
    l.includes('are you a human') ||
    l.includes('verify you are human') ||
    l.includes('press & hold') ||
    l.includes('unusual activity')
  );
}

/** Detect whether page text indicates a failed login. */
export function looksLikeLoginFailure(pageText: string | null | undefined): boolean {
  if (!pageText) return false;
  const l = pageText.toLowerCase();
  return (
    l.includes('incorrect') ||
    l.includes('does not match') ||
    l.includes('invalid username') ||
    l.includes('invalid password') ||
    l.includes('unable to log in') ||
    l.includes("we don't recognize")
  );
}
