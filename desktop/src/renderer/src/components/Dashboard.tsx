import { Fragment, useEffect, useMemo, useState } from 'react';
import { AIRLINE_LABELS, Airline, PurchaseType, Recommendation } from '@swr/core';
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
import { formatDateTime, formatDuration, formatNative, formatPoints, formatTime, formatUsd, originalCashTotal } from '../lib/format.js';

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
  } = useAppStore();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Flight | undefined>(undefined);
  const [selected, setSelected] = useState<FlightWithComparison | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [airlineFilter, setAirlineFilter] = useState<string>('all');

  const editingGroupLegs = useMemo<Flight[] | undefined>(() => {
    if (!editing) return undefined;
    const legs = flights
      .filter((item) => item.flight.confirmationNumber === editing.confirmationNumber)
      .map((item) => item.flight)
      .sort((left, right) => left.departureDateTime.localeCompare(right.departureDateTime));
    return legs.length >= 2 ? legs : undefined;
  }, [editing, flights]);

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
  const [savingsReport, setSavingsReport] = useState<SavingsReport | null>(null);
  const savings = savingsReport?.allTime ?? null;

  // Realized rebooking savings for the summary cards and the per-flight "Rebook
  // Savings" column. Loaded on mount and refreshed whenever the flight list
  // changes (e.g. after an import or a price check), since a rebooking saving is
  // recorded on import.
  useEffect(() => {
    let cancelled = false;
    void api.reporting.savings().then((r) => {
      if (!cancelled) setSavingsReport(r);
    });
    return () => {
      cancelled = true;
    };
  }, [flights]);

  // Total realized rebooking savings per flight (summed across that flight's
  // rebook events), used by the "Rebook Savings" column.
  const rebookSavingsByFlight = useMemo(() => {
    const m = new Map<string, { points: number; cashUsd: number }>();
    for (const e of savingsReport?.events ?? []) {
      const cur = m.get(e.flightId) ?? { points: 0, cashUsd: 0 };
      cur.points += e.pointsSaved ?? 0;
      cur.cashUsd += e.cashSavedUsd ?? 0;
      m.set(e.flightId, cur);
    }
    return m;
  }, [savingsReport]);

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

  const filtered = useMemo(() => {
    const now = Date.now();
    return flights.filter((f) => {
      if (passengerFilter !== 'all' && f.flight.passengerId !== passengerFilter) return false;
      if (airlineFilter !== 'all' && f.flight.airline !== airlineFilter) return false;
      // Flown flights move to the Past Flights blade.
      const departed = Date.parse(f.flight.departureDateTime);
      if (Number.isFinite(departed) && departed < now) return false;
      return true;
    });
  }, [flights, passengerFilter, airlineFilter]);

  // Airlines actually present among the tracked flights, for the filter dropdown.
  const airlineOptions = useMemo(() => {
    const present = new Set<string>();
    for (const f of flights) present.add(f.flight.airline);
    const items = [...present]
      .sort()
      .map((a) => ({ value: a, label: AIRLINE_LABELS[a as Airline] ?? a }));
    return [{ value: 'all', label: 'All airlines' }, ...items];
  }, [flights]);

  // Round trips are stored as separate legs sharing a confirmation number.
  // Keep the group only so one action can sync both legs and the realized-
  // savings column can aggregate rebook events; prices and comparisons stay
  // per-leg because each direction can have its own entered amount.
  const bookingGroups = useMemo(() => {
    const m = new Map<
      string,
      {
        count: number;
        firstLegId: string;
        legIds: string[];
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
        };
      g.count += 1;
      g.legIds.push(it.flight.id);
      m.set(pnr, g);
    }
    return m;
  }, [filtered]);

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
        <FilterSelect
          label="Airline"
          value={airlineFilter}
          onChange={setAirlineFilter}
          options={airlineOptions}
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
                <th className="px-4 py-3 text-right" title="What you originally paid for this flight (points or cash). Round trips show each leg's own amount.">Original Price</th>
                <th className="px-4 py-3 text-right" title="The latest price found for this flight. For points bookings this is estimated from the current cash fare.">Current Price</th>
                <th className="px-4 py-3 text-right" title="Original price minus current price. Green means it's now cheaper than you booked it; red (+) means it's more expensive.">Price Difference</th>
                <th className="px-4 py-3 text-right" title="Total points or cash you've saved on this flight through rebookings since you first booked it.">Rebook Savings</th>
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
                        <>
                          {formatNative(
                            isPoints ? item.flight.originalCost.points : originalCashTotal(item.flight),
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
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300">
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
                        {c?.savingsNative != null ? (
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
                          // Total realized rebooking savings on this flight since
                          // it was first booked. Round trips aggregate every leg's
                          // rebook events onto the first leg (the other legs show a
                          // "↳ round trip" placeholder to avoid double-counting).
                          if (isRoundTrip && !isFirstLeg) {
                            return <span className="text-[11px] text-slate-500">↳ round trip</span>;
                          }
                          const flightIds = isRoundTrip ? group!.legIds : [item.flight.id];
                          let points = 0;
                          let cashUsd = 0;
                          for (const fid of flightIds) {
                            const s = rebookSavingsByFlight.get(fid);
                            if (s) {
                              points += s.points;
                              cashUsd += s.cashUsd;
                            }
                          }
                          const saved = isPoints ? points : cashUsd;
                          if (saved <= 0) {
                            return <span className="text-[11px] text-slate-600">—</span>;
                          }
                          return (
                            <span className="inline-flex items-center gap-1 text-emerald-400">
                              <TrendingDown size={13} />
                              {isPoints ? formatPoints(points) : formatUsd(cashUsd)}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3">
                        <RecommendationBadge value={c?.recommendation ?? Recommendation.Unknown} />
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
          groupLegs={editingGroupLegs}
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
