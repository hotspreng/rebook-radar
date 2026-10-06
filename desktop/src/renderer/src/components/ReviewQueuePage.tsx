import { useCallback, useEffect, useMemo, useState } from 'react';
import { AIRLINE_LABELS, PurchaseType, type Airline } from '@swr/core';
import type { CreditReviewView } from '@shared/dto';
import { ClipboardCheck, Info, RefreshCw } from 'lucide-react';
import { Button, Card } from './ui.js';
import { formatDate, formatDateTime, formatNative, formatPoints, formatUsd } from '../lib/format.js';
import { useAppStore } from '../store/useAppStore.js';

const api = window.swr;

/**
 * Review queue for points/cash credits that an airline reported without saying
 * which leg of a multi-leg booking they applied to. The user picks the affected
 * flight, which records a realized saving on that leg.
 */
export function ReviewQueuePage({ onResolved }: { onResolved?: () => void }): JSX.Element {
  const [items, setItems] = useState<CreditReviewView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const { refreshFlights, pushToast } = useAppStore();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await api.review.list());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function apply(item: CreditReviewView): Promise<void> {
    const flightId = choice[item.id] ?? (item.candidates.length === 1 ? item.candidates[0]!.flightId : '');
    if (!flightId) {
      pushToast('error', 'Pick which leg this credit applied to first.');
      return;
    }
    setBusyId(item.id);
    try {
      await api.review.apply(item.id, flightId);
      pushToast('success', 'Credit applied to the selected leg.');
      await Promise.all([load(), refreshFlights()]);
      onResolved?.();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function dismiss(item: CreditReviewView): Promise<void> {
    setBusyId(item.id);
    try {
      await api.review.dismiss(item.id);
      await load();
      onResolved?.();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 px-7 py-5">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Review</h1>
          <p className="text-sm text-slate-400">
            Credits an airline reported without saying which leg they applied to. Pick the affected
            flight to record the saving.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-7 py-6">
        {loading && items.length === 0 ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : items.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col gap-4">
            {items.map((item) => (
              <ReviewCard
                key={item.id}
                item={item}
                selected={choice[item.id] ?? (item.candidates.length === 1 ? item.candidates[0]!.flightId : '')}
                onSelect={(flightId) => setChoice((prev) => ({ ...prev, [item.id]: flightId }))}
                onApply={() => void apply(item)}
                onDismiss={() => void dismiss(item)}
                busy={busyId === item.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function creditLabel(item: CreditReviewView): string {
  if (item.creditedPoints != null) return formatPoints(item.creditedPoints);
  if (item.creditedCashUsd != null) return formatUsd(item.creditedCashUsd);
  return '—';
}

function ReviewCard({
  item,
  selected,
  onSelect,
  onApply,
  onDismiss,
  busy,
}: {
  item: CreditReviewView;
  selected: string;
  onSelect: (flightId: string) => void;
  onApply: () => void;
  onDismiss: () => void;
  busy: boolean;
}): JSX.Element {
  const isPointsCredit = item.creditedPoints != null;
  const chosen = useMemo(
    () => item.candidates.find((c) => c.flightId === selected),
    [item.candidates, selected],
  );
  // A credit can only apply to a leg of the same currency it was refunded in.
  const compatible = chosen
    ? (chosen.purchaseType === PurchaseType.Points) === isPointsCredit
    : true;
  const newAmount =
    chosen && chosen.currentAmount != null
      ? Math.max(0, chosen.currentAmount - (isPointsCredit ? item.creditedPoints! : item.creditedCashUsd!))
      : undefined;

  return (
    <Card className="px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
              {AIRLINE_LABELS[item.airline as Airline] ?? item.airline} credit
            </span>
            <span className="font-mono text-xs tracking-wide text-slate-400">
              {item.confirmationNumber}
            </span>
          </div>
          <p className="mt-2 text-2xl font-semibold text-emerald-400">{creditLabel(item)}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            redeposited · emailed {formatDate(item.emailDate)}
            {item.passengerName ? ` · ${item.passengerName}` : ''}
          </p>
          {item.subject && <p className="mt-1 text-[11px] text-slate-600">{item.subject}</p>}
        </div>
      </div>

      <div className="mt-4 border-t border-slate-800 pt-4">
        <label className="mb-1.5 block text-xs font-medium text-slate-400">
          Which leg did this credit apply to?
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="min-w-[280px] rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-brand-500 focus:outline-none"
            value={selected}
            onChange={(e) => onSelect(e.target.value)}
          >
            <option value="">Select a leg…</option>
            {item.candidates.map((c) => (
              <option key={c.flightId} value={c.flightId}>
                {c.routeLabel} · {formatDateTime(c.departureDateTime)}
                {c.currentAmount != null ? ` · ${formatNative(c.currentAmount, c.purchaseType)}` : ''}
              </option>
            ))}
          </select>

          <Button onClick={onApply} disabled={busy || !selected || !compatible}>
            Apply credit
          </Button>
          <Button variant="ghost" onClick={onDismiss} disabled={busy}>
            Dismiss
          </Button>
        </div>

        {chosen && !compatible && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-rose-400">
            <Info size={12} /> This leg was booked with{' '}
            {chosen.purchaseType === PurchaseType.Points ? 'points' : 'cash'}, but the credit is in{' '}
            {isPointsCredit ? 'miles' : 'cash'}. Pick a matching leg.
          </p>
        )}
        {chosen && compatible && newAmount != null && (
          <p className="mt-2 text-[11px] text-slate-500">
            {chosen.routeLabel}: {formatNative(chosen.currentAmount, chosen.purchaseType)} →{' '}
            <span className="text-emerald-400">{formatNative(newAmount, chosen.purchaseType)}</span>{' '}
            after applying this credit.
          </p>
        )}
      </div>
    </Card>
  );
}

function EmptyState(): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-800/60">
        <ClipboardCheck size={26} className="text-slate-500" />
      </div>
      <p className="text-sm font-medium text-slate-300">Nothing to review</p>
      <p className="mt-1 max-w-sm text-sm text-slate-500">
        When an airline credits points or cash for a change without saying which leg it applied to,
        it shows up here for you to assign.
      </p>
    </div>
  );
}
