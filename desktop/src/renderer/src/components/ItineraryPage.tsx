import { useMemo, useState } from 'react';
import { AIRLINE_LABELS, buildItinerary, buildItineraryHtml, operatingAirline } from '@swr/core';
import type { FlightWithComparison } from '@shared/dto';
import { ArrowRight, Check, Copy, FileText, Search, Wand2, X } from 'lucide-react';
import { Button, Card, inputClass } from './ui.js';
import { formatDateTime } from '../lib/format.js';
import { useAppStore } from '../store/useAppStore.js';

/** One selectable row: every traveler tracked on the same physical flight. */
interface JourneyRow {
  key: string;
  items: FlightWithComparison[];
}

/**
 * Travelers booked together are tracked as one flight each. Group those that
 * share a confirmation, route and departure so a family is one row to tick.
 */
function groupRows(flights: FlightWithComparison[]): JourneyRow[] {
  const rows = new Map<string, JourneyRow>();
  for (const item of flights) {
    const f = item.flight;
    const key = [
      f.confirmationNumber,
      f.route.origin.code,
      f.route.destination.code,
      f.departureDateTime.slice(0, 16),
    ].join('|');
    const row = rows.get(key) ?? { key, items: [] };
    row.items.push(item);
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) =>
    a.items[0]!.flight.departureDateTime.localeCompare(b.items[0]!.flight.departureDateTime),
  );
}

export function ItineraryPage(): JSX.Element {
  const flights = useAppStore((s) => s.flights);
  const pushToast = useAppStore((s) => s.pushToast);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [includeConfirmation, setIncludeConfirmation] = useState(true);
  // 'formatted' copies rich text (headings, colors, tables) that keeps its look
  // when pasted into an email; 'text' is plain and editable.
  const [format, setFormat] = useState<'formatted' | 'text'>('formatted');
  const [text, setText] = useState('');
  const [html, setHtml] = useState('');
  const [generated, setGenerated] = useState(false);
  const [copied, setCopied] = useState(false);

  const rows = useMemo(() => {
    const now = Date.now();
    const upcoming = flights.filter((f) => {
      const departs = Date.parse(f.flight.departureDateTime);
      return !Number.isFinite(departs) || departs >= now;
    });
    return groupRows(upcoming);
  }, [flights]);

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const f = row.items[0]!.flight;
      const haystack = [
        f.confirmationNumber,
        f.route.origin.code,
        f.route.destination.code,
        AIRLINE_LABELS[operatingAirline(f)],
        ...row.items.map((i) => i.passengerName),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, query]);

  function toggle(key: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectedInputs(): { flight: FlightWithComparison['flight']; passengerName: string }[] {
    return rows
      .filter((row) => selected.has(row.key))
      .flatMap((row) => row.items.map((i) => ({ flight: i.flight, passengerName: i.passengerName })));
  }

  /** Build both versions from the same selection so they can never disagree. */
  function build(withConfirmation: boolean): void {
    const inputs = selectedInputs();
    setText(buildItinerary(inputs, { includeConfirmation: withConfirmation }));
    setHtml(buildItineraryHtml(inputs, { includeConfirmation: withConfirmation }));
  }

  function handleCreate(): void {
    build(includeConfirmation);
    setGenerated(true);
    setCopied(false);
  }

  function handleToggleConfirmation(value: boolean): void {
    setIncludeConfirmation(value);
    // Rebuild only if one has been made; this replaces any manual edits.
    if (generated) build(value);
  }

  function handleClear(): void {
    setSelected(new Set());
    setText('');
    setHtml('');
    setGenerated(false);
    setCopied(false);
  }

  async function handleCopy(): Promise<void> {
    try {
      if (format === 'formatted' && typeof ClipboardItem !== 'undefined') {
        // Offer both flavors: mail composers take the rich one, and anything
        // that only understands text (a plain-text email, a chat box) gets the
        // plain version of the same itinerary.
        const plain = buildItinerary(selectedInputs(), { includeConfirmation });
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([plain], { type: 'text/plain' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      setCopied(true);
      pushToast('success', format === 'formatted' ? 'Formatted itinerary copied' : 'Itinerary copied to clipboard');
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      pushToast('error', 'Could not copy the itinerary');
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 px-7 py-5">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Itinerary</h1>
          <p className="text-sm text-slate-400">
            Select flights, then create a shareable itinerary to paste into an email.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <Button variant="ghost" onClick={handleClear}>
              <X size={16} /> Clear
            </Button>
          )}
          <Button onClick={handleCreate} disabled={selected.size === 0}>
            <Wand2 size={16} /> Create itinerary
            {selected.size > 0 && (
              <span className="rounded-full bg-white/20 px-1.5 text-[11px]">{selected.size}</span>
            )}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-6 px-7 py-6">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              className={`${inputClass} pl-9`}
              placeholder="Filter by traveler, route, airline or confirmation"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <Card className="min-h-0 flex-1 overflow-y-auto">
            {visibleRows.length === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-slate-500">
                {rows.length === 0 ? 'No upcoming flights to include.' : 'No flights match your filter.'}
              </p>
            ) : (
              <ul>
                {visibleRows.map((row) => {
                  const f = row.items[0]!.flight;
                  const isSelected = selected.has(row.key);
                  const operating = operatingAirline(f);
                  return (
                    <li key={row.key} className="border-b border-slate-800 last:border-0">
                      <label
                        className={`flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-slate-800/40 ${
                          isSelected ? 'bg-brand-600/10' : ''
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={isSelected}
                          onChange={() => toggle(row.key)}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
                            {f.route.origin.code}
                            <ArrowRight size={13} className="text-slate-500" />
                            {f.route.destination.code}
                            <span className="text-[11px] font-normal text-slate-500">
                              {AIRLINE_LABELS[operating] ?? operating}
                            </span>
                            {f.confirmationNumber && (
                              <span className="font-mono text-[11px] font-normal tracking-wide text-slate-500">
                                {f.confirmationNumber}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400">{formatDateTime(f.departureDateTime)}</p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {row.items.map((i) => i.passengerName).join(', ')}
                          </p>
                        </div>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex w-[520px] shrink-0 flex-col gap-3">
          {generated ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <div
                  role="group"
                  aria-label="Itinerary format"
                  className="inline-flex rounded-lg border border-slate-700 p-0.5 text-sm"
                >
                  {(['formatted', 'text'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => {
                        setFormat(f);
                        setCopied(false);
                      }}
                      aria-pressed={format === f}
                      className={`rounded-md px-3 py-1 font-medium transition-colors ${
                        format === f ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {f === 'formatted' ? 'Formatted' : 'Plain text'}
                    </button>
                  ))}
                </div>
                <Button onClick={() => void handleCopy()}>
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                  {copied ? 'Copied' : format === 'formatted' ? 'Copy formatted' : 'Copy'}
                </Button>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={includeConfirmation}
                  onChange={(e) => handleToggleConfirmation(e.target.checked)}
                />
                Include confirmation numbers
              </label>
              {format === 'formatted' ? (
                // Rendered on white because that is how it will look in an email.
                // The markup is generated by buildItineraryHtml, which escapes
                // every piece of stored text.
                <div
                  className="min-h-0 flex-1 overflow-auto rounded-lg bg-white p-4"
                  aria-label="Formatted itinerary preview"
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              ) : (
                <textarea
                  className={`${inputClass} min-h-0 flex-1 resize-none font-mono text-[13px] leading-relaxed`}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  spellCheck={false}
                  aria-label="Itinerary text"
                />
              )}
              <p className="text-[11px] text-slate-500">
                {format === 'formatted'
                  ? 'Paste into your email to keep the headings and layout. Switch to Plain text to edit the wording. Prices are never included.'
                  : 'You can edit the text before copying. Prices are never included.'}
              </p>
            </>
          ) : (
            <Card className="flex flex-1 flex-col items-center justify-center px-8 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-800/60">
                <FileText size={26} className="text-slate-500" />
              </div>
              <p className="text-sm font-medium text-slate-300">Your itinerary appears here</p>
              <p className="mt-1 text-sm text-slate-500">
                Tick the flights to include — two flights become an Outbound and a Return journey — then
                choose Create itinerary.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
