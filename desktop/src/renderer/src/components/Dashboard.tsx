import { Fragment, useEffect, useMemo, useState } from 'react';
import { AIRLINE_LABELS, PurchaseType, Recommendation } from '@swr/core';
import type { EmailImportProgress, Flight, FlightWithComparison, PriceCheckProgress, SavingsReport } from '@shared/dto';
import {
  ArrowRight,
  ChevronRight,
  Download,
  Inbox,
  Plus,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore.js';
import { Button, Card, RecommendationBadge } from './ui.js';
import { FlightFormModal } from './FlightFormModal.js';
import { FlightDetailDrawer } from './FlightDetailDrawer.js';
import { AlternativesPanel, getCheaperAlternatives } from './AlternativesPanel.js';
import { formatDate, formatDateTime, formatDuration, formatNative, formatPoints, formatTime, formatUsd } from '../lib/format.js';

const api = window.swr;

/** One-line live status for an in-flight email import (emails + trips found). */
function importProgressLabel(p: EmailImportProgress): string {
  const scanned = p.total != null ? `${p.scanned}/${p.total}` : `${p.scanned}`;
  const trips =
    p.tripsFound != null ? ` · ${p.tripsFound} trip${p.tripsFound === 1 ? '' : 's'} found` : '';
  if (p.phase === 'scanning') return `Scanning ${scanned} email${p.scanned === 1 ? '' : 's'}…`;
  if (p.phase === 'parsing') return `Scanned ${scanned} emails${trips}`;
  return `Done · ${p.scanned} email${p.scanned === 1 ? '' : 's'} scanned${trips}`;
}

/** One-line live status for an in-flight "check all prices" sweep. */
function priceCheckProgressLabel(p: PriceCheckProgress): string {
  const rebook =
    p.rebookFound > 0 ? ` · ${p.rebookFound} to rebook` : '';
  if (p.phase === 'checking') return `Checking ${p.checked}/${p.total} flight${p.total === 1 ? '' : 's'}…${rebook}`;
  return `Done · ${p.checked} checked${rebook}`;
}

/**
 * The most recent price movement for a flight, derived from the REAL market
 * signal rather than the stored (possibly re-estimated) amount.
 *
 * For points bookings the displayed points are usually ESTIMATED from the cash
 * fare via a conversion rate, so a change in that rate would otherwise look like
 * a price move. To avoid that, we recompute each history entry's points from its
 * own recorded cash fare using the flight's implied rate (original points ÷
 * actual cash at booking) whenever that actual cash value is available. This
 * makes the trend track genuine cash movement, not estimation noise.
 *
 * Walks back from the latest entry to the most recent one whose price actually
 * differs. If none differ, the fare has held steady → 'flat' ("no change"),
 * dated from the start of the current run.
 */
function getPriceTrend(
  item: FlightWithComparison,
):
  | { kind: 'move'; deltaNative: number; sinceIso: string; up: boolean }
  | { kind: 'flat'; sinceIso: string }
  | undefined {
  const h = item.priceHistory;
  // A single recorded price is the baseline import: show it as "no change
  // since <import date>" rather than hiding the trend entirely.
  if (!h || h.length === 0) return undefined;

  const isPoints = item.flight.originalCost.purchaseType === PurchaseType.Points;
  const originalPoints = item.flight.originalCost.points;
  const actualCash = item.flight.originalMarketCashUsd;
  // Flight-specific points-to-cash rate from the actual booking, when known.
  const useImpliedRate =
    isPoints && originalPoints != null && actualCash != null && actualCash > 0;

  // The comparable price for an entry, normalized to remove estimation-rate
  // noise: recomputed points for points bookings with a known actual cash rate,
  // otherwise the stored amount.
  const priceOf = (e: (typeof h)[number]): number | undefined => {
    if (useImpliedRate && e.cashUsd != null) {
      return Math.round((originalPoints! * e.cashUsd) / actualCash!);
    }
    return e.amount ?? undefined;
  };

  const latest = h[h.length - 1]!;
  const latestPrice = priceOf(latest);
  if (latestPrice == null) return undefined;
  const eq = (a: number, b: number): boolean =>
    Math.round(a * 100) === Math.round(b * 100);

  // Find the most recent earlier entry whose normalized price differs.
  let prevIdx = -1;
  for (let i = h.length - 2; i >= 0; i--) {
    const p = priceOf(h[i]!);
    if (p == null) continue;
    if (!eq(p, latestPrice)) {
      prevIdx = i;
      break;
    }
  }

  if (prevIdx === -1) {
    // No genuine movement on record: price has held at the current level since
    // the start of the trailing run of equal prices.
    let runStart = h.length - 1;
    for (let i = h.length - 2; i >= 0; i--) {
      const p = priceOf(h[i]!);
      if (p == null) continue;
      if (eq(p, latestPrice)) runStart = i;
      else break;
    }
    return { kind: 'flat', sinceIso: h[runStart]!.recordedAt };
  }

  const prevPrice = priceOf(h[prevIdx]!)!;
  const delta = latestPrice - prevPrice;
  if (delta === 0) return { kind: 'flat', sinceIso: h[prevIdx]!.recordedAt };
  return { kind: 'move', deltaNative: delta, sinceIso: h[prevIdx]!.recordedAt, up: delta > 0 };
}

export function Dashboard(): JSX.Element {
  const {
    flights,
    passengers,
    passengerFilter,
    setPassengerFilter,
    checkAll,
    checkOne,
    refreshFlights,
    pushToast,
    settings,
  } = useAppStore();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Flight | undefined>(undefined);
  const [selected, setSelected] = useState<FlightWithComparison | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpanded(flightId: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(flightId)) next.delete(flightId);
      else next.add(flightId);
      return next;
    });
  }
  const [checkingAll, setCheckingAll] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<EmailImportProgress | null>(null);
  const [checkProgress, setCheckProgress] = useState<PriceCheckProgress | null>(null);
  const [savings, setSavings] = useState<SavingsReport['allTime'] | null>(null);

  // Realized rebooking savings (all-time totals) for the summary cards. Loaded
  // on mount and refreshed whenever the flight list changes (e.g. after an
  // import or a price check), since a rebooking saving is recorded on import.
  useEffect(() => {
    let cancelled = false;
    void api.reporting.savings().then((r) => {
      if (!cancelled) setSavings(r.allTime);
    });
    return () => {
      cancelled = true;
    };
  }, [flights]);

  // Live import progress streamed from the main process (emails scanned, trips
  // found). Auto-clears a few seconds after the import finishes.
  useEffect(() => {
    return api.onEmailImportProgress((e) => {
      setImportProgress(e);
      if (e.phase === 'done') {
        window.setTimeout(
          () => setImportProgress((cur) => (cur?.phase === 'done' ? null : cur)),
          5000,
        );
      }
    });
  }, []);

  // Live price-check progress streamed from the main process (flights checked).
  // Auto-clears a few seconds after the sweep finishes.
  useEffect(() => {
    return api.onPriceCheckProgress((e) => {
      setCheckProgress(e);
      if (e.phase === 'done') {
        window.setTimeout(
          () => setCheckProgress((cur) => (cur?.phase === 'done' ? null : cur)),
          5000,
        );
      }
    });
  }, []);

  const filtered = useMemo(
    () =>
      flights.filter((f) => {
        if (passengerFilter !== 'all' && f.flight.passengerId !== passengerFilter) return false;
        return true;
      }),
    [flights, passengerFilter],
  );

  // Round trips are stored as separate legs sharing a confirmation number. Group
  // them so the cost columns can show the booking's true combined totals (e.g.
  // 42,000 pts) once, instead of a fabricated per-leg split.
  const bookingGroups = useMemo(() => {
    const m = new Map<
      string,
      {
        count: number;
        firstLegId: string;
        legIds: string[];
        points: number;
        cashUsd: number;
        valueUsd: number;
        marketCashUsd: number;
        marketCashCount: number;
        currentAmount: number;
        savingsNative: number;
        quoted: number;
        rebook: boolean;
      }
    >();
    for (const it of filtered) {
      const pnr = it.flight.confirmationNumber;
      if (!pnr) continue;
      const g =
        m.get(pnr) ?? {
          count: 0,
          firstLegId: it.flight.id,
          legIds: [],
          points: 0,
          cashUsd: 0,
          valueUsd: 0,
          marketCashUsd: 0,
          marketCashCount: 0,
          currentAmount: 0,
          savingsNative: 0,
          quoted: 0,
          rebook: false,
        };
      g.count += 1;
      g.legIds.push(it.flight.id);
      g.points += it.flight.originalCost.points ?? 0;
      g.cashUsd += it.flight.originalCost.cashUsd ?? 0;
      g.valueUsd += it.comparison?.originalValueUsd ?? 0;
      if (it.flight.originalMarketCashUsd != null) {
        g.marketCashUsd += it.flight.originalMarketCashUsd;
        g.marketCashCount += 1;
      }
      if (it.comparison?.currentAmount != null) {
        g.currentAmount += it.comparison.currentAmount;
        g.savingsNative += it.comparison.savingsNative ?? 0;
        g.quoted += 1;
      }
      if (it.comparison?.recommendation === Recommendation.Rebook) g.rebook = true;
      m.set(pnr, g);
    }
    // Decide a round-trip recommendation from the COMBINED savings vs the alert
    // threshold (per-leg flags mislead: one leg can clear or miss the bar while
    // the booking total tells a different story). Only once every leg is priced.
    for (const g of m.values()) {
      if (g.count < 2 || g.quoted < g.count) continue;
      const isPointsBooking = g.points > 0;
      const threshold = isPointsBooking
        ? settings?.savingsAlertThresholdPoints ?? 2000
        : settings?.savingsAlertThresholdUsd ?? 25;
      g.rebook = g.savingsNative >= threshold && g.savingsNative > 0;
    }
    return m;
  }, [filtered, settings]);

  const stats = useMemo(() => {
    const rebook = filtered.filter((f) => f.comparison?.recommendation === Recommendation.Rebook);
    const totalSavings = rebook.reduce((sum, f) => sum + (f.comparison?.savingsUsd ?? 0), 0);
    return {
      total: filtered.length,
      rebook: rebook.length,
      totalSavings,
    };
  }, [filtered]);

  async function handleCheckAll(): Promise<void> {
    setCheckingAll(true);
    setCheckProgress({ phase: 'checking', checked: 0, total: 0, rebookFound: 0 });
    await checkAll();
    setCheckingAll(false);
  }

  async function handleCheckOne(id: string): Promise<void> {
    setCheckingId(id);
    await checkOne(id);
    const updated = useAppStore.getState().flights.find((f) => f.flight.id === id) ?? null;
    if (selected?.flight.id === id) setSelected(updated);
    setCheckingId(null);
  }

  // A single sync on a round trip's first leg prices BOTH the outbound and
  // return legs in one click, then refreshes once.
  async function handleCheckGroup(legIds: string[]): Promise<void> {
    const first = legIds[0];
    if (!first) return;
    setCheckingId(first);
    try {
      for (const id of legIds) {
        await api.pricing.checkOne(id);
      }
      await refreshFlights();
      if (selected && legIds.includes(selected.flight.id)) {
        const updated =
          useAppStore.getState().flights.find((f) => f.flight.id === selected.flight.id) ?? null;
        setSelected(updated);
      }
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setCheckingId(null);
    }
  }

  async function handleExport(): Promise<void> {
    const result = await api.exportCsv();
    if (result.saved) pushToast('success', `Exported to ${result.path}`);
  }

  async function handleImport(): Promise<void> {
    setImporting(true);
    setImportProgress({ phase: 'scanning', scanned: 0, tripsFound: 0 });
    try {
      const r = await api.email.import();
      await refreshFlights();
      pushToast(
        'success',
        `Scanned ${r.scanned} email(s): ${r.imported} added, ${r.updated} updated, ${r.cancelled} cancelled, ${r.skipped} skipped.`,
      );
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  async function handleDelete(id: string): Promise<void> {
    await api.flights.remove(id);
    setSelected(null);
    await refreshFlights();
    pushToast('info', 'Flight removed.');
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 px-7 py-5">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Flight dashboard</h1>
          <p className="text-sm text-slate-400">Track paid vs current Southwest prices.</p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Button variant="secondary" onClick={handleImport} disabled={importing}>
              <Inbox size={16} className={importing ? 'animate-pulse' : ''} /> Import trips now
            </Button>
            {importProgress && (
              <span className="absolute left-0 top-full mt-1 whitespace-nowrap text-[11px] text-slate-400">
                {importProgressLabel(importProgress)}
              </span>
            )}
          </div>
          <Button variant="secondary" onClick={handleExport}>
            <Download size={16} /> Export CSV
          </Button>
          <div className="relative">
            <Button variant="secondary" onClick={handleCheckAll} disabled={checkingAll}>
              <RefreshCw size={16} className={checkingAll ? 'animate-spin' : ''} /> Check all prices
            </Button>
            {checkProgress && (
              <span className="absolute left-0 top-full mt-1 whitespace-nowrap text-[11px] text-slate-400">
                {priceCheckProgressLabel(checkProgress)}
              </span>
            )}
          </div>
          <Button
            onClick={() => {
              setEditing(undefined);
              setShowForm(true);
            }}
          >
            <Plus size={16} /> Add flight
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-4 px-7 py-5 xl:grid-cols-6">
        <StatCard label="Tracked flights" value={stats.total.toString()} />
        <StatCard label="Recommended to rebook" value={stats.rebook.toString()} accent="emerald" />
        <StatCard label="Potential savings" value={formatUsd(stats.totalSavings)} accent="emerald" />
        <StatCard
          label="Points saved (rebooked)"
          value={formatPoints(savings?.pointsSaved ?? 0)}
          accent="emerald"
        />
        <StatCard
          label="Cash saved (rebooked)"
          value={formatUsd(savings?.cashSavedUsd ?? 0)}
          accent="emerald"
        />
        <StatCard
          label="Total saved (rebooked)"
          value={formatUsd(savings?.totalValueUsd ?? 0)}
          accent="emerald"
        />
      </div>

      <div className="flex items-center gap-3 px-7 pb-4">
        <FilterSelect
          label="Passenger"
          value={passengerFilter}
          onChange={setPassengerFilter}
          options={[{ value: 'all', label: 'All passengers' }, ...passengers.map((p) => ({ value: p.id, label: p.fullName }))]}
        />
      </div>

      <div className="flex flex-1 flex-col overflow-hidden px-7 pb-7">
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-950 text-left text-xs uppercase tracking-wide text-slate-500 shadow-sm shadow-slate-950">
                <tr>
                <th className="w-8 px-2 py-3"></th>
                <th className="px-4 py-3">Passenger</th>
                <th className="px-4 py-3">Route</th>
                <th className="px-4 py-3">Departure</th>
                <th className="px-4 py-3 text-right">Original</th>
                <th className="px-4 py-3 text-right">Current</th>
                <th className="px-4 py-3 text-right">Savings</th>
                <th className="px-4 py-3 text-right">Trend</th>
                <th className="px-4 py-3">Recommendation</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-slate-500">
                    No flights yet. Click “Add flight” to track one, or sync an account.
                  </td>
                </tr>
              )}
              {filtered.map((item) => {
                const type = item.flight.originalCost.purchaseType;
                const c = item.comparison;
                const savingsPositive = (c?.savingsNative ?? 0) > 0;
                const savingsNegative = (c?.savingsNative ?? 0) < 0;
                // Negative savings means the current price is HIGHER than booked.
                const currentMoreExpensive = savingsNegative;
                const isPoints = type === PurchaseType.Points;
                const currentAmount = c?.currentAmount;
                // Cheaper same-day options priced below the matched/current one.
                const cheaper = getCheaperAlternatives(item);
                const isOpen = expanded.has(item.flight.id);
                const canExpand = cheaper.length > 0;
                // Round-trip grouping: show the booking's combined total once.
                const group = item.flight.confirmationNumber
                  ? bookingGroups.get(item.flight.confirmationNumber)
                  : undefined;
                const isRoundTrip = (group?.count ?? 0) >= 2;
                const isFirstLeg = !group || group.firstLegId === item.flight.id;
                return (
                  <Fragment key={item.flight.id}>
                    <tr
                      onClick={() => setSelected(item)}
                      className="cursor-pointer border-t border-slate-800 hover:bg-slate-800/40"
                    >
                      <td className="px-2 py-3 text-center">
                        {canExpand ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleExpanded(item.flight.id);
                            }}
                            className="rounded p-0.5 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                            title={`${cheaper.length} cheaper time${cheaper.length > 1 ? 's' : ''} available`}
                            aria-label="Toggle cheaper options"
                            aria-expanded={isOpen}
                          >
                            <ChevronRight
                              size={16}
                              className={`transition-transform ${isOpen ? 'rotate-90' : ''}`}
                            />
                          </button>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-200">
                        {item.passengerName}
                        {item.flight.confirmationNumber && (
                          <span className="mt-0.5 block font-mono text-[11px] font-normal tracking-wide text-slate-500">
                            {item.flight.confirmationNumber}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 text-slate-300">
                          {item.flight.route.origin.code}
                          <ArrowRight size={13} className="text-slate-500" />
                          {item.flight.route.destination.code}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-slate-500">
                          {AIRLINE_LABELS[item.flight.airline] ?? item.flight.airline}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {formatDateTime(item.flight.departureDateTime)}
                        {(() => {
                          const arrival =
                            item.flight.arrivalDateTime ?? item.quote?.arrivalDateTime;
                          const duration =
                            item.flight.durationMinutes ?? item.quote?.durationMinutes;
                          if (!arrival && duration == null) return null;
                          return (
                            <span className="mt-0.5 block text-[11px] text-slate-500">
                              {arrival ? `arr. ${formatTime(arrival)}` : null}
                              {arrival && duration != null ? ' · ' : null}
                              {duration != null ? formatDuration(duration) : null}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300">
                        {isRoundTrip ? (
                          isFirstLeg ? (
                            <>
                              {formatNative(isPoints ? group!.points : group!.cashUsd, type)}
                              <span className="mt-0.5 block text-[11px] text-slate-500">
                                round trip · {group!.count} legs
                              </span>
                              {isPoints &&
                              group!.marketCashCount > 0 &&
                              group!.marketCashCount === group!.count ? (
                                <span className="block text-[11px] text-slate-500">
                                  {formatUsd(group!.marketCashUsd)}{' '}
                                  <span className="text-emerald-500">actual</span>
                                </span>
                              ) : (
                                isPoints &&
                                group!.valueUsd > 0 && (
                                  <span className="block text-[11px] text-slate-500">
                                    ≈ {formatUsd(group!.valueUsd)} est.
                                  </span>
                                )
                              )}
                            </>
                          ) : (
                            <span className="text-[11px] text-slate-500">↳ incl. in round trip</span>
                          )
                        ) : (
                          <>
                            {formatNative(
                              isPoints ? item.flight.originalCost.points : item.flight.originalCost.cashUsd,
                              type,
                            )}
                            {isPoints && item.flight.originalMarketCashUsd != null ? (
                              <span className="mt-0.5 block text-[11px] text-slate-500">
                                {formatUsd(item.flight.originalMarketCashUsd)}{' '}
                                <span className="text-emerald-500">actual</span>
                              </span>
                            ) : (
                              isPoints &&
                              c?.originalValueUsd != null && (
                                <span className="mt-0.5 block text-[11px] text-slate-500">
                                  ≈ {formatUsd(c.originalValueUsd)} est.
                                </span>
                              )
                            )}
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300">
                        {isRoundTrip ? (
                          <>
                            {currentAmount != null ? (
                              <span className={currentMoreExpensive ? 'text-rose-400' : undefined}>
                                {formatNative(currentAmount, type)}
                              </span>
                            ) : (
                              '—'
                            )}
                            {isPoints && item.quote?.pointsEstimated && currentAmount != null && (
                              <span className="ml-1 text-[10px] text-slate-500">est.</span>
                            )}
                            {isPoints && item.quote?.cashUsd != null && (
                              <span className="mt-0.5 block text-[11px] text-slate-500">
                                {formatUsd(item.quote.cashUsd)} cash
                              </span>
                            )}
                            {group!.quoted === group!.count ? (
                              <span
                                className={`block text-[11px] ${group!.savingsNative < 0 ? 'text-rose-400' : 'text-slate-500'}`}
                              >
                                total {formatNative(group!.currentAmount, type)} · both legs
                              </span>
                            ) : (
                              <span className="block text-[11px] text-slate-500">
                                {group!.quoted}/{group!.count} legs priced
                              </span>
                            )}
                          </>
                        ) : (
                          <>
                            {currentAmount != null ? (
                              <span className={currentMoreExpensive ? 'text-rose-400' : undefined}>
                                {formatNative(currentAmount, type)}
                              </span>
                            ) : (
                              '—'
                            )}
                            {isPoints && item.quote?.pointsEstimated && currentAmount != null && (
                              <span className="ml-1 text-[10px] text-slate-500">est.</span>
                            )}
                            {isPoints && item.quote?.cashUsd != null && (
                              <span className="mt-0.5 block text-[11px] text-slate-500">
                                {formatUsd(item.quote.cashUsd)} cash
                              </span>
                            )}
                            {canExpand && (
                              <div className="mt-1">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleExpanded(item.flight.id);
                                  }}
                                  className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400 hover:bg-emerald-500/25"
                                  aria-expanded={isOpen}
                                  title={`Show ${cheaper.length} cheaper same-day option${cheaper.length > 1 ? 's' : ''}`}
                                >
                                  <ChevronRight
                                    size={11}
                                    className={`transition-transform ${isOpen ? 'rotate-90' : ''}`}
                                  />
                                  {cheaper.length} cheaper
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </td>
                      <td
                        className={`px-4 py-3 text-right ${
                          savingsPositive
                            ? 'text-emerald-400'
                            : savingsNegative
                              ? 'text-rose-400'
                              : 'text-slate-400'
                        }`}
                      >
                        {isRoundTrip ? (
                          isFirstLeg ? (
                            group!.quoted === group!.count ? (
                              <span
                                className={`inline-flex items-center gap-1 ${
                                  group!.savingsNative > 0
                                    ? 'text-emerald-400'
                                    : group!.savingsNative < 0
                                      ? 'text-rose-400'
                                      : 'text-slate-400'
                                }`}
                              >
                                {group!.savingsNative > 0 && <TrendingDown size={13} />}
                                {group!.savingsNative < 0 && <TrendingUp size={13} />}
                                {group!.savingsNative < 0
                                  ? `+${formatNative(-group!.savingsNative, type)}`
                                  : formatNative(group!.savingsNative, type)}
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-500">
                                {group!.quoted}/{group!.count} legs priced
                              </span>
                            )
                          ) : (
                            <span className="text-[11px] text-slate-500">↳ incl. in round trip</span>
                          )
                        ) : c?.savingsNative != null ? (
                          <span className="inline-flex items-center gap-1">
                            {savingsPositive && <TrendingDown size={13} />}
                            {savingsNegative && <TrendingUp size={13} />}
                            {savingsNegative
                              ? `+${formatNative(-c.savingsNative, type)}`
                              : formatNative(c.savingsNative, type)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {(() => {
                          const trend = getPriceTrend(item);
                          if (!trend) {
                            return <span className="text-[11px] text-slate-600">—</span>;
                          }
                          if (trend.kind === 'flat') {
                            return (
                              <div className="flex flex-col items-end">
                                <span className="text-[11px] text-slate-400">no change</span>
                                <span className="mt-0.5 text-[10px] text-slate-500">
                                  since {formatDate(trend.sinceIso)}
                                </span>
                              </div>
                            );
                          }
                          return (
                            <div className="flex flex-col items-end">
                              <span
                                className={`inline-flex items-center gap-1 ${
                                  trend.up ? 'text-rose-400' : 'text-emerald-400'
                                }`}
                              >
                                {trend.up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                                {trend.up ? '+' : '−'}
                                {formatNative(Math.abs(trend.deltaNative), type)}
                              </span>
                              <span className="mt-0.5 text-[10px] text-slate-500">
                                since {formatDate(trend.sinceIso)}
                              </span>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3">
                        {isRoundTrip ? (
                          isFirstLeg ? (
                            group!.quoted === group!.count ? (
                              <RecommendationBadge
                                value={group!.rebook ? Recommendation.Rebook : Recommendation.Keep}
                              />
                            ) : (
                              <span className="text-[11px] text-slate-500">
                                {group!.quoted}/{group!.count} legs priced
                              </span>
                            )
                          ) : (
                            <span className="text-[11px] text-slate-500">↳ round trip</span>
                          )
                        ) : (
                          <RecommendationBadge value={c?.recommendation ?? Recommendation.Unknown} />
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isRoundTrip && !isFirstLeg ? (
                          <span className="text-[11px] text-slate-600">↳ synced</span>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isRoundTrip && group) {
                                void handleCheckGroup(group.legIds);
                              } else {
                                void handleCheckOne(item.flight.id);
                              }
                            }}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                            title={isRoundTrip ? 'Check both legs' : 'Check current price'}
                          >
                            <RefreshCw
                              size={15}
                              className={checkingId === item.flight.id ? 'animate-spin' : ''}
                            />
                          </button>
                        )}
                      </td>
                    </tr>
                    {isOpen && canExpand && (
                      <tr className="border-t border-slate-800/60 bg-slate-950/40">
                        <td></td>
                        <td colSpan={9} className="px-4 py-3">
                          <AlternativesPanel
                            alternatives={cheaper}
                            isPoints={isPoints}
                            originalAmount={
                              isPoints
                                ? item.flight.originalCost.points
                                : item.flight.originalCost.cashUsd
                            }
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          </div>
        </Card>
      </div>

      {showForm && (
        <FlightFormModal
          passengers={passengers}
          existing={editing}
          onClose={() => setShowForm(false)}
          onSaved={refreshFlights}
        />
      )}

      {selected && (
        <FlightDetailDrawer
          item={selected}
          checking={checkingId === selected.flight.id}
          onClose={() => setSelected(null)}
          onEdit={() => {
            setEditing(selected.flight);
            setShowForm(true);
            setSelected(null);
          }}
          onDelete={() => void handleDelete(selected.flight.id)}
          onCheck={() => void handleCheckOne(selected.flight.id)}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: 'emerald' }): JSX.Element {
  return (
    <Card className="px-5 py-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${accent === 'emerald' ? 'text-emerald-400' : 'text-slate-100'}`}>
        {value}
      </p>
    </Card>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-brand-500"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
