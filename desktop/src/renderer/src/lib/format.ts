import {
  FlightSource,
  PurchaseType,
  Recommendation,
  type FareType,
  type Flight,
} from '@swr/core';

export function formatUsd(value: number | undefined): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

export function formatPoints(value: number | undefined): string {
  if (value == null) return '—';
  return `${Math.round(value).toLocaleString('en-US')} pts`;
}

export function formatDateTime(iso: string | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDate(iso: string | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Time-of-day only, e.g. "7:30 PM". */
export function formatTime(iso: string | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/**
 * A hotel check-in/out ("2026-11-19T15:00:00", or a date-only "2025-06-27") as
 * "Thu, Nov 19, 2026 · 3:00 PM". Read component-wise, never through `Date`
 * parsing, because a date-only value would otherwise shift a day in
 * timezones behind UTC.
 */
export function formatStayMoment(value: string): string {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return value;
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const date = day.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  if (m[4] === undefined) return date;
  const hour = Number(m[4]);
  const time = `${hour % 12 === 0 ? 12 : hour % 12}:${m[5]} ${hour >= 12 ? 'PM' : 'AM'}`;
  return `${date} · ${time}`;
}

/** Total travel time in minutes as "2h 15m". */
export function formatDuration(minutes: number | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Format an amount in the unit of the original purchase. */
export function formatNative(amount: number | undefined, type: PurchaseType): string {
  if (amount == null) return '—';
  return type === PurchaseType.Points ? formatPoints(amount) : formatUsd(amount);
}

/**
 * The all-in original cash total to display for a flight.
 *
 * Email-imported trips store `cashUsd` as the grand total the traveler paid
 * (taxes & fees already included). Manually-entered flights instead store the
 * base fare in `cashUsd` with taxes & fees captured separately, so those two
 * are summed here. Returns `undefined` when no cash amount is known.
 */
export function originalCashTotal(flight: Flight): number | undefined {
  const cash = flight.originalCost.cashUsd;
  if (cash == null) return undefined;
  if (flight.source === FlightSource.Manual) {
    return Math.round((cash + (flight.originalCost.taxesAndFeesUsd ?? 0)) * 100) / 100;
  }
  return cash;
}

export const FARE_LABELS: Record<FareType, string> = {
  basic: 'Basic',
  choice: 'Choice',
  choice_preferred: 'Choice Preferred',
  choice_extra: 'Choice Extra',
  unknown: 'Unknown',
};

export { CABIN_LABELS } from '@swr/core';

export const RECOMMENDATION_LABELS: Record<Recommendation, string> = {
  rebook: 'Rebook',
  keep: 'Keep',
  unknown: 'Check price',
};
