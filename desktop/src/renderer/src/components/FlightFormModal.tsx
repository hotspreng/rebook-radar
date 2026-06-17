import { useState } from 'react';
import {
  FareType,
  FlightSource,
  PurchaseType,
  type Flight,
  type NewFlight,
} from '@swr/core';
import type { Account, Passenger } from '@shared/dto';
import { Button, Field, Modal, inputClass } from './ui.js';
import { FARE_LABELS } from '../lib/format.js';

const api = window.swr;

interface Props {
  passengers: Passenger[];
  accounts: Account[];
  existing?: Flight;
  onClose: () => void;
  onSaved: () => void;
}

export function FlightFormModal({ passengers, accounts, existing, onClose, onSaved }: Props): JSX.Element {
  const [passengerId, setPassengerId] = useState(existing?.passengerId ?? passengers[0]?.id ?? '');
  const [accountId, setAccountId] = useState(existing?.accountId ?? '');
  const [confirmation, setConfirmation] = useState(existing?.confirmationNumber ?? '');
  const [origin, setOrigin] = useState(existing?.route.origin.code ?? '');
  const [destination, setDestination] = useState(existing?.route.destination.code ?? '');
  const [departure, setDeparture] = useState(existing?.departureDateTime?.slice(0, 16) ?? '');
  const [fareType, setFareType] = useState<FareType>(existing?.fareType ?? FareType.WannaGetAway);
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

  const isPoints = purchaseType === PurchaseType.Points;

  async function handleSave(): Promise<void> {
    setError(null);
    if (!passengerId) return setError('Choose a passenger.');
    if (!origin || !destination) return setError('Origin and destination are required.');
    if (!departure) return setError('Departure date/time is required.');

    setSaving(true);
    try {
      const base: NewFlight = {
        passengerId,
        accountId: accountId || undefined,
        confirmationNumber: confirmation.toUpperCase(),
        route: {
          origin: { code: origin.toUpperCase() },
          destination: { code: destination.toUpperCase() },
        },
        departureDateTime: new Date(departure).toISOString(),
        fareType,
        originalCost: {
          purchaseType,
          cashUsd: isPoints ? undefined : Number(cashUsd) || 0,
          points: isPoints ? Number(points) || 0 : undefined,
          taxesAndFeesUsd: Number(taxes) || 0,
        },
        bookingDate,
        source: existing?.source ?? FlightSource.Manual,
        notes: notes || undefined,
        monitoring,
      };

      if (existing) {
        await api.flights.update({ ...existing, ...base });
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
        <Field label="Account (optional)">
          <select className={inputClass} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">None</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Confirmation #">
          <input className={inputClass} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder="ABC123" />
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
