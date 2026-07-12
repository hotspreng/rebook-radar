import { useEffect, useState } from 'react';
import type { AppSettings, EmailImportResult, EmailStatus, Passenger, SerpApiKeyUsage } from '@shared/dto';
import { Airline } from '@swr/core';
import { Activity, Mail, Plug, Plus, RefreshCw, Save, Trash2, Users } from 'lucide-react';
import { useAppStore } from '../store/useAppStore.js';
import { Button, Card, Field, Modal, inputClass } from './ui.js';
import { formatDateTime } from '../lib/format.js';

const api = window.swr;

export function SettingsPage(): JSX.Element {
  const { settings, monitor, passengers, refreshPassengers, updateSettings, pushToast } = useAppStore();
  const [draft, setDraft] = useState<AppSettings | null>(settings);
  const [saving, setSaving] = useState(false);
  const [warming, setWarming] = useState(false);
  const [showPassengerForm, setShowPassengerForm] = useState(false);

  async function handleDeletePassenger(p: Passenger): Promise<void> {
    await api.passengers.remove(p.id);
    await refreshPassengers();
    pushToast('info', `Removed ${p.fullName}.`);
  }

  if (!draft) return <div className="p-8 text-slate-400">Loading…</div>;

  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  /** Update the draft AND persist immediately (for toggles/selects that should
   * take effect without clicking "Save settings"). */
  function setPersist<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    void updateSettings({ [key]: value } as Partial<AppSettings>);
  }

  /** Update one airline's cents-per-point rate and persist immediately. */
  function setAirlineRate(airline: Airline, value: number): void {
    if (!draft) return;
    const next = { ...draft.pointValueCentsByAirline, [airline]: value };
    setDraft((d) => (d ? { ...d, pointValueCentsByAirline: next } : d));
    void updateSettings({ pointValueCentsByAirline: next });
  }

  async function handleSave(): Promise<void> {
    if (!draft) return;
    setSaving(true);
    await updateSettings(draft);
    setSaving(false);
    pushToast('success', 'Settings saved.');
  }

  async function handleWarmProfile(): Promise<void> {
    setWarming(true);
    pushToast('info', 'Opening Southwest… do one manual search, then close the window.');
    try {
      await api.settings.warmScraperProfile();
      pushToast('success', 'Scraper profile warmed. Automated price checks should work now.');
    } catch (err) {
      pushToast('error', `Could not warm profile: ${String(err)}`);
    } finally {
      setWarming(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 px-7 py-5">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Settings</h1>
          <p className="text-sm text-slate-400">Valuation, alerts, monitoring, and data source.</p>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          <Save size={16} /> {saving ? 'Saving…' : 'Save settings'}
        </Button>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-7 py-6">
        <Card className="px-6 py-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-200">Passengers</h2>
              <p className="text-xs text-slate-500">People whose flights you track.</p>
            </div>
            <Button variant="secondary" onClick={() => setShowPassengerForm(true)}>
              <Plus size={16} /> Add passenger
            </Button>
          </div>
          {passengers.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center text-slate-500">
              <Users size={28} />
              <p className="text-sm">
                No passengers yet. Add yourself and family members to start tracking flights.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {passengers.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 px-4 py-3"
                >
                  <div>
                    <p className="font-medium text-slate-100">{p.fullName}</p>
                    <p className="text-xs text-slate-500">
                      {p.rapidRewardsNumber
                        ? `RR# ${p.rapidRewardsNumber}`
                        : 'No Rapid Rewards number'}
                    </p>
                  </div>
                  <button
                    onClick={() => void handleDeletePassenger(p)}
                    className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-red-400"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="px-6 py-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-200">Points valuation</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Southwest — cents per point"
              hint="The Points Guy values Southwest Rapid Rewards points at about 1.4¢ each."
            >
              <AwardRateInput
                value={draft.pointValueCentsByAirline[Airline.Southwest]}
                onCommit={(v) => setAirlineRate(Airline.Southwest, v)}
              />
            </Field>
            <Field
              label="United — cents per mile"
              hint="The Points Guy values United MileagePlus miles at about 1.35¢ each."
            >
              <AwardRateInput
                value={draft.pointValueCentsByAirline[Airline.United]}
                onCommit={(v) => setAirlineRate(Airline.United, v)}
              />
            </Field>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Used to estimate award points from a cash fare and to value points savings in
            dollars. Each airline's award program redeems differently, so they're tuned
            separately.
          </p>
        </Card>

        <Card className="px-6 py-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-200">Alerts</h2>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Cash alert threshold (USD)">
              <input
                type="number"
                className={inputClass}
                value={draft.savingsAlertThresholdUsd}
                onChange={(e) => set('savingsAlertThresholdUsd', Number(e.target.value))}
              />
            </Field>
            <Field label="Points alert threshold">
              <input
                type="number"
                className={inputClass}
                value={draft.savingsAlertThresholdPoints}
                onChange={(e) => set('savingsAlertThresholdPoints', Number(e.target.value))}
              />
            </Field>
            <Field label="Poll interval (minutes)">
              <input
                type="number"
                min="5"
                className={inputClass}
                value={draft.pollIntervalMinutes}
                onChange={(e) => set('pollIntervalMinutes', Number(e.target.value))}
              />
            </Field>
          </div>
        </Card>

        <Card className="px-6 py-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-200">Monitoring</h2>
          <Toggle
            label="Enable background price monitoring"
            description="Polls current prices on the interval above and sends Windows notifications when savings clear your threshold."
            checked={draft.monitoringEnabled}
            onChange={(v) => setPersist('monitoringEnabled', v)}
          />
          {monitor && (
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
              <Activity size={14} className={monitor.running ? 'text-emerald-400' : 'text-slate-600'} />
              {monitor.running ? 'Running' : 'Stopped'}
              {monitor.lastRunAt && ` · last run ${formatDateTime(monitor.lastRunAt)}`}
              {monitor.nextRunAt && monitor.running && ` · next ${formatDateTime(monitor.nextRunAt)}`}
              {monitor.lastError && <span className="text-red-400"> · {monitor.lastError}</span>}
            </div>
          )}
        </Card>

        <Card className="px-6 py-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-200">Data source</h2>
          <GmailImportCard />
        </Card>

        <Card className="px-6 py-5">
          <h2 className="mb-1 text-sm font-semibold text-slate-200">Live price source</h2>
          <p className="mb-4 text-xs text-slate-500">
            How current fares are fetched. <strong>SerpApi (Google Flights)</strong> reads Southwest
            cash fares via an API and estimates the points cost — reliable, no bot checks.
            <strong> Scraper</strong> drives a browser against southwest.com to read real points
            (often blocked by Southwest&apos;s bot protection).
          </p>
          <label className="flex items-center justify-between gap-4">
            <span className="text-sm text-slate-200">
              Source
              <span className="mt-0.5 block text-xs text-slate-500">
                Southwest award (points) pricing isn&apos;t published to third parties, so SerpApi
                returns an estimated points value from the cash fare.
              </span>
            </span>
            <select
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-200"
              value={draft.fareSource}
              onChange={(e) => setPersist('fareSource', e.target.value as 'scraper' | 'serpapi')}
            >
              <option value="serpapi">SerpApi (Google Flights)</option>
              <option value="scraper">Scraper (southwest.com)</option>
            </select>
          </label>
          {draft.fareSource === 'serpapi' && (
            <div className="mt-4 space-y-4">
              <SerpApiKeyEditor
                slots={draft.serpApiKeys}
                onSaved={(next) => setDraft(next)}
              />
            </div>
          )}
        </Card>

        <Card className="px-6 py-5">
          <h2 className="mb-1 text-sm font-semibold text-slate-200">Live price scraping (southwest.com)</h2>
          <p className="mb-4 text-xs text-slate-500">
            Reads real-time fares/points by driving a browser. These options save immediately. Use
            headful + Installed Chrome for best results against Southwest&apos;s bot checks.
          </p>
          <Toggle
            label="Enable Southwest scraping (Playwright)"
            description="Drives a real browser to read live southwest.com prices. May trip anti-bot checks."
            checked={draft.scrapingEnabled}
            onChange={(v) => setPersist('scrapingEnabled', v)}
          />
          <div className="mt-3">
            <Toggle
              label="Show browser while scraping (headful)"
              description="Useful to solve CAPTCHA or debug login. Slower."
              checked={draft.scraperHeadful}
              onChange={(v) => setPersist('scraperHeadful', v)}
            />
          </div>
          <div className="mt-3">
            <label className="flex items-center justify-between gap-4">
              <span className="text-sm text-slate-200">
                Browser
                <span className="mt-0.5 block text-xs text-slate-500">
                  Use your installed Chrome/Edge (no download, fewer bot checks) or Playwright&apos;s
                  bundled Chromium.
                </span>
              </span>
              <select
                className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-200"
                value={draft.scraperBrowserChannel}
                onChange={(e) =>
                  setPersist(
                    'scraperBrowserChannel',
                    e.target.value as 'chrome' | 'msedge' | 'chromium',
                  )
                }
              >
                <option value="chrome">Installed Chrome</option>
                <option value="msedge">Installed Edge</option>
                <option value="chromium">Bundled Chromium</option>
              </select>
            </label>
          </div>
          <div className="mt-3">
            <Toggle
              label="Debug logging"
              description="Verbose logs and raw email/page dumps for tuning (credentials always redacted)."
              checked={draft.debugMode}
              onChange={(v) => setPersist('debugMode', v)}
            />
          </div>
          <div className="mt-4 rounded border border-slate-700 bg-slate-800/40 px-3 py-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-slate-200">Warm up scraper profile</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Run this once before automated checks. It opens Southwest in a dedicated browser
                  profile — do one manual flight search, then close the window. This stores the
                  trust cookies that let automated price checks through.
                </p>
              </div>
              <Button onClick={handleWarmProfile} disabled={warming || !draft.scrapingEnabled}>
                <RefreshCw size={16} className={warming ? 'animate-spin' : undefined} />
                {warming ? 'Warming…' : 'Warm up'}
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {showPassengerForm && (
        <PassengerFormModal
          onClose={() => setShowPassengerForm(false)}
          onSaved={refreshPassengers}
        />
      )}
    </div>
  );
}

function PassengerFormModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const [fullName, setFullName] = useState('');
  const [rr, setRr] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave(): Promise<void> {
    if (!fullName.trim()) return;
    setSaving(true);
    await api.passengers.create({
      fullName: fullName.trim(),
      rapidRewardsNumber: rr.trim() || undefined,
      accountIds: [],
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
          <input
            className={inputClass}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="As shown on booking"
          />
        </Field>
        <Field label="Rapid Rewards number" hint="Optional — helps match imported trips.">
          <input className={inputClass} value={rr} onChange={(e) => setRr(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}): JSX.Element {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-slate-200">{label}</p>
        {description && <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{description}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-brand-600' : 'bg-slate-700'}`}
      >
        <span
          className={`block h-5 w-5 translate-y-0.5 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-[22px]' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  );
}

/**
 * Number input for the award estimation rate that uses LOCAL STRING state so
 * the user can type decimals (e.g. "1.17") without the value being coerced to a
 * number on every keystroke (which drops the trailing "." and decimals). The
 * parsed value is committed on change (when valid) and normalized on blur.
 */
function AwardRateInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (v: number) => void;
}): JSX.Element {
  const [text, setText] = useState(String(value));

  // Reflect external changes (e.g. settings reload) when not mid-edit.
  useEffect(() => {
    setText(String(value));
  }, [value]);

  function commit(raw: string): void {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0.5 && n <= 3) onCommit(n);
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      className={inputClass}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        commit(e.target.value);
      }}
      onBlur={(e) => {
        const n = Number(e.target.value);
        const next = Number.isFinite(n) ? Math.min(Math.max(n, 0.5), 3) : value;
        setText(String(next));
        onCommit(next);
      }}
    />
  );
}

function SerpApiKeyEditor({
  slots,
  onSaved,
}: {
  slots: boolean[];
  onSaved: (next: AppSettings) => void;
}): JSX.Element {
  // Show the primary slot plus any already-configured backups plus the next
  // empty slot (so backups appear progressively, up to a max of 3).
  const configuredCount = slots.filter(Boolean).length;
  const visibleCount = Math.min(3, Math.max(1, configuredCount + 1));

  const labels = ['Primary key', 'Backup key 1', 'Backup key 2'];

  const [usage, setUsage] = useState<SerpApiKeyUsage[] | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(false);

  async function reloadUsage(): Promise<void> {
    setLoadingUsage(true);
    try {
      setUsage(await api.settings.serpApiUsage());
    } catch {
      setUsage([]);
    } finally {
      setLoadingUsage(false);
    }
  }

  // Refresh usage whenever the set of configured keys changes (and on mount).
  useEffect(() => {
    if (configuredCount > 0) void reloadUsage();
    else setUsage([]);
  }, [configuredCount]);

  return (
    <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <p className="text-xs leading-relaxed text-slate-400">
        Get a free key at{' '}
        <button
          type="button"
          className="text-brand-400 underline"
          onClick={() => void api.openExternal('https://serpapi.com/manage-api-key')}
        >
          serpapi.com
        </button>{' '}
        (250 searches/month free per account). Add up to 3 keys — the app
        automatically rotates to the next one when a key runs out of free monthly
        searches. Stored encrypted with Windows DPAPI; never leaves this computer
        except in requests to SerpApi.
      </p>
      {configuredCount > 0 && (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50"
          onClick={() => void reloadUsage()}
          disabled={loadingUsage}
        >
          <RefreshCw size={12} className={loadingUsage ? 'animate-spin' : ''} />
          {loadingUsage ? 'Checking usage…' : 'Refresh usage'}
        </button>
      )}
      {Array.from({ length: visibleCount }, (_, slot) => (
        <SerpApiKeySlot
          key={slot}
          slot={slot}
          label={labels[slot] ?? `Key ${slot + 1}`}
          configured={slots[slot] ?? false}
          usage={usage?.find((u) => u.slot === slot)}
          onSaved={onSaved}
        />
      ))}
    </div>
  );
}

function SerpApiUsageLine({ usage }: { usage?: SerpApiKeyUsage }): JSX.Element | null {
  if (!usage) return null;
  if (usage.error) {
    return <span className="text-xs text-amber-400">Usage unavailable: {usage.error}</span>;
  }
  const used = usage.thisMonthUsage;
  const total = usage.searchesPerMonth;
  if (used == null) return null;
  const left = usage.totalSearchesLeft;
  const pct = total && total > 0 ? Math.min(100, Math.round((used / total) * 100)) : null;
  const low = left != null && left <= 25;
  return (
    <div className="space-y-1">
      <span className={`text-xs ${low ? 'text-amber-400' : 'text-slate-400'}`}>
        {used.toLocaleString()}
        {total != null ? ` / ${total.toLocaleString()}` : ''} searches used this month
        {left != null ? ` · ${left.toLocaleString()} left` : ''}
      </span>
      {pct != null && (
        <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-slate-800">
          <div
            className={`h-full rounded-full ${low ? 'bg-amber-500' : 'bg-brand-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

function SerpApiKeySlot({
  slot,
  label,
  configured,
  usage,
  onSaved,
}: {
  slot: number;
  label: string;
  configured: boolean;
  usage?: SerpApiKeyUsage;
  onSaved: (next: AppSettings) => void;
}): JSX.Element {
  const { pushToast } = useAppStore();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSave(remove = false): Promise<void> {
    if (!remove && !key.trim()) {
      pushToast('error', 'Paste your SerpApi key first.');
      return;
    }
    setBusy(true);
    try {
      const next = await api.settings.setSerpApiKey(slot, remove ? '' : key);
      useAppStore.setState({ settings: next });
      onSaved(next);
      setKey('');
      pushToast('success', remove ? 'SerpApi key removed.' : 'SerpApi key saved.');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 border-t border-slate-800/70 pt-3 first:border-t-0 first:pt-0">
      <Field
        label={label}
        hint={configured ? 'A key is saved. Paste a new one to replace it.' : 'Encrypted at rest.'}
      >
        <input
          type="password"
          className={inputClass}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoComplete="off"
          placeholder={configured ? '•••••••• (saved)' : 'Paste key…'}
        />
      </Field>
      <div className="flex items-center gap-3">
        <Button onClick={() => void handleSave(false)} disabled={busy}>
          <Save size={15} /> {busy ? 'Saving…' : 'Save key'}
        </Button>
        {configured && (
          <Button variant="ghost" onClick={() => void handleSave(true)} disabled={busy}>
            Remove
          </Button>
        )}
        <span className={`text-xs ${configured ? 'text-emerald-400' : 'text-amber-400'}`}>
          {configured ? 'Key saved' : 'No key yet'}
        </span>
      </div>
      {configured && <SerpApiUsageLine usage={usage} />}
    </div>
  );
}

function GmailImportCard(): JSX.Element {
  const { pushToast } = useAppStore();
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState<null | 'save' | 'connect' | 'import'>(null);

  useEffect(() => {
    void api.email.status().then(setStatus);
  }, []);

  async function handleSaveCreds(): Promise<void> {
    if (!clientId.trim() || !clientSecret.trim()) {
      pushToast('error', 'Enter both Client ID and Client Secret.');
      return;
    }
    setBusy('save');
    try {
      setStatus(await api.email.setCredentials({ clientId, clientSecret }));
      setClientSecret('');
      pushToast('success', 'Google credentials saved.');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleConnect(): Promise<void> {
    setBusy('connect');
    try {
      if (status?.connected) {
        setStatus(await api.email.disconnect());
        pushToast('info', 'Gmail disconnected.');
      } else {
        pushToast('info', 'A browser window opened — approve access to continue.');
        setStatus(await api.email.connect());
        pushToast('success', 'Gmail connected.');
      }
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleImport(): Promise<void> {
    setBusy('import');
    try {
      const r: EmailImportResult = await api.email.import();
      await useAppStore.getState().refreshFlights();
      setStatus(await api.email.status());
      pushToast(
        'success',
        `Scanned ${r.scanned} email(s): ${r.imported} added, ${r.updated} updated, ${r.cancelled} cancelled, ${r.skipped} skipped.`,
      );
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-800">
          <Mail size={18} className="text-brand-400" />
        </div>
        <div className="text-sm">
          <p className="font-medium text-slate-100">Import trips from Gmail (recommended)</p>
          <p className="mt-0.5 leading-relaxed text-slate-500">
            Reads your Southwest confirmation emails (read-only) to import trips and the price you paid,
            and automatically drops trips you’ve cancelled. Nothing leaves this computer except the
            request to Google; your tokens are encrypted with Windows DPAPI.
          </p>
        </div>
      </div>

      {!status?.configured && (
        <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <p className="text-xs leading-relaxed text-slate-400">
            One-time setup: create a Google Cloud project, enable the <strong>Gmail API</strong>, and make
            an OAuth client of type <strong>Desktop app</strong>. Paste its Client ID and Client Secret
            below.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="OAuth Client ID">
              <input className={inputClass} value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" placeholder="…apps.googleusercontent.com" />
            </Field>
            <Field label="OAuth Client Secret" hint="Encrypted at rest.">
              <input type="password" className={inputClass} value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="new-password" />
            </Field>
          </div>
          <Button onClick={handleSaveCreds} disabled={busy === 'save'}>
            <Save size={15} /> {busy === 'save' ? 'Saving…' : 'Save credentials'}
          </Button>
        </div>
      )}

      {status?.configured && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant={status.connected ? 'ghost' : 'primary'} onClick={handleConnect} disabled={busy === 'connect'}>
            <Plug size={15} /> {status.connected ? 'Disconnect' : busy === 'connect' ? 'Connecting…' : 'Connect Gmail'}
          </Button>
          <Button variant="secondary" onClick={handleImport} disabled={!status.connected || busy === 'import'}>
            <RefreshCw size={15} className={busy === 'import' ? 'animate-spin' : ''} /> Import trips now
          </Button>
          <div className="text-xs text-slate-500">
            {status.connected ? (
              <span className="text-emerald-400">Connected{status.email ? ` · ${status.email}` : ''}</span>
            ) : (
              <span className="text-amber-400">Credentials saved — not connected yet</span>
            )}
            {status.lastImportAt && ` · last import ${formatDateTime(status.lastImportAt)}`}
          </div>
        </div>
      )}
    </div>
  );
}

