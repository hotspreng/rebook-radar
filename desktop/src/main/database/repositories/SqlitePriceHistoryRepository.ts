import type { PriceHistoryEntry, PriceHistoryRepository, PurchaseType } from '@swr/core';
import { execute, queryAll, queryOne } from '../db.js';

interface HistoryRow {
  flight_id: string;
  recorded_at: string;
  purchase_type: string;
  amount: number | null;
  cash_usd: number | null;
  points: number | null;
  value_usd: number;
}

function toDomain(row: HistoryRow): PriceHistoryEntry {
  return {
    flightId: row.flight_id,
    recordedAt: row.recorded_at,
    purchaseType: row.purchase_type as PurchaseType,
    amount: row.amount ?? undefined,
    cashUsd: row.cash_usd ?? undefined,
    points: row.points ?? undefined,
    valueUsd: row.value_usd,
  };
}

export class SqlitePriceHistoryRepository implements PriceHistoryRepository {
  async append(entry: PriceHistoryEntry): Promise<void> {
    execute(
      `INSERT INTO price_history
         (flight_id, recorded_at, purchase_type, amount, cash_usd, points, value_usd)
       VALUES (:id, :recorded_at, :purchase_type, :amount, :cash_usd, :points, :value_usd)`,
      {
        ':id': entry.flightId,
        ':recorded_at': entry.recordedAt,
        ':purchase_type': entry.purchaseType,
        ':amount': entry.amount ?? null,
        ':cash_usd': entry.cashUsd ?? null,
        ':points': entry.points ?? null,
        ':value_usd': entry.valueUsd,
      },
    );
  }

  async list(flightId: string): Promise<PriceHistoryEntry[]> {
    const rows = queryAll<HistoryRow>(
      'SELECT * FROM price_history WHERE flight_id = :id ORDER BY recorded_at ASC, id ASC',
      { ':id': flightId },
    );
    return rows.map(toDomain);
  }

  async latest(flightId: string): Promise<PriceHistoryEntry | undefined> {
    const row = queryOne<HistoryRow>(
      'SELECT * FROM price_history WHERE flight_id = :id ORDER BY recorded_at DESC, id DESC LIMIT 1',
      { ':id': flightId },
    );
    return row ? toDomain(row) : undefined;
  }

  async deleteForFlight(flightId: string): Promise<void> {
    execute('DELETE FROM price_history WHERE flight_id = :id', { ':id': flightId });
  }
}
