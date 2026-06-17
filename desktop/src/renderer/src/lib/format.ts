import {
  PurchaseType,
  Recommendation,
  type FareType,
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

/** Format an amount in the unit of the original purchase. */
export function formatNative(amount: number | undefined, type: PurchaseType): string {
  if (amount == null) return '—';
  return type === PurchaseType.Points ? formatPoints(amount) : formatUsd(amount);
}

export const FARE_LABELS: Record<FareType, string> = {
  wanna_get_away: 'Wanna Get Away',
  wanna_get_away_plus: 'Wanna Get Away+',
  anytime: 'Anytime',
  business_select: 'Business Select',
  unknown: 'Unknown',
};

export const RECOMMENDATION_LABELS: Record<Recommendation, string> = {
  rebook: 'Rebook',
  keep: 'Keep',
  unknown: 'Check price',
};
