import type { PurchaseType, RebookEvent, RebookEventRepository } from '@swr/core';
import { execute, queryAll } from '../db.js';

interface RebookRow {
  id: string;
  flight_id: string;
  passenger_id: string;
  confirmation_number: string;
  route_label: string;
  departure_date: string;
  purchase_type: string;
  original_amount: number;
  new_amount: number;
  points_saved: number | null;
  cash_saved_usd: number | null;
  estimated_value_usd: number;
  point_value_cents: number;
  recorded_at: string;
}

function toDomain(row: RebookRow): RebookEvent {
  return {
    id: row.id,
    flightId: row.flight_id,
    passengerId: row.passenger_id,
    confirmationNumber: row.confirmation_number,
    routeLabel: row.route_label,
    departureDate: row.departure_date,
    purchaseType: row.purchase_type as PurchaseType,
    originalAmount: row.original_amount,
    newAmount: row.new_amount,
    pointsSaved: row.points_saved ?? undefined,
    cashSavedUsd: row.cash_saved_usd ?? undefined,
    estimatedValueUsd: row.estimated_value_usd,
    pointValueCents: row.point_value_cents,
    recordedAt: row.recorded_at,
  };
}

export class SqliteRebookEventRepository implements RebookEventRepository {
  async append(event: RebookEvent): Promise<void> {
    execute(
      `INSERT INTO rebook_events
         (id, flight_id, passenger_id, confirmation_number, route_label, departure_date,
          purchase_type, original_amount, new_amount, points_saved, cash_saved_usd,
          estimated_value_usd, point_value_cents, recorded_at)
       VALUES (:id, :flight_id, :passenger_id, :confirmation_number, :route_label, :departure_date,
          :purchase_type, :original_amount, :new_amount, :points_saved, :cash_saved_usd,
          :estimated_value_usd, :point_value_cents, :recorded_at)`,
      {
        ':id': event.id,
        ':flight_id': event.flightId,
        ':passenger_id': event.passengerId,
        ':confirmation_number': event.confirmationNumber,
        ':route_label': event.routeLabel,
        ':departure_date': event.departureDate,
        ':purchase_type': event.purchaseType,
        ':original_amount': event.originalAmount,
        ':new_amount': event.newAmount,
        ':points_saved': event.pointsSaved ?? null,
        ':cash_saved_usd': event.cashSavedUsd ?? null,
        ':estimated_value_usd': event.estimatedValueUsd,
        ':point_value_cents': event.pointValueCents,
        ':recorded_at': event.recordedAt,
      },
    );
  }

  async list(): Promise<RebookEvent[]> {
    const rows = queryAll<RebookRow>(
      'SELECT * FROM rebook_events ORDER BY recorded_at DESC, id DESC',
    );
    return rows.map(toDomain);
  }

  async listByFlight(flightId: string): Promise<RebookEvent[]> {
    const rows = queryAll<RebookRow>(
      'SELECT * FROM rebook_events WHERE flight_id = :id ORDER BY recorded_at DESC, id DESC',
      { ':id': flightId },
    );
    return rows.map(toDomain);
  }

  async deleteForFlight(flightId: string): Promise<void> {
    execute('DELETE FROM rebook_events WHERE flight_id = :id', { ':id': flightId });
  }
}
