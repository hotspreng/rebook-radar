import { useCallback, useEffect, useMemo, useState } from 'react';
import { BUS_PROVIDER_LABELS, busAirportDirection, type BusRide } from '@swr/core';
import type { EmailImportProgress } from '@shared/dto';
import { ArrowRight, Bus, Inbox, MapPin, Users } from 'lucide-react';
import { Button, Card, CopyButton } from './ui.js';
import { formatStayMoment } from '../lib/format.js';
import { runFullImport } from '../lib/importAll.js';

const api = window.swr;

/** Today as "YYYY-MM-DD" in local time, comparable with a ride's date part. */
function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function BusRidesPage(): JSX.Element {
  const [rides, setRides] = useState<BusRide[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<EmailImportProgress | null>(null);
  const [showPast, setShowPast] = useState(false);

  const refresh = useCallback(async () => {
    setRides(await api.buses.list());
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => api.onEmailImportProgress(setProgress), []);

  const { upcoming, past } = useMemo(() => {
    const today = todayKey();
    const byDeparture = [...rides].sort((a, b) => a.departureAt.localeCompare(b.departureAt));
    return {
      upcoming: byDeparture.filter((r) => r.arrivalAt.slice(0, 10) >= today),
      past: byDeparture.filter((r) => r.arrivalAt.slice(0, 10) < today).reverse(),
    };
  }, [rides]);

  async function handleImport(): Promise<void> {
    setImporting(true);
    setProgress(null);
    try {
      await runFullImport();
      await refresh();
    } finally {
      setImporting(false);
      setProgress(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 px-7 py-5">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Bus rides</h1>
          <p className="text-sm text-slate-400">
            Airport transfers imported from OurBus emails. Add them to an itinerary alongside your flights.
          </p>
        </div>
        <div className="relative">
          <Button variant="secondary" onClick={() => void handleImport()} disabled={importing}>
            <Inbox size={16} className={importing ? 'animate-pulse' : ''} /> Import from Gmail
          </Button>
          {importing && progress && progress.phase === 'scanning' && (
            <span className="absolute right-0 top-full mt-1 whitespace-nowrap text-[11px] text-slate-400">
              {progress.stage
                ? `Importing ${progress.stage.toLowerCase()}…`
                : `Reading emails${progress.total ? ` (${progress.scanned} of ${progress.total})` : '…'}`}
            </span>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
        {!loaded ? null : rides.length === 0 ? (
          <Card className="flex flex-col items-center px-8 py-14 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-800/60">
              <Bus size={26} className="text-slate-500" />
            </div>
            <p className="text-sm font-medium text-slate-300">No bus rides yet</p>
            <p className="mt-1 max-w-md text-sm text-slate-500">
              Choose Import from Gmail to find ticket emails from mailadmin@ourbus.com, including ones a relative
              forwarded to you.
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-8">
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Upcoming ({upcoming.length})
              </h2>
              {upcoming.length === 0 ? (
                <p className="text-sm text-slate-500">No upcoming rides.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {upcoming.map((ride) => (
                    <RideCard key={ride.id} ride={ride} />
                  ))}
                </div>
              )}
            </section>

            {past.length > 0 && (
              <section>
                <button
                  type="button"
                  onClick={() => setShowPast((v) => !v)}
                  className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-200"
                  aria-expanded={showPast}
                >
                  {showPast ? 'Hide' : 'Show'} past rides ({past.length})
                </button>
                {showPast && (
                  <div className="flex flex-col gap-3">
                    {past.map((ride) => (
                      <RideCard key={ride.id} ride={ride} />
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const DIRECTION_LABELS = { to: 'To airport', from: 'From airport' } as const;

function RideCard({ ride }: { ride: BusRide }): JSX.Element {
  const direction = busAirportDirection(ride);

  return (
    <Card className="px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-base font-semibold text-slate-100">
            {ride.departureCity}
            <ArrowRight size={15} className="shrink-0 text-slate-500" />
            {ride.arrivalCity}
          </h3>
          <p className="mt-0.5 text-sm text-slate-300">
            {formatStayMoment(ride.departureAt)} <span className="text-slate-500">→</span>{' '}
            {formatStayMoment(ride.arrivalAt)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {direction && (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-200">
              {DIRECTION_LABELS[direction]}
            </span>
          )}
          <span className="rounded-full border border-slate-700 bg-slate-800/60 px-2.5 py-0.5 text-xs font-medium text-slate-300">
            {BUS_PROVIDER_LABELS[ride.provider]}
          </span>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {ride.departureStop && (
          <>
            <dt className="text-slate-500"><MapPin size={14} aria-label="Boarding" /></dt>
            <dd className="text-slate-300">
              <span className="text-slate-500">Board: </span>
              {ride.departureStop}
            </dd>
          </>
        )}
        {ride.arrivalStop && (
          <>
            <dt className="text-slate-500"><MapPin size={14} aria-label="Drop-off" /></dt>
            <dd className="text-slate-300">
              <span className="text-slate-500">Drop-off: </span>
              {ride.arrivalStop}
            </dd>
          </>
        )}
        {(ride.operator || ride.vehicle) && (
          <>
            <dt className="text-slate-500"><Bus size={14} aria-label="Operator" /></dt>
            <dd className="text-slate-300">{[ride.vehicle, ride.operator && `operated by ${ride.operator}`].filter(Boolean).join(' · ')}</dd>
          </>
        )}
        {ride.passengerNames.length > 0 && (
          <>
            <dt className="text-slate-500"><Users size={14} aria-label="Passengers" /></dt>
            <dd className="text-slate-300">{ride.passengerNames.join(', ')}</dd>
          </>
        )}
      </dl>

      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-slate-800 pt-3 text-sm">
        <span className="flex items-center gap-1.5 text-slate-400">
          Ticket reference
          <span className="font-mono tracking-wide text-slate-200">{ride.ticketReference}</span>
          <CopyButton value={ride.ticketReference} label="Ticket reference" />
        </span>
      </div>
    </Card>
  );
}
