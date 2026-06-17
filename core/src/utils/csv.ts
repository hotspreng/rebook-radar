import { Flight, PriceComparison, PurchaseType, Recommendation } from '../models/index.js';

/** Escape a single CSV cell per RFC 4180. */
function csvCell(value: unknown): string {
  if (value == null) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',');
}

export interface ExportRow {
  flight: Flight;
  passengerName: string;
  accountLabel?: string;
  comparison?: PriceComparison;
}

const HEADERS = [
  'Passenger',
  'Account',
  'Confirmation',
  'Origin',
  'Destination',
  'Departure',
  'Fare Type',
  'Original Purchase Type',
  'Original Amount',
  'Original Taxes/Fees (USD)',
  'Original Value (USD)',
  'Current Value (USD)',
  'Savings (USD)',
  'Percent Difference',
  'Recommendation',
  'Rationale',
] as const;

function originalAmountLabel(flight: Flight): string {
  const cost = flight.originalCost;
  if (cost.purchaseType === PurchaseType.Points) {
    return `${cost.points ?? 0} pts`;
  }
  return `$${(cost.cashUsd ?? 0).toFixed(2)}`;
}

/** Build a CSV string from tracked flights and their comparisons. */
export function exportFlightsToCsv(rows: ExportRow[]): string {
  const lines: string[] = [csvRow([...HEADERS])];

  for (const row of rows) {
    const { flight, comparison } = row;
    lines.push(
      csvRow([
        row.passengerName,
        row.accountLabel ?? '',
        flight.confirmationNumber,
        flight.route.origin.code,
        flight.route.destination.code,
        flight.departureDateTime,
        flight.fareType,
        flight.originalCost.purchaseType,
        originalAmountLabel(flight),
        flight.originalCost.taxesAndFeesUsd.toFixed(2),
        comparison ? comparison.originalValueUsd.toFixed(2) : '',
        comparison ? comparison.currentValueUsd.toFixed(2) : '',
        comparison ? comparison.savingsUsd.toFixed(2) : '',
        comparison ? `${comparison.percentDifference.toFixed(1)}%` : '',
        comparison?.recommendation ?? Recommendation.Unknown,
        comparison?.rationale ?? '',
      ]),
    );
  }

  return lines.join('\r\n');
}
