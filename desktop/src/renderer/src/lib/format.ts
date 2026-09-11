import {
  FlightSource,
  PurchaseType,
  Recommendation,
  type Cabin,
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

export const CABIN_LABELS: Record<Cabin, string> = {
  basic_economy: 'Basic Economy',
  economy: 'Economy',
  premium_economy: 'Premium Economy',
  business: 'Business',
  first: 'First',
  unknown: 'Unknown',
};

export const RECOMMENDATION_LABELS: Record<Recommendation, string> = {
  rebook: 'Rebook',
  keep: 'Keep',
  unknown: 'Check price',
};
