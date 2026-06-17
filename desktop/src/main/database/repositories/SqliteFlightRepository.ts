import type { Flight, FlightRepository } from '@swr/core';
import { FareType, FlightSource, PurchaseType } from '@swr/core';
import { execute, queryAll, queryOne } from '../db.js';

interface FlightRow {
  id: string;
  passenger_id: string;
  account_id: string | null;
  confirmation_number: string;
  origin_code: string;
  origin_name: string | null;
  dest_code: string;
  dest_name: string | null;
  departure_dt: string;
  arrival_dt: string | null;
  fare_type: string;
  purchase_type: string;
  cash_usd: number | null;
  points: number | null;
  taxes_fees_usd: number;
  booking_date: string;
  source: string;
  notes: string | null;
  monitoring: number;
  created_at: string;
  updated_at: string;
}

function toDomain(row: FlightRow): Flight {
  return {
    id: row.id,
    passengerId: row.passenger_id,
    accountId: row.account_id ?? undefined,
    confirmationNumber: row.confirmation_number,
    route: {
      origin: { code: row.origin_code, name: row.origin_name ?? undefined },
      destination: { code: row.dest_code, name: row.dest_name ?? undefined },
    },
    departureDateTime: row.departure_dt,
    arrivalDateTime: row.arrival_dt ?? undefined,
    fareType: row.fare_type as FareType,
    originalCost: {
      purchaseType: row.purchase_type as PurchaseType,
      cashUsd: row.cash_usd ?? undefined,
      points: row.points ?? undefined,
      taxesAndFeesUsd: row.taxes_fees_usd,
    },
    bookingDate: row.booking_date,
    source: row.source as FlightSource,
    notes: row.notes ?? undefined,
    monitoring: row.monitoring === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function bindParams(f: Flight): Record<string, unknown> {
  return {
    ':id': f.id,
    ':passenger_id': f.passengerId,
    ':account_id': f.accountId ?? null,
    ':confirmation_number': f.confirmationNumber,
    ':origin_code': f.route.origin.code,
    ':origin_name': f.route.origin.name ?? null,
    ':dest_code': f.route.destination.code,
    ':dest_name': f.route.destination.name ?? null,
    ':departure_dt': f.departureDateTime,
    ':arrival_dt': f.arrivalDateTime ?? null,
    ':fare_type': f.fareType,
    ':purchase_type': f.originalCost.purchaseType,
    ':cash_usd': f.originalCost.cashUsd ?? null,
    ':points': f.originalCost.points ?? null,
    ':taxes_fees_usd': f.originalCost.taxesAndFeesUsd,
    ':booking_date': f.bookingDate,
    ':source': f.source,
    ':notes': f.notes ?? null,
    ':monitoring': f.monitoring ? 1 : 0,
    ':created_at': f.createdAt,
    ':updated_at': f.updatedAt,
  };
}

export class SqliteFlightRepository implements FlightRepository {
  async list(): Promise<Flight[]> {
    return queryAll<FlightRow>('SELECT * FROM flights ORDER BY departure_dt').map(toDomain);
  }

  async listByPassenger(passengerId: string): Promise<Flight[]> {
    return queryAll<FlightRow>('SELECT * FROM flights WHERE passenger_id = :p ORDER BY departure_dt', {
      ':p': passengerId,
    }).map(toDomain);
  }

  async listByAccount(accountId: string): Promise<Flight[]> {
    return queryAll<FlightRow>('SELECT * FROM flights WHERE account_id = :a ORDER BY departure_dt', {
      ':a': accountId,
    }).map(toDomain);
  }

  async listMonitored(): Promise<Flight[]> {
    return queryAll<FlightRow>(
      'SELECT * FROM flights WHERE monitoring = 1 ORDER BY departure_dt',
    ).map(toDomain);
  }

  async get(id: string): Promise<Flight | undefined> {
    const row = queryOne<FlightRow>('SELECT * FROM flights WHERE id = :id', { ':id': id });
    return row ? toDomain(row) : undefined;
  }

  async create(f: Flight): Promise<Flight> {
    execute(
      `INSERT INTO flights (
        id, passenger_id, account_id, confirmation_number,
        origin_code, origin_name, dest_code, dest_name,
        departure_dt, arrival_dt, fare_type, purchase_type,
        cash_usd, points, taxes_fees_usd, booking_date,
        source, notes, monitoring, created_at, updated_at
      ) VALUES (
        :id, :passenger_id, :account_id, :confirmation_number,
        :origin_code, :origin_name, :dest_code, :dest_name,
        :departure_dt, :arrival_dt, :fare_type, :purchase_type,
        :cash_usd, :points, :taxes_fees_usd, :booking_date,
        :source, :notes, :monitoring, :created_at, :updated_at
      )`,
      bindParams(f),
    );
    return f;
  }

  async update(f: Flight): Promise<Flight> {
    execute(
      `UPDATE flights SET
        passenger_id = :passenger_id, account_id = :account_id, confirmation_number = :confirmation_number,
        origin_code = :origin_code, origin_name = :origin_name, dest_code = :dest_code, dest_name = :dest_name,
        departure_dt = :departure_dt, arrival_dt = :arrival_dt, fare_type = :fare_type, purchase_type = :purchase_type,
        cash_usd = :cash_usd, points = :points, taxes_fees_usd = :taxes_fees_usd, booking_date = :booking_date,
        source = :source, notes = :notes, monitoring = :monitoring, updated_at = :updated_at
       WHERE id = :id`,
      bindParams(f),
    );
    return f;
  }

  async delete(id: string): Promise<void> {
    execute('DELETE FROM flights WHERE id = :id', { ':id': id });
    execute('DELETE FROM quotes WHERE flight_id = :id', { ':id': id });
  }
}
