import { PurchaseType } from '@swr/core';
import type { FlightWithComparison } from '@shared/dto';
import { formatDateTime, formatDuration, formatNative, formatTime, formatUsd } from '../lib/format.js';

type Alternatives = NonNullable<FlightWithComparison['quote']>['alternatives'];
type Alternative = NonNullable<Alternatives>[number];

/**
 * Same-day departure options priced below what the traveler ORIGINALLY PAID,
 * excluding the matched departure itself. Using the paid amount as the baseline
 * keeps the "N cheaper" badge consistent with the "vs paid" column shown in the
 * expanded panel (which also compares against the paid amount).
 */
export function getCheaperAlternatives(item: FlightWithComparison): Alternative[] {
  const isPoints = item.flight.originalCost.purchaseType === PurchaseType.Points;
  const paidAmount = item.comparison?.originalAmount;
  const alternatives = item.quote?.alternatives ?? [];
  return alternatives.filter((a) => {
    const price = isPoints ? a.points : a.cashUsd;
    if (price == null) return false;
    if (paidAmount != null && price >= paidAmount) return false;
    return a.departureDateTime !== item.quote?.departureDateTime;
  });
}

/** Collapsible list of cheaper same-day departure options for a tracked flight. */
export function AlternativesPanel({
  alternatives,
  isPoints,
  originalAmount,
}: {
  alternatives: Alternatives;
  isPoints: boolean;
  /** What the traveler originally paid, in the booking unit (points or USD). */
  originalAmount?: number;
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
              <th className="px-3 py-2">Arrives</th>
              <th className="px-3 py-2">Duration</th>
              <th className="px-3 py-2">Flight</th>
              <th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2 text-right">vs paid</th>
            </tr>
          </thead>
          <tbody>
            {list.map((alt, i) => {
              const price = isPoints ? alt.points : alt.cashUsd;
              const diff =
                originalAmount != null && price != null ? originalAmount - price : undefined;
              return (
                <tr
                  key={`${alt.departureDateTime}-${alt.flightNumber ?? i}`}
                  className="border-t border-slate-800/60"
                >
                  <td className="px-3 py-2 text-slate-200">{formatDateTime(alt.departureDateTime)}</td>
                  <td className="px-3 py-2 text-slate-300">{formatTime(alt.arrivalDateTime)}</td>
                  <td className="px-3 py-2 text-slate-400">{formatDuration(alt.durationMinutes)}</td>
                  <td className="px-3 py-2 text-slate-400">{alt.flightNumber ?? '—'}</td>
                  <td className="px-3 py-2 text-right text-slate-200">
                    {formatNative(price, type)}
                    {alt.pointsEstimated && isPoints ? (
                      <span className="ml-1 text-[10px] text-slate-500">est.</span>
                    ) : null}
                    {isPoints && alt.cashUsd != null ? (
                      <span className="mt-0.5 block text-[11px] text-slate-500">
                        {formatUsd(alt.cashUsd)} cash
                      </span>
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
