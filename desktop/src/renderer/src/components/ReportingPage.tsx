import { useCallback, useEffect, useState } from 'react';
import { PurchaseType } from '@swr/core';
import type { SavingsBucket, SavingsReport } from '@shared/dto';
import { BarChart3, Plane, RefreshCw, TrendingDown } from 'lucide-react';
import { Button, Card } from './ui.js';
import { formatDate, formatPoints, formatUsd } from '../lib/format.js';

const api = window.swr;

export function ReportingPage(): JSX.Element {
  const [report, setReport] = useState<SavingsReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await api.reporting.savings());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const all = report?.allTime;
  const hasData = (all?.rebookings ?? 0) > 0;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 px-7 py-5">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Reporting</h1>
          <p className="text-sm text-slate-400">
            Points and money saved by rebooking flights at a lower price.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-7 py-6">
        {loading && !report ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : !hasData ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col gap-8">
            {/* All-time summary */}
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
                All time
              </h2>
              <div className="grid grid-cols-5 gap-4">
                <SummaryCard label="Rebookings" value={all!.rebookings.toLocaleString('en-US')} />
                <SummaryCard label="Points saved" value={formatPoints(all!.pointsSaved)} accent="emerald" />
                <SummaryCard label="Actual cash saved" value={formatUsd(all!.cashSavedUsd)} accent="emerald" />
                <SummaryCard
                  label="Est. value of points"
                  value={formatUsd(all!.pointsValueUsd)}
                  accent="emerald"
                />
                <SummaryCard
                  label="Grand total saved"
                  value={formatUsd(all!.totalValueUsd)}
                  accent="emerald"
                  emphasize
                />
              </div>
            </section>

            {/* By month */}
            <BucketTable title="By month" buckets={report!.byMonth} />

            {/* By year */}
            <BucketTable title="By year" buckets={report!.byYear} />

            {/* Per-flight breakdown */}
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
                Rebooking history
              </h2>
              <Card className="overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3 text-left">Date</th>
                      <th className="px-4 py-3 text-left">Passenger</th>
                      <th className="px-4 py-3 text-left">Route</th>
                      <th className="px-4 py-3 text-left">Departs</th>
                      <th className="px-4 py-3 text-right">Original</th>
                      <th className="px-4 py-3 text-right">Rebooked</th>
                      <th className="px-4 py-3 text-right">Saved</th>
                      <th className="px-4 py-3 text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report!.events.map((e) => {
                      const isPoints = e.purchaseType === PurchaseType.Points;
                      const fmt = (n: number): string => (isPoints ? formatPoints(n) : formatUsd(n));
                      const saved = e.originalAmount - e.newAmount;
                      return (
                        <tr key={e.id} className="border-b border-slate-800/60 last:border-0">
                          <td className="px-4 py-3 text-slate-400">{formatDate(e.recordedAt)}</td>
                          <td className="px-4 py-3 text-slate-200">{e.passengerName}</td>
                          <td className="px-4 py-3 text-slate-200">{e.routeLabel}</td>
                          <td className="px-4 py-3 text-slate-400">{formatDate(e.departureDate)}</td>
                          <td className="px-4 py-3 text-right text-slate-300">{fmt(e.originalAmount)}</td>
                          <td className="px-4 py-3 text-right text-slate-300">{fmt(e.newAmount)}</td>
                          <td className="px-4 py-3 text-right">
                            <span className="inline-flex items-center gap-1 font-medium text-emerald-400">
                              <TrendingDown size={13} />
                              {fmt(saved)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-emerald-400">
                            {formatUsd(e.estimatedValueUsd)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            </section>

            <p className="text-[11px] leading-relaxed text-slate-600">
              A rebooking is recorded when “Import trips now” finds a new Southwest confirmation for
              a flight you already track (same date and route) booked at a lower price than the
              original. Savings are measured against each flight’s first booked price. Estimated
              value converts points saved to dollars using your point value in Settings.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function BucketTable({ title, buckets }: { title: string; buckets: SavingsBucket[] }): JSX.Element {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 text-left">Period</th>
              <th className="px-4 py-3 text-right">Rebookings</th>
              <th className="px-4 py-3 text-right">Points saved</th>
              <th className="px-4 py-3 text-right">Cash saved</th>
              <th className="px-4 py-3 text-right">Est. points value</th>
              <th className="px-4 py-3 text-right">Total saved</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.key} className="border-b border-slate-800/60 last:border-0">
                <td className="px-4 py-3 text-slate-200">{b.label}</td>
                <td className="px-4 py-3 text-right text-slate-300">
                  {b.rebookings.toLocaleString('en-US')}
                </td>
                <td className="px-4 py-3 text-right text-slate-300">{formatPoints(b.pointsSaved)}</td>
                <td className="px-4 py-3 text-right text-slate-300">{formatUsd(b.cashSavedUsd)}</td>
                <td className="px-4 py-3 text-right text-slate-300">{formatUsd(b.pointsValueUsd)}</td>
                <td className="px-4 py-3 text-right font-medium text-emerald-400">
                  {formatUsd(b.totalValueUsd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </section>
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
        <BarChart3 size={26} className="text-slate-500" />
      </div>
      <p className="text-sm font-medium text-slate-300">No rebooking savings yet</p>
      <p className="mt-1 max-w-md text-sm text-slate-500">
        When you rebook a tracked flight for the same date and route at a lower price, the savings
        will show up here. Run <span className="inline-flex items-center gap-1 text-slate-400"><Plane size={12} /> Import trips now</span> after rebooking to record it.
      </p>
    </div>
  );
}
