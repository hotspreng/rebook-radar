import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PastFlightView } from '@shared/dto';
import { History, Plane, RefreshCw, TrendingDown } from 'lucide-react';
import { Button, Card } from './ui.js';
import { formatDateTime, formatNative, formatUsd } from '../lib/format.js';

const api = window.swr;

export function PastFlightsPage(): JSX.Element {
  const [flights, setFlights] = useState<PastFlightView[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setFlights(await api.flights.past());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const totalSavedUsd = flights.reduce((sum, f) => sum + f.savedValueUsd, 0);
    const withSavings = flights.filter((f) => f.savedAmount > 0).length;
    return { count: flights.length, totalSavedUsd, withSavings };
  }, [flights]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 px-7 py-5">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Past Flights</h1>
          <p className="text-sm text-slate-400">
            Flights you have already flown, with what you first paid, what you finally paid, and what
            you saved by rebooking.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-7 py-6">
        {loading && flights.length === 0 ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : flights.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col gap-8">
            <section>
              <div className="grid grid-cols-3 gap-4">
                <SummaryCard label="Flights flown" value={totals.count.toLocaleString('en-US')} />
                <SummaryCard
                  label="Flights rebooked cheaper"
                  value={totals.withSavings.toLocaleString('en-US')}
                />
                <SummaryCard
                  label="Total saved"
                  value={formatUsd(totals.totalSavedUsd)}
                  accent="emerald"
                  emphasize
                />
              </div>
            </section>

            <section>
              <Card className="overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3 text-left">Passenger</th>
                      <th className="px-4 py-3 text-left">Route</th>
                      <th className="px-4 py-3 text-left">Departed</th>
                      <th className="px-4 py-3 text-right">Originally paid</th>
                      <th className="px-4 py-3 text-right">Final paid</th>
                      <th className="px-4 py-3 text-right">Saved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flights.map((f) => {
                      const routeLabel = `${f.flight.route.origin.code} → ${f.flight.route.destination.code}`;
                      const saved = f.savedAmount > 0;
                      return (
                        <tr key={f.flight.id} className="border-b border-slate-800/60 last:border-0">
                          <td className="px-4 py-3 text-slate-200">{f.passengerName}</td>
                          <td className="px-4 py-3 text-slate-200">
                            {routeLabel}
                            {f.rebookings > 0 && (
                              <span className="ml-2 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
                                rebooked {f.rebookings}×
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-400">
                            {formatDateTime(f.flight.departureDateTime)}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-300">
                            {formatNative(f.originalAmount, f.purchaseType)}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-300">
                            {formatNative(f.finalAmount, f.purchaseType)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {saved ? (
                              <span className="inline-flex flex-col items-end">
                                <span className="inline-flex items-center gap-1 font-medium text-emerald-400">
                                  <TrendingDown size={13} />
                                  {formatNative(f.savedAmount, f.purchaseType)}
                                </span>
                                <span className="text-[11px] text-slate-500">
                                  {formatUsd(f.savedValueUsd)}
                                </span>
                              </span>
                            ) : (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            </section>

            <p className="text-[11px] leading-relaxed text-slate-600">
              “Originally paid” is the highest price paid when the flight was first booked. “Final
              paid” is the lowest price paid after any rebookings (including cancel-and-rebook under
              a new confirmation number). Saved value converts points to dollars using your point
              value in Settings.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  accent,
  emphasize,
}: {
  label: string;
  value: string;
  accent?: 'emerald';
  emphasize?: boolean;
}): JSX.Element {
  return (
    <Card className={`px-5 py-4 ${emphasize ? 'ring-1 ring-emerald-500/30' : ''}`}>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold ${
          accent === 'emerald' ? 'text-emerald-400' : 'text-slate-100'
        }`}
      >
        {value}
      </p>
    </Card>
  );
}

function EmptyState(): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-800/60">
        <History size={26} className="text-slate-500" />
      </div>
      <p className="text-sm font-medium text-slate-300">No past flights yet</p>
      <p className="mt-1 max-w-sm text-sm text-slate-500">
        Once a tracked flight’s departure date has passed, it moves here with a summary of what you
        paid and saved.
      </p>
      <div className="mt-4 flex items-center gap-2 text-xs text-slate-600">
        <Plane size={14} /> Flights leave the dashboard automatically after they depart.
      </div>
    </div>
  );
}
