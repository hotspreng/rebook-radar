import type { ImportAllResult } from '@shared/dto';
import { useAppStore } from '../store/useAppStore.js';

/** One line saying what a full import changed, e.g. "Flights: 2 added · Hotels: 1 updated". */
export function summarizeImportAll(r: ImportAllResult): string {
  const parts: string[] = [];
  const counts = (added: number, updated: number, cancelled: number): string =>
    [added && `${added} added`, updated && `${updated} updated`, cancelled && `${cancelled} cancelled`]
      .filter(Boolean)
      .join(', ');

  const flights = counts(r.flights.imported, r.flights.updated, r.flights.cancelled);
  if (flights) parts.push(`Flights: ${flights}`);
  for (const [label, result] of [
    ['Hotels', r.hotels],
    ['Rental cars', r.rentals],
    ['Bus rides', r.buses],
  ] as const) {
    const text = result && counts(result.added, result.updated, result.cancelled);
    if (text) parts.push(`${label}: ${text}`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'Everything is up to date';
}

/**
 * Import flights, hotels, rental cars and bus rides from Gmail in one go,
 * refresh the flight list, and report the outcome as toasts. Resolves to the
 * result, or undefined when the import failed outright.
 */
export async function runFullImport(): Promise<ImportAllResult | undefined> {
  const { pushToast, refreshFlights } = useAppStore.getState();
  try {
    const r = await window.swr.email.importAll();
    await refreshFlights();
    pushToast('success', summarizeImportAll(r));
    for (const error of r.errors) pushToast('error', `Import problem — ${error}`);
    return r;
  } catch (err) {
    pushToast('error', err instanceof Error ? err.message : String(err));
    return undefined;
  }
}
