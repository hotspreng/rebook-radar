import { useCallback, useEffect, useState } from 'react';
import type { AirlineTrendSummary, PriceTrendBucket, PriceTrends } from '@shared/dto';
import { Activity, CalendarClock, LineChart as LineChartIcon, Plane, RefreshCw } from 'lucide-react';
import { Button, Card } from './ui.js';

const api = window.swr;

const SW_COLOR = '#3b82f6'; // blue-500 — Southwest
const UA_COLOR = '#f59e0b'; // amber-500 — United

export function TrendsPage(): JSX.Element {
  const [trends, setTrends] = useState<PriceTrends | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTrends(await api.reporting.priceTrends());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hasData = (trends?.totalObservations ?? 0) > 0;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 px-7 py-5">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Trends</h1>
          <p className="text-sm text-slate-400">
            How average cash fares move from months out to right before departure.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-7 py-6">
        {loading && !trends ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : !hasData ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col gap-6">
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <AirlineSummaryCard summary={trends!.southwest} color={SW_COLOR} name="Southwest" />
              <AirlineSummaryCard summary={trends!.united} color={UA_COLOR} name="United" />
              <StatCard
                icon={<Activity size={16} />}
                label="Price observations"
                value={trends!.totalObservations.toLocaleString('en-US')}
                hint="Recorded price checks that saw a change"
              />
              <StatCard
                icon={<CalendarClock size={16} />}
                label="Flights tracked"
                value={(trends!.southwest.flights + trends!.united.flights).toLocaleString('en-US')}
                hint="Contributing at least two observations"
              />
            </div>

            {/* Main chart */}
            <Card className="px-6 py-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-200">Average cash fare by lead time</h2>
                  <p className="text-xs text-slate-500">
                    Index where 100 = each flight&apos;s own average cash fare. Points prices and
                    point conversions are excluded.
                  </p>
                </div>
                <Legend />
              </div>
              <TrendLineChart buckets={trends!.buckets} />
            </Card>

            {/* Bucket table */}
            <Card className="overflow-hidden">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-left">Lead time</th>
                    <th className="px-4 py-3 text-right">Southwest</th>
                    <th className="px-4 py-3 text-right">SW samples</th>
                    <th className="px-4 py-3 text-right">United</th>
                    <th className="px-4 py-3 text-right">UA samples</th>
                  </tr>
                </thead>
                <tbody>
                  {trends!.buckets.map((b) => (
                    <tr key={b.label} className="border-b border-slate-800/60 last:border-0">
                      <td className="px-4 py-2.5 text-slate-300">{b.label}</td>
                      <td className="px-4 py-2.5 text-right text-slate-200">{fmtIndex(b.southwestIndex)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-500">{b.southwestSamples || '—'}</td>
                      <td className="px-4 py-2.5 text-right text-slate-200">{fmtIndex(b.unitedIndex)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-500">{b.unitedSamples || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <p className="text-[11px] leading-relaxed text-slate-600">
              Based only on actual observed cash fares. Each cash observation is normalized to its
              flight&apos;s average cash fare, then averaged across all flights sharing a lead-time
              window. A value below 100 means cash fares in that window tend to run cheaper than
              that flight&apos;s typical price — a good time to book or rebook. Points prices and
              points-to-cash estimates are excluded, so the curve reflects real market cash
              movement only. It sharpens as you record more price checks over time.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function fmtIndex(v?: number): string {
  return v == null ? '—' : v.toFixed(0);
}

function fmtPct(v?: number): string {
  return v == null ? '—' : `${v.toFixed(1)}%`;
}

function Legend(): JSX.Element {
  return (
    <div className="flex items-center gap-4 text-xs text-slate-400">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SW_COLOR }} />
        Southwest
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: UA_COLOR }} />
        United
      </span>
    </div>
  );
}

function AirlineSummaryCard({
  summary,
  color,
  name,
}: {
  summary: AirlineTrendSummary;
  color: string;
  name: string;
}): JSX.Element {
  return (
    <Card className="px-5 py-4">
      <div className="mb-2 flex items-center gap-2">
        <Plane size={16} style={{ color }} />
        <span className="text-sm font-semibold text-slate-200">{name}</span>
      </div>
      {summary.observations === 0 ? (
        <p className="text-xs text-slate-500">No price history yet.</p>
      ) : (
        <div className="space-y-1.5 text-xs">
          <Line label="Cheapest window" value={summary.cheapestWindowLabel ?? '—'} strong />
          <Line label="Volatility" value={fmtPct(summary.volatilityPct)} />
          <Line label="Observations" value={summary.observations.toLocaleString('en-US')} />
        </div>
      )}
    </Card>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }): JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={strong ? 'font-semibold text-emerald-400' : 'text-slate-300'}>{value}</span>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: JSX.Element;
  label: string;
  value: string;
  hint?: string;
}): JSX.Element {
  return (
    <Card className="px-5 py-4">
      <div className="mb-2 flex items-center gap-2 text-slate-400">
        {icon}
        <span className="text-sm font-semibold text-slate-200">{label}</span>
      </div>
      <p className="text-2xl font-semibold text-slate-100">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </Card>
  );
}

function TrendLineChart({ buckets }: { buckets: PriceTrendBucket[] }): JSX.Element {
  const width = 640;
  const height = 240;
  const padL = 40;
  const padR = 16;
  const padT = 16;
  const padB = 30;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const n = buckets.length;

  const values = buckets.flatMap((b) =>
    [b.southwestIndex, b.unitedIndex].filter((v): v is number => v != null),
  );
  if (values.length === 0) {
    return <p className="py-10 text-center text-sm text-slate-500">Not enough data to chart yet.</p>;
  }
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const domainMin = Math.floor(Math.min(dataMin, 95) / 5) * 5;
  const domainMax = Math.ceil(Math.max(dataMax, 105) / 5) * 5;
  const span = domainMax - domainMin || 1;

  const x = (i: number): number => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number): number => padT + ((domainMax - v) / span) * plotH;

  const seriesPath = (get: (b: PriceTrendBucket) => number | undefined): string => {
    const pts = buckets
      .map((b, i) => ({ i, v: get(b) }))
      .filter((p): p is { i: number; v: number } => p.v != null);
    return pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
  };

  const seriesDots = (get: (b: PriceTrendBucket) => number | undefined, color: string): JSX.Element[] =>
    buckets
      .map((b, i) => ({ i, v: get(b) }))
      .filter((p): p is { i: number; v: number } => p.v != null)
      .map((p) => <circle key={`${color}-${p.i}`} cx={x(p.i)} cy={y(p.v)} r={2.6} fill={color} />);

  // Horizontal gridlines at rounded steps.
  const ticks: number[] = [];
  for (let t = domainMin; t <= domainMax; t += 5) ticks.push(t);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-64 w-full" role="img" aria-label="Average fare by lead time">
      {/* gridlines + y labels */}
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={padL}
            y1={y(t)}
            x2={width - padR}
            y2={y(t)}
            stroke={t === 100 ? '#475569' : '#1e293b'}
            strokeWidth={1}
            strokeDasharray={t === 100 ? '4 4' : undefined}
          />
          <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize={9} fill="#64748b">
            {t}
          </text>
        </g>
      ))}

      {/* x labels */}
      {buckets.map((b, i) => (
        <text key={b.label} x={x(i)} y={height - 10} textAnchor="middle" fontSize={9} fill="#64748b">
          {b.label}
        </text>
      ))}

      {/* series */}
      <path d={seriesPath((b) => b.southwestIndex)} fill="none" stroke={SW_COLOR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <path d={seriesPath((b) => b.unitedIndex)} fill="none" stroke={UA_COLOR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {seriesDots((b) => b.southwestIndex, SW_COLOR)}
      {seriesDots((b) => b.unitedIndex, UA_COLOR)}

      {/* axis captions */}
      <text x={padL} y={11} fontSize={9} fill="#64748b">
        % of avg cash fare
      </text>
      <text x={width - padR} y={height - 10} textAnchor="end" fontSize={9} fill="#475569">
        → closer to departure
      </text>
    </svg>
  );
}

function EmptyState(): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center text-slate-500">
      <LineChartIcon size={40} />
      <p className="max-w-md text-sm">
        No cash price history yet. Trends build up as you run price checks over time — each check
        that sees a changed cash fare records a data point. Points-only prices and point estimates
        are excluded. Check prices periodically (or enable monitoring) and the lead-time curves for
        Southwest and United will appear here.
      </p>
    </div>
  );
}
