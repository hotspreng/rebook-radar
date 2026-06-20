import { PurchaseType, Recommendation } from '@swr/core';
import type { FlightWithComparison } from '@shared/dto';
import { ArrowRight, RefreshCw, Pencil, Trash2, X } from 'lucide-react';
import { Button, RecommendationBadge } from './ui.js';
import { AlternativesPanel, getCheaperAlternatives } from './AlternativesPanel.js';
import { FARE_LABELS, formatDate, formatDateTime, formatDuration, formatNative, formatTime, formatUsd } from '../lib/format.js';

interface Props {
  item: FlightWithComparison;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCheck: () => void;
  checking: boolean;
}

export function FlightDetailDrawer({ item, onClose, onEdit, onDelete, onCheck, checking }: Props): JSX.Element {
  const { flight, comparison } = item;
  const type = flight.originalCost.purchaseType;
  const isPoints = type === PurchaseType.Points;
  const cheaper = getCheaperAlternatives(item);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onMouseDown={onClose}>
      <div
        className="flex h-full w-[440px] flex-col border-l border-slate-800 bg-slate-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">{item.passengerName}</p>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-100">
              {flight.route.origin.code}
              <ArrowRight size={16} className="text-slate-500" />
              {flight.route.destination.code}
            </h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-800">
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <section className="grid grid-cols-2 gap-4 text-sm">
            <Detail label="Confirmation" value={flight.confirmationNumber || '—'} />
            <Detail label="Fare" value={FARE_LABELS[flight.fareType]} />
            <Detail label="Departure" value={formatDateTime(flight.departureDateTime)} />
            {flight.arrivalDateTime && (
              <Detail label="Arrival" value={formatDateTime(flight.arrivalDateTime)} />
            )}
            {flight.durationMinutes != null && (
              <Detail label="Travel time" value={formatDuration(flight.durationMinutes)} />
            )}
            <Detail label="Booked" value={formatDate(flight.bookingDate)} />
            <Detail label="Account" value={item.accountLabel ?? '—'} />
            <Detail label="Source" value={flight.source} />
          </section>

          {flight.segments && flight.segments.length > 0 && (
            <section className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-200">Flight segments</h3>
              <ol className="space-y-3">
                {flight.segments.map((seg, i) => (
                  <li key={`${seg.origin.code}-${seg.destination.code}-${i}`}>
                    {i > 0 && (
                      <p className="mb-2 text-[11px] uppercase tracking-wide text-amber-400">
                        Stop: change planes in {seg.origin.code}
                      </p>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-sm font-medium text-slate-100">
                        {seg.origin.code}
                        <ArrowRight size={14} className="text-slate-500" />
                        {seg.destination.code}
                      </span>
                      {seg.flightNumber && (
                        <span className="text-xs text-slate-500">{seg.flightNumber}</span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
                      <span>Departs {formatDateTime(seg.departureDateTime)}</span>
                      {seg.arrivalDateTime && <span>Arrives {formatTime(seg.arrivalDateTime)}</span>}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {flight.originalCost.payments && flight.originalCost.payments.length > 0 && (
            <section className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-200">Payment</h3>
              <div className="space-y-2">
                {flight.originalCost.payments.map((p, i) => (
                  <Row
                    key={`${p.label}-${i}`}
                    label={p.label}
                    value={
                      p.amountUsd != null
                        ? formatUsd(p.amountUsd)
                        : p.points != null
                          ? `${p.points.toLocaleString()} pts`
                          : '—'
                    }
                  />
                ))}
                <div className="mt-1 border-t border-slate-800 pt-2">
                  <Row
                    label="Total"
                    value={formatUsd(
                      flight.originalCost.payments.reduce((sum, p) => sum + (p.amountUsd ?? 0), 0),
                    )}
                    highlight
                  />
                </div>
              </div>
            </section>
          )}

          <section className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-200">Price comparison</h3>
            {comparison ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">Recommendation</span>
                  <RecommendationBadge value={comparison.recommendation} />
                </div>
                <Row label="Originally paid" value={formatNative(comparison.originalAmount, type)} />
                <Row
                  label="Current price"
                  value={
                    comparison.currentAmount != null ? formatNative(comparison.currentAmount, type) : '—'
                  }
                />
                {item.quote?.arrivalDateTime && (
                  <Row label="Arrives" value={formatTime(item.quote.arrivalDateTime)} />
                )}
                {item.quote?.durationMinutes != null && (
                  <Row label="Travel time" value={formatDuration(item.quote.durationMinutes)} />
                )}
                <Row
                  label={isPoints ? 'Points savings' : 'Cash savings'}
                  value={
                    comparison.savingsNative != null
                      ? formatNative(comparison.savingsNative, type)
                      : '—'
                  }
                  highlight={comparison.recommendation === Recommendation.Rebook}
                />
                <Row label="Value savings (USD)" value={formatUsd(comparison.savingsUsd)} />
                <Row label="Difference" value={`${comparison.percentDifference.toFixed(1)}%`} />
                <Row label="Point value used" value={`${comparison.pointValueCents.toFixed(2)}¢/pt`} />
                <p className="mt-2 rounded-lg bg-slate-800/50 p-3 text-xs leading-relaxed text-slate-300">
                  {comparison.rationale}
                </p>
                <p className="text-[11px] text-slate-500">
                  Computed {formatDateTime(comparison.computedAt)}
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-400">
                No price check yet. Run a check to compare against the current Southwest price.
              </p>
            )}
          </section>

          {cheaper.length > 0 && (
            <section className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
              <h3 className="mb-3 text-sm font-semibold text-emerald-400">
                {cheaper.length} cheaper same-day option{cheaper.length > 1 ? 's' : ''}
              </h3>
              <AlternativesPanel
                alternatives={cheaper}
                isPoints={isPoints}
                currentAmount={comparison?.currentAmount}
              />
            </section>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-slate-800 px-5 py-3">
          <Button variant="danger" onClick={onDelete}>
            <Trash2 size={16} /> Delete
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onEdit}>
              <Pencil size={16} /> Edit
            </Button>
            <Button onClick={onCheck} disabled={checking}>
              <RefreshCw size={16} className={checking ? 'animate-spin' : ''} /> Check price
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 capitalize text-slate-200">{value}</p>
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }): JSX.Element {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-400">{label}</span>
      <span className={highlight ? 'font-semibold text-emerald-400' : 'text-slate-200'}>{value}</span>
    </div>
  );
}
