import { busRideKey, type BusProvider, type BusRide, type BusRideRepository } from '@swr/core';
import { execute, queryAll, queryOne } from '../db.js';

interface BusRideRow {
  id: string;
  ride_key: string;
  provider: string;
  ticket_reference: string;
  departure_at: string;
  arrival_at: string;
  departure_city: string;
  departure_stop: string | null;
  arrival_city: string;
  arrival_stop: string | null;
  vehicle: string | null;
  operator: string | null;
  passenger_names_json: string;
  email_id: string | null;
  booked_at: string | null;
  created_at: string;
  updated_at: string;
}

function parseNames(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : [];
  } catch {
    return [];
  }
}

function toDomain(row: BusRideRow): BusRide {
  return {
    id: row.id,
    provider: row.provider as BusProvider,
    ticketReference: row.ticket_reference,
    departureAt: row.departure_at,
    arrivalAt: row.arrival_at,
    departureCity: row.departure_city,
    departureStop: row.departure_stop ?? undefined,
    arrivalCity: row.arrival_city,
    arrivalStop: row.arrival_stop ?? undefined,
    vehicle: row.vehicle ?? undefined,
    operator: row.operator ?? undefined,
    passengerNames: parseNames(row.passenger_names_json),
    emailId: row.email_id ?? undefined,
    bookedAt: row.booked_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function bindParams(ride: BusRide): Record<string, unknown> {
  return {
    ':id': ride.id,
    ':ride_key': busRideKey(ride),
    ':provider': ride.provider,
    ':ticket_reference': ride.ticketReference,
    ':departure_at': ride.departureAt,
    ':arrival_at': ride.arrivalAt,
    ':departure_city': ride.departureCity,
    ':departure_stop': ride.departureStop ?? null,
    ':arrival_city': ride.arrivalCity,
    ':arrival_stop': ride.arrivalStop ?? null,
    ':vehicle': ride.vehicle ?? null,
    ':operator': ride.operator ?? null,
    ':passenger_names_json': JSON.stringify(ride.passengerNames),
    ':email_id': ride.emailId ?? null,
    ':booked_at': ride.bookedAt ?? null,
    ':created_at': ride.createdAt,
    ':updated_at': ride.updatedAt,
  };
}

export class SqliteBusRideRepository implements BusRideRepository {
  async list(): Promise<BusRide[]> {
    return queryAll<BusRideRow>('SELECT * FROM bus_rides ORDER BY departure_at ASC, id ASC').map(toDomain);
  }

  async getByKey(key: string): Promise<BusRide | undefined> {
    const row = queryOne<BusRideRow>('SELECT * FROM bus_rides WHERE ride_key = :k', { ':k': key });
    return row ? toDomain(row) : undefined;
  }

  async create(ride: BusRide): Promise<void> {
    execute(
      `INSERT INTO bus_rides
         (id, ride_key, provider, ticket_reference, departure_at, arrival_at, departure_city, departure_stop,
          arrival_city, arrival_stop, vehicle, operator, passenger_names_json, email_id, booked_at,
          created_at, updated_at)
       VALUES (:id, :ride_key, :provider, :ticket_reference, :departure_at, :arrival_at, :departure_city, :departure_stop,
          :arrival_city, :arrival_stop, :vehicle, :operator, :passenger_names_json, :email_id, :booked_at,
          :created_at, :updated_at)`,
      bindParams(ride),
    );
  }

  async update(ride: BusRide): Promise<void> {
    execute(
      `UPDATE bus_rides SET
         ride_key = :ride_key, provider = :provider, ticket_reference = :ticket_reference,
         departure_at = :departure_at, arrival_at = :arrival_at, departure_city = :departure_city,
         departure_stop = :departure_stop, arrival_city = :arrival_city, arrival_stop = :arrival_stop,
         vehicle = :vehicle, operator = :operator, passenger_names_json = :passenger_names_json,
         email_id = :email_id, booked_at = :booked_at, updated_at = :updated_at
       WHERE id = :id`,
      bindParams(ride),
    );
  }

  async delete(id: string): Promise<void> {
    execute('DELETE FROM bus_rides WHERE id = :id', { ':id': id });
  }
}
