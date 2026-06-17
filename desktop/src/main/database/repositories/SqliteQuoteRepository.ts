import type { PriceComparison, PriceQuote, QuoteRepository } from '@swr/core';
import { execute, queryOne } from '../db.js';

interface QuoteRow {
  flight_id: string;
  quote_json: string | null;
  comparison_json: string | null;
  updated_at: string;
}

export class SqliteQuoteRepository implements QuoteRepository {
  async saveLatest(
    flightId: string,
    quote: PriceQuote | undefined,
    comparison: PriceComparison,
  ): Promise<void> {
    execute(
      `INSERT INTO quotes (flight_id, quote_json, comparison_json, updated_at)
       VALUES (:id, :q, :c, :updated_at)
       ON CONFLICT(flight_id) DO UPDATE SET
         quote_json = excluded.quote_json,
         comparison_json = excluded.comparison_json,
         updated_at = excluded.updated_at`,
      {
        ':id': flightId,
        ':q': quote ? JSON.stringify(quote) : null,
        ':c': JSON.stringify(comparison),
        ':updated_at': new Date().toISOString(),
      },
    );
  }

  async getLatest(
    flightId: string,
  ): Promise<{ quote?: PriceQuote; comparison?: PriceComparison } | undefined> {
    const row = queryOne<QuoteRow>('SELECT * FROM quotes WHERE flight_id = :id', { ':id': flightId });
    if (!row) return undefined;
    return {
      quote: row.quote_json ? (JSON.parse(row.quote_json) as PriceQuote) : undefined,
      comparison: row.comparison_json ? (JSON.parse(row.comparison_json) as PriceComparison) : undefined,
    };
  }
}
