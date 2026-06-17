import { useState } from 'react';
import type { Passenger } from '@shared/dto';
import { Plus, Trash2, Users } from 'lucide-react';
import { useAppStore } from '../store/useAppStore.js';
import { Button, Card, Field, Modal, inputClass } from './ui.js';

const api = window.swr;

export function PassengersPage(): JSX.Element {
  const { passengers, accounts, refreshPassengers, pushToast } = useAppStore();
  const [showForm, setShowForm] = useState(false);

  async function handleDelete(p: Passenger): Promise<void> {
    await api.passengers.remove(p.id);
    await refreshPassengers();
    pushToast('info', `Removed ${p.fullName}.`);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 px-7 py-5">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Passengers</h1>
          <p className="text-sm text-slate-400">People whose flights you track.</p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus size={16} /> Add passenger
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-7 py-6">
        {passengers.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {passengers.map((p) => (
              <Card key={p.id} className="flex items-center justify-between px-5 py-4">
                <div>
                  <p className="font-medium text-slate-100">{p.fullName}</p>
                  <p className="text-xs text-slate-500">
                    {p.rapidRewardsNumber ? `RR# ${p.rapidRewardsNumber}` : 'No Rapid Rewards number'}
                    {' · '}
                    {p.accountIds.length} account(s)
                  </p>
                </div>
                <button
                  onClick={() => void handleDelete(p)}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-red-400"
                >
                  <Trash2 size={16} />
                </button>
              </Card>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <PassengerFormModal
          accounts={accounts.map((a) => ({ id: a.id, label: a.label }))}
          onClose={() => setShowForm(false)}
          onSaved={refreshPassengers}
        />
      )}
    </div>
  );
}

function EmptyState(): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-slate-500">
      <Users size={36} />
      <p>No passengers yet. Add yourself and family members to start tracking flights.</p>
    </div>
  );
}

function PassengerFormModal({
  accounts,
  onClose,
  onSaved,
}: {
  accounts: { id: string; label: string }[];
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const [fullName, setFullName] = useState('');
  const [rr, setRr] = useState('');
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  async function handleSave(): Promise<void> {
    if (!fullName.trim()) return;
    setSaving(true);
    await api.passengers.create({
      fullName: fullName.trim(),
      rapidRewardsNumber: rr.trim() || undefined,
      accountIds,
    });
    onSaved();
    onClose();
  }

  return (
    <Modal
      title="Add passenger"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Full name">
          <input className={inputClass} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="As shown on booking" />
        </Field>
        <Field label="Rapid Rewards number" hint="Optional — helps match scraped trips.">
          <input className={inputClass} value={rr} onChange={(e) => setRr(e.target.value)} />
        </Field>
        {accounts.length > 0 && (
          <Field label="Linked accounts">
            <div className="space-y-1.5">
              {accounts.map((a) => (
                <label key={a.id} className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={accountIds.includes(a.id)}
                    onChange={(e) =>
                      setAccountIds((prev) =>
                        e.target.checked ? [...prev, a.id] : prev.filter((id) => id !== a.id),
                      )
                    }
                  />
                  {a.label}
                </label>
              ))}
            </div>
          </Field>
        )}
      </div>
    </Modal>
  );
}
