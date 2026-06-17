import { useState } from 'react';
import type { Account, Passenger } from '@shared/dto';
import { KeyRound, Plus, RefreshCw, ShieldCheck, Trash2, LogIn, ShieldAlert } from 'lucide-react';
import { useAppStore } from '../store/useAppStore.js';
import { Button, Card, Field, Modal, inputClass } from './ui.js';
import { formatDateTime } from '../lib/format.js';

const api = window.swr;

export function AccountsPage(): JSX.Element {
  const { accounts, passengers, refreshAccounts, pushToast } = useAppStore();
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleDelete(account: Account): Promise<void> {
    await api.accounts.remove(account.id);
    await refreshAccounts();
    pushToast('info', `Removed ${account.label}.`);
  }

  async function handleTestLogin(account: Account): Promise<void> {
    setBusyId(account.id);
    try {
      const result = await api.accounts.testLogin(account.id);
      pushToast(result.ok ? 'success' : 'error', result.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleSync(account: Account): Promise<void> {
    setBusyId(account.id);
    try {
      const result = await api.accounts.syncTrips(account.id);
      await useAppStore.getState().refreshFlights();
      pushToast('success', `Imported ${result.imported}, skipped ${result.skipped} trip(s).`);
      await refreshAccounts();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 px-7 py-5">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Southwest accounts</h1>
          <p className="text-sm text-slate-400">Securely stored logins for automated trip & price sync.</p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus size={16} /> Add account
        </Button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-7 py-6">
        <SecurityNotice />

        {accounts.map((account) => (
          <Card key={account.id} className="flex items-center justify-between px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-800">
                <KeyRound size={18} className="text-brand-400" />
              </div>
              <div>
                <p className="font-medium text-slate-100">{account.label}</p>
                <p className="text-xs text-slate-500">
                  {account.username} ·{' '}
                  {account.hasStoredCredential ? (
                    <span className="text-emerald-400">password stored (encrypted)</span>
                  ) : (
                    <span className="text-amber-400">no password stored</span>
                  )}
                  {account.lastSyncedAt && ` · synced ${formatDateTime(account.lastSyncedAt)}`}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => void handleTestLogin(account)} disabled={busyId === account.id}>
                <LogIn size={15} /> Test
              </Button>
              <Button variant="secondary" onClick={() => void handleSync(account)} disabled={busyId === account.id}>
                <RefreshCw size={15} className={busyId === account.id ? 'animate-spin' : ''} /> Sync trips
              </Button>
              <button
                onClick={() => void handleDelete(account)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-red-400"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </Card>
        ))}

        {accounts.length === 0 && (
          <p className="py-10 text-center text-slate-500">No accounts yet. Add one to enable automated sync.</p>
        )}
      </div>

      {showForm && (
        <AccountFormModal passengers={passengers} onClose={() => setShowForm(false)} onSaved={refreshAccounts} />
      )}
    </div>
  );
}

function SecurityNotice(): JSX.Element {
  return (
    <Card className="flex gap-3 border-amber-500/20 bg-amber-500/5 px-5 py-4">
      <ShieldAlert size={20} className="mt-0.5 shrink-0 text-amber-400" />
      <div className="text-sm text-amber-100/90">
        <p className="font-medium text-amber-300">About automated login</p>
        <p className="mt-1 leading-relaxed text-amber-100/70">
          Passwords are encrypted with your operating system’s secure storage (Windows DPAPI) and never
          leave this computer in plain text. Automating Southwest’s website uses your own credentials and
          may be subject to Southwest’s Terms of Use; it can break when the site changes. You can always
          add flights manually instead.
        </p>
      </div>
    </Card>
  );
}

function AccountFormModal({
  passengers,
  onClose,
  onSaved,
}: {
  passengers: Passenger[];
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const [label, setLabel] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passengerIds, setPassengerIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(): Promise<void> {
    setError(null);
    if (!label.trim() || !username.trim()) return setError('Label and username are required.');
    setSaving(true);
    try {
      await api.accounts.create({
        account: { label: label.trim(), username: username.trim(), passengerIds },
        password,
      });
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
      title="Add Southwest account"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            <ShieldCheck size={16} /> {saving ? 'Saving…' : 'Save securely'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Account label">
          <input className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Dad's account" />
        </Field>
        <Field label="Username / Rapid Rewards #">
          <input className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Password" hint="Encrypted with Windows DPAPI. Never stored in plain text.">
          <input
            type="password"
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        {passengers.length > 0 && (
          <Field label="Map to passengers">
            <div className="space-y-1.5">
              {passengers.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={passengerIds.includes(p.id)}
                    onChange={(e) =>
                      setPassengerIds((prev) =>
                        e.target.checked ? [...prev, p.id] : prev.filter((id) => id !== p.id),
                      )
                    }
                  />
                  {p.fullName}
                </label>
              ))}
            </div>
          </Field>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    </Modal>
  );
}
