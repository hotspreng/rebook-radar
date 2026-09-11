import { useState } from 'react';
import {
  AIRLINE_LABELS,
  Airline,
  FareType,
  FlightSource,
  PurchaseType,
  type Flight,
  type NewFlight,
} from '@swr/core';
import type { Passenger } from '@shared/dto';
import { Button, Field, Modal, inputClass } from './ui.js';
import { FARE_LABELS, formatDateTime } from '../lib/format.js';

const api = window.swr;

interface Props {
  passengers: Passenger[];
  existing?: Flight;
  /** All legs sharing this booking's confirmation number (>=2 = round trip). */
  groupLegs?: Flight[];
  onClose: () => void;
  onSaved: () => void;
}

type LegAmount = { points: string; cashUsd: string; taxes: string };

export function FlightFormModal({ passengers, existing, groupLegs, onClose, onSaved }: Props): JSX.Element {
  const [passengerId, setPassengerId] = useState(existing?.passengerId ?? passengers[0]?.id ?? '');
  const [airline, setAirline] = useState<Airline>(existing?.airline ?? Airline.Southwest);
  const [confirmation, setConfirmation] = useState(existing?.confirmationNumber ?? '');
  const [origin, setOrigin] = useState(existing?.route.origin.code ?? '');
  const [destination, setDestination] = useState(existing?.route.destination.code ?? '');
  const [departure, setDeparture] = useState(existing?.departureDateTime?.slice(0, 16) ?? '');
  const [fareType, setFareType] = useState<FareType>(existing?.fareType ?? FareType.Choice);
  const [purchaseType, setPurchaseType] = useState<PurchaseType>(
    existing?.originalCost.purchaseType ?? PurchaseType.Cash,
  );
  const [cashUsd, setCashUsd] = useState(existing?.originalCost.cashUsd?.toString() ?? '');
  const [points, setPoints] = useState(existing?.originalCost.points?.toString() ?? '');
  const [taxes, setTaxes] = useState(existing?.originalCost.taxesAndFeesUsd?.toString() ?? '0');
  const [bookingDate, setBookingDate] = useState(
    existing?.bookingDate ?? new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [monitoring, setMonitoring] = useState(existing?.monitoring ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roundTripLegs = (groupLegs?.length ?? 0) >= 2 ? groupLegs! : undefined;
  const isRoundTrip = roundTripLegs != null;
  const [legAmounts, setLegAmounts] = useState<Record<string, LegAmount>>(() => {
    const init: Record<string, LegAmount> = {};
    for (const leg of roundTripLegs ?? []) {
      init[leg.id] = {
        points: leg.originalCost.points?.toString() ?? '',
        cashUsd: leg.originalCost.cashUsd?.toString() ?? '',
        taxes: leg.originalCost.taxesAndFeesUsd?.toString() ?? '0',
      };
    }
    return init;
  });

  function setLegAmount(legId: string, field: keyof LegAmount, value: string): void {
    setLegAmounts((prev) => ({
      ...prev,
      [legId]: { ...(prev[legId] ?? { points: '', cashUsd: '', taxes: '0' }), [field]: value },
    }));
  }

  const isPoints = purchaseType === PurchaseType.Points;

  async function handleSave(): Promise<void> {
    setError(null);
    if (!passengerId) return setError('Choose a passenger.');
    if (!origin || !destination) return setError('Origin and destination are required.');
    if (!departure) return setError('Departure date/time is required.');

    setSaving(true);
    try {
      // For a round trip the current leg's amount comes from its per-leg inputs;
      // for a single flight it comes from the shared amount fields.
      const currentAmt =
        isRoundTrip && existing ? legAmounts[existing.id] : undefined;
      const currentLegPoints = currentAmt ? currentAmt.points : points;
      const currentLegCash = currentAmt ? currentAmt.cashUsd : cashUsd;
      const currentLegTaxes = currentAmt ? currentAmt.taxes : taxes;
      const base: NewFlight = {
        passengerId,
        airline,
        confirmationNumber: confirmation.toUpperCase(),
        route: {
          origin: { code: origin.toUpperCase() },
          destination: { code: destination.toUpperCase() },
        },
        departureDateTime: new Date(departure).toISOString(),
        fareType,
        originalCost: {
          purchaseType,
          cashUsd: isPoints ? undefined : Number(currentLegCash) || 0,
          points: isPoints ? Number(currentLegPoints) || 0 : undefined,
          taxesAndFeesUsd: Number(currentLegTaxes) || 0,
        },
        bookingDate,
        source: existing?.source ?? FlightSource.Manual,
        notes: notes || undefined,
        monitoring,
      };

      if (existing) {
        await api.flights.update({ ...existing, ...base });
        // Round trip: apply each leg's manually-entered amount to that leg. The
        // confirmation email only carries the booking total, so this lets the
        // user record the real per-leg split instead of the even estimate.
        if (isRoundTrip && roundTripLegs) {
          for (const leg of roundTripLegs) {
            if (leg.id === existing.id) continue;
            const amt = legAmounts[leg.id] ?? { points: '', cashUsd: '', taxes: '0' };
            await api.flights.update({
              ...leg,
              originalCost: {
                purchaseType,
                cashUsd: isPoints ? undefined : Number(amt.cashUsd) || 0,
                points: isPoints ? Number(amt.points) || 0 : undefined,
                taxesAndFeesUsd: Number(amt.taxes) || 0,
              },
            });
          }
        }
      } else {
        await api.flights.create(base);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={existing ? 'Edit flight' : 'Add flight'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save flight'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Passenger">
          <select className={inputClass} value={passengerId} onChange={(e) => setPassengerId(e.target.value)}>
            <option value="">Select…</option>
            {passengers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Confirmation #">
          <input className={inputClass} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder="ABC123" />
        </Field>
        <Field label="Airline">
          <select className={inputClass} value={airline} onChange={(e) => setAirline(e.target.value as Airline)}>
            {Object.values(Airline).map((a) => (
              <option key={a} value={a}>
                {AIRLINE_LABELS[a]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Fare type">
          <select className={inputClass} value={fareType} onChange={(e) => setFareType(e.target.value as FareType)}>
            {Object.values(FareType).map((f) => (
              <option key={f} value={f}>
                {FARE_LABELS[f]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Origin">
          <input className={inputClass} value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="MDW" maxLength={3} />
        </Field>
        <Field label="Destination">
          <input className={inputClass} value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="DEN" maxLength={3} />
        </Field>
        <Field label="Departure">
          <input type="datetime-local" className={inputClass} value={departure} onChange={(e) => setDeparture(e.target.value)} />
        </Field>
        <Field label="Booking date">
          <input type="date" className={inputClass} value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} />
        </Field>
        <Field label="Paid with">
          <div className="flex gap-2">
            {[PurchaseType.Cash, PurchaseType.Points].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setPurchaseType(t)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm capitalize ${
                  purchaseType === t
                    ? 'border-brand-500 bg-brand-600/15 text-brand-300'
                    : 'border-slate-700 text-slate-400'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </Field>
        {isRoundTrip ? (
          <div className="col-span-2">
            <p className="text-sm font-medium text-slate-200">Amount paid per leg</p>
            <p className="mb-3 mt-0.5 text-xs text-slate-500">
              The confirmation email only shows the booking total, so legs are split evenly by
              default. Enter the actual {isPoints ? 'points' : 'cash'} and taxes paid for each leg.
            </p>
            <div className="space-y-3">
              {roundTripLegs!.map((leg) => {
                const amt = legAmounts[leg.id] ?? { points: '', cashUsd: '', taxes: '0' };
                return (
                  <div key={leg.id} className="rounded-lg border border-slate-700 p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-slate-300">
                      <span className="font-medium">
                        {leg.route.origin.code} → {leg.route.destination.code}
                      </span>
                      <span className="text-xs text-slate-500">
                        {formatDateTime(leg.departureDateTime)}
                      </span>
                      {existing?.id === leg.id && (
                        <span className="text-[11px] text-brand-300">(editing)</span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label={isPoints ? 'Points paid' : 'Cash paid (USD)'}>
                        <input
                          className={inputClass}
                          type="number"
                          step={isPoints ? '1' : '0.01'}
                          value={isPoints ? amt.points : amt.cashUsd}
                          onChange={(e) =>
                            setLegAmount(leg.id, isPoints ? 'points' : 'cashUsd', e.target.value)
                          }
                          placeholder={isPoints ? '12000' : '149.98'}
                        />
                      </Field>
                      <Field label="Taxes & fees (USD)">
                        <input
                          className={inputClass}
                          type="number"
                          step="0.01"
                          value={amt.taxes}
                          onChange={(e) => setLegAmount(leg.id, 'taxes', e.target.value)}
                          placeholder="5.60"
                        />
                      </Field>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <>
            {isPoints ? (
              <Field label="Points paid">
                <input className={inputClass} type="number" value={points} onChange={(e) => setPoints(e.target.value)} placeholder="12000" />
              </Field>
            ) : (
              <Field label="Cash paid (USD)">
                <input className={inputClass} type="number" step="0.01" value={cashUsd} onChange={(e) => setCashUsd(e.target.value)} placeholder="149.98" />
              </Field>
            )}
            <Field label="Taxes & fees (USD)">
              <input className={inputClass} type="number" step="0.01" value={taxes} onChange={(e) => setTaxes(e.target.value)} placeholder="5.60" />
            </Field>
          </>
        )}
        <div className="col-span-2">
          <Field label="Notes">
            <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </Field>
        </div>
        <label className="col-span-2 flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={monitoring} onChange={(e) => setMonitoring(e.target.checked)} />
          Monitor this flight for price drops
        </label>
      </div>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </Modal>
  );
}
