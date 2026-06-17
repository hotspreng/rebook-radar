import { Fragment, useMemo, useState } from 'react';
import { PurchaseType, Recommendation } from '@swr/core';
import type { Flight, FlightWithComparison } from '@shared/dto';
import { ArrowRight, ChevronRight, Download, Plus, RefreshCw, TrendingDown } from 'lucide-react';
import { useAppStore } from '../store/useAppStore.js';
import { Button, Card, RecommendationBadge } from './ui.js';
import { FlightFormModal } from './FlightFormModal.js';
import { FlightDetailDrawer } from './FlightDetailDrawer.js';
import { formatDateTime, formatNative, formatUsd, FARE_LABELS } from '../lib/format.js';

const api = window.swr;

export function Dashboard(): JSX.Element {
  const {
    flights,
    passengers,
    accounts,
    passengerFilter,
    accountFilter,
    setPassengerFilter,
    setAccountFilter,
    checkAll,
    checkOne,
    refreshFlights,
    pushToast,
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

  const filtered = useMemo(
    () =>
      flights.filter((f) => {
        if (passengerFilter !== 'all' && f.flight.passengerId !== passengerFilter) return false;
        if (accountFilter !== 'all' && f.flight.accountId !== accountFilter) return false;
        return true;
      }),
    [flights, passengerFilter, accountFilter],
  );

  const stats = useMemo(() => {
    const rebook = filtered.filter((f) => f.comparison?.recommendation === Recommendation.Rebook);
    const totalSavings = rebook.reduce((sum, f) => sum + (f.comparison?.savingsUsd ?? 0), 0);
    return {
      total: filtered.length,
      monitored: filtered.filter((f) => f.flight.monitoring).length,
      rebook: rebook.length,
      totalSavings,
    };
  }, [filtered]);

  async function handleCheckAll(): Promise<void> {
    setCheckingAll(true);
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

  async function handleExport(): Promise<void> {
    const result = await api.exportCsv();
    if (result.saved) pushToast('success', `Exported to ${result.path}`);
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
          <Button variant="secondary" onClick={handleExport}>
            <Download size={16} /> Export CSV
          </Button>
          <Button variant="secondary" onClick={handleCheckAll} disabled={checkingAll}>
            <RefreshCw size={16} className={checkingAll ? 'animate-spin' : ''} /> Check all prices
          </Button>
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

      <div className="grid grid-cols-4 gap-4 px-7 py-5">
        <StatCard label="Tracked flights" value={stats.total.toString()} />
        <StatCard label="Monitored" value={stats.monitored.toString()} />
        <StatCard label="Recommended to rebook" value={stats.rebook.toString()} accent="emerald" />
        <StatCard label="Potential savings" value={formatUsd(stats.totalSavings)} accent="emerald" />
      </div>

      <div className="flex items-center gap-3 px-7 pb-4">
        <FilterSelect
          label="Passenger"
          value={passengerFilter}
          onChange={setPassengerFilter}
          options={[{ value: 'all', label: 'All passengers' }, ...passengers.map((p) => ({ value: p.id, label: p.fullName }))]}
        />
        <FilterSelect
          label="Account"
          value={accountFilter}
          onChange={setAccountFilter}
          options={[{ value: 'all', label: 'All accounts' }, ...accounts.map((a) => ({ value: a.id, label: a.label }))]}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-7 pb-7">
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-950/60 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-8 px-2 py-3"></th>
                <th className="px-4 py-3">Passenger</th>
                <th className="px-4 py-3">Route</th>
                <th className="px-4 py-3">Departure</th>
                <th className="px-4 py-3 text-right">Original</th>
                <th className="px-4 py-3 text-right">Current</th>
                <th className="px-4 py-3 text-right">Savings</th>
                <th className="px-4 py-3">Recommendation</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-slate-500">
                    No flights yet. Click “Add flight” to track one, or sync an account.
                  </td>
                </tr>
              )}
              {filtered.map((item) => {
                const type = item.flight.originalCost.purchaseType;
                const c = item.comparison;
                const savingsPositive = (c?.savingsNative ?? 0) > 0;
                const isPoints = type === PurchaseType.Points;
                const currentAmount = c?.currentAmount;
                const alternatives = item.quote?.alternatives ?? [];
                // Cheaper alternatives = same-day options priced below the
                // matched/current option, excluding the matched one itself.
                const cheaper = alternatives.filter((a) => {
                  const price = isPoints ? a.points : a.cashUsd;
                  if (price == null) return false;
                  if (currentAmount != null && price >= currentAmount) return false;
                  return a.departureDateTime !== item.quote?.departureDateTime;
                });
                const isOpen = expanded.has(item.flight.id);
                const canExpand = cheaper.length > 0;
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
                      <td className="px-4 py-3 font-medium text-slate-200">{item.passengerName}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 text-slate-300">
                          {item.flight.route.origin.code}
                          <ArrowRight size={13} className="text-slate-500" />
                          {item.flight.route.destination.code}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400">{formatDateTime(item.flight.departureDateTime)}</td>
                      <td className="px-4 py-3 text-right text-slate-300">
                        {formatNative(
                          isPoints ? item.flight.originalCost.points : item.flight.originalCost.cashUsd,
                          type,
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300">
                        {currentAmount != null ? formatNative(currentAmount, type) : '—'}
                        {canExpand && (
                          <span className="ml-1.5 inline-flex items-center rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                            {cheaper.length} cheaper
                          </span>
                        )}
                      </td>
                      <td className={`px-4 py-3 text-right ${savingsPositive ? 'text-emerald-400' : 'text-slate-400'}`}>
                        {c?.savingsNative != null ? (
                          <span className="inline-flex items-center gap-1">
                            {savingsPositive && <TrendingDown size={13} />}
                            {formatNative(c.savingsNative, type)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <RecommendationBadge value={c?.recommendation ?? Recommendation.Unknown} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleCheckOne(item.flight.id);
                          }}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                          title="Check current price"
                        >
                          <RefreshCw size={15} className={checkingId === item.flight.id ? 'animate-spin' : ''} />
                        </button>
                      </td>
                    </tr>
                    {isOpen && canExpand && (
                      <tr className="border-t border-slate-800/60 bg-slate-950/40">
                        <td></td>
                        <td colSpan={8} className="px-4 py-3">
                          <AlternativesPanel
                            alternatives={cheaper}
                            isPoints={isPoints}
                            currentAmount={currentAmount}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>

      {showForm && (
        <FlightFormModal
          passengers={passengers}
          accounts={accounts}
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

/** Collapsible list of cheaper same-day departure options for a tracked flight. */
function AlternativesPanel({
  alternatives,
  isPoints,
  currentAmount,
}: {
  alternatives: NonNullable<FlightWithComparison['quote']>['alternatives'];
  isPoints: boolean;
  currentAmount?: number;
}): JSX.Element {
  const list = alternatives ?? [];
  const type = isPoints ? PurchaseType.Points : PurchaseType.Cash;
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
        Cheaper departure times
      </p>
      <div className="overflow-hidden rounded-lg border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/60 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Departs</th>
              <th className="px-3 py-2">Flight</th>
              <th className="px-3 py-2">Fare</th>
              <th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2 text-right">vs current</th>
            </tr>
          </thead>
          <tbody>
            {list.map((alt, i) => {
              const price = isPoints ? alt.points : alt.cashUsd;
              const diff = currentAmount != null && price != null ? currentAmount - price : undefined;
              return (
                <tr key={`${alt.departureDateTime}-${alt.flightNumber ?? i}`} className="border-t border-slate-800/60">
                  <td className="px-3 py-2 text-slate-200">{formatDateTime(alt.departureDateTime)}</td>
                  <td className="px-3 py-2 text-slate-400">{alt.flightNumber ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-400">{FARE_LABELS[alt.fareType] ?? 'Basic'}</td>
                  <td className="px-3 py-2 text-right text-slate-200">
                    {formatNative(price, type)}
                    {alt.pointsEstimated && isPoints ? (
                      <span className="ml-1 text-[10px] text-slate-500">est.</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right text-emerald-400">
                    {diff != null && diff > 0 ? `−${formatNative(diff, type)}` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
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
