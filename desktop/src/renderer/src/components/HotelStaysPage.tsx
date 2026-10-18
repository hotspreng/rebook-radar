import { useCallback, useEffect, useMemo, useState } from 'react';
import { HOTEL_PROVIDER_LABELS, type HotelStay } from '@swr/core';
import type { EmailImportProgress } from '@shared/dto';
import { BedDouble, Inbox, MapPin, Phone, Users } from 'lucide-react';
import { Button, Card, CopyButton } from './ui.js';
import { formatStayMoment } from '../lib/format.js';
import { useAppStore } from '../store/useAppStore.js';

const api = window.swr;

/** Today as "YYYY-MM-DD" in local time, comparable with a stay's date part. */
function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function HotelStaysPage(): JSX.Element {
  const pushToast = useAppStore((s) => s.pushToast);
  const [stays, setStays] = useState<HotelStay[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<EmailImportProgress | null>(null);
  const [showPast, setShowPast] = useState(false);

  const refresh = useCallback(async () => {
    setStays(await api.hotels.list());
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => api.onEmailImportProgress(setProgress), []);

  const { upcoming, past } = useMemo(() => {
    const today = todayKey();
    const byCheckIn = [...stays].sort((a, b) => a.checkIn.localeCompare(b.checkIn));
    return {
      upcoming: byCheckIn.filter((s) => s.checkOut.slice(0, 10) >= today),
      past: byCheckIn.filter((s) => s.checkOut.slice(0, 10) < today).reverse(),
    };
  }, [stays]);

  async function handleImport(): Promise<void> {
    setImporting(true);
    setProgress(null);
    try {
      const r = await api.hotels.import();
      await refresh();
      pushToast(
        'success',
        `Scanned ${r.scanned} email(s): ${r.added} added, ${r.updated} updated, ${r.cancelled} cancelled.`,
      );
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
      setProgress(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 px-7 py-5">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Hotel stays</h1>
          <p className="text-sm text-slate-400">
            Reservations imported from Marriott, Hilton, Frankfurtflyer and AMEX Travel emails. Add them to an
            itinerary alongside your flights.
          </p>
        </div>
        <div className="relative">
          <Button variant="secondary" onClick={() => void handleImport()} disabled={importing}>
            <Inbox size={16} className={importing ? 'animate-pulse' : ''} /> Import from Gmail
          </Button>
          {importing && progress && progress.phase === 'scanning' && (
            <span className="absolute right-0 top-full mt-1 whitespace-nowrap text-[11px] text-slate-400">
              Reading emails{progress.total ? ` (${progress.scanned} of ${progress.total})` : '…'}
            </span>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
        {!loaded ? null : stays.length === 0 ? (
          <Card className="flex flex-col items-center px-8 py-14 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-800/60">
              <BedDouble size={26} className="text-slate-500" />
            </div>
            <p className="text-sm font-medium text-slate-300">No hotel stays yet</p>
            <p className="mt-1 max-w-md text-sm text-slate-500">
              Choose Import from Gmail to find reservation confirmations from reservations@res-marriott.com,
              noreply@h6.hilton.com, hotels@cube-travel.de (Frankfurtflyer) and AmericanExpress@welcome.americanexpress.com,
              including ones a relative forwarded to you.
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-8">
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Upcoming ({upcoming.length})
              </h2>
              {upcoming.length === 0 ? (
                <p className="text-sm text-slate-500">No upcoming stays.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {upcoming.map((stay) => (
                    <StayCard key={stay.id} stay={stay} />
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
                  {showPast ? 'Hide' : 'Show'} past stays ({past.length})
                </button>
                {showPast && (
                  <div className="flex flex-col gap-3">
                    {past.map((stay) => (
                      <StayCard key={stay.id} stay={stay} />
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

function StayCard({ stay }: { stay: HotelStay }): JSX.Element {
  const nights = stay.nights != null && stay.nights > 0 ? `${stay.nights} night${stay.nights === 1 ? '' : 's'}` : undefined;
  const party = [
    stay.guestNames.join(', ') || undefined,
    stay.guests != null ? `${stay.guests} guest${stay.guests === 1 ? '' : 's'}` : undefined,
    stay.rooms != null && stay.rooms > 1 ? `${stay.rooms} rooms` : undefined,
  ].filter(Boolean);

  return (
    <Card className="px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-100">{stay.hotelName}</h3>
          <p className="mt-0.5 text-sm text-slate-300">
            {formatStayMoment(stay.checkIn)} <span className="text-slate-500">→</span> {formatStayMoment(stay.checkOut)}
            {nights && <span className="ml-2 text-slate-500">{nights}</span>}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-slate-700 bg-slate-800/60 px-2.5 py-0.5 text-xs font-medium text-slate-300">
          {HOTEL_PROVIDER_LABELS[stay.provider]}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {stay.address && (
          <>
            <dt className="text-slate-500"><MapPin size={14} aria-label="Address" /></dt>
            <dd className="text-slate-300">{stay.address}</dd>
          </>
        )}
        {stay.phone && (
          <>
            <dt className="text-slate-500"><Phone size={14} aria-label="Phone" /></dt>
            <dd className="text-slate-300">{stay.phone}</dd>
          </>
        )}
        {party.length > 0 && (
          <>
            <dt className="text-slate-500"><Users size={14} aria-label="Guests" /></dt>
            <dd className="text-slate-300">{party.join(' · ')}</dd>
          </>
        )}
        {stay.roomType && (
          <>
            <dt className="text-slate-500"><BedDouble size={14} aria-label="Room" /></dt>
            <dd className="text-slate-300">{stay.roomType}</dd>
          </>
        )}
      </dl>

      {(stay.confirmationNumber || stay.bookingReference) && (
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-slate-800 pt-3 text-sm">
          {stay.confirmationNumber && (
            <span className="flex items-center gap-1.5 text-slate-400">
              Confirmation
              <span className="font-mono tracking-wide text-slate-200">{stay.confirmationNumber}</span>
              <CopyButton value={stay.confirmationNumber} label="Confirmation number" />
            </span>
          )}
          {stay.bookingReference && (
            <span className="flex items-center gap-1.5 text-slate-400">
              Booking reference
              <span className="font-mono tracking-wide text-slate-200">{stay.bookingReference}</span>
              <CopyButton value={stay.bookingReference} label="Booking reference" />
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
