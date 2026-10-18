import { rentalCarKey, type RentalCar, type RentalCarRepository, type RentalProvider } from '@swr/core';
import { execute, queryAll, queryOne } from '../db.js';

interface RentalCarRow {
  id: string;
  rental_key: string;
  provider: string;
  confirmation_number: string;
  pickup_location: string;
  pickup_address: string | null;
  pickup_phone: string | null;
  pickup_at: string;
  return_location: string;
  return_at: string;
  vehicle_class: string | null;
  vehicle_model: string | null;
  driver_name: string | null;
  email_id: string | null;
  booked_at: string | null;
  created_at: string;
  updated_at: string;
}

function toDomain(row: RentalCarRow): RentalCar {
  return {
    id: row.id,
    provider: row.provider as RentalProvider,
    confirmationNumber: row.confirmation_number,
    pickupLocation: row.pickup_location,
    pickupAddress: row.pickup_address ?? undefined,
    pickupPhone: row.pickup_phone ?? undefined,
    pickupAt: row.pickup_at,
    returnLocation: row.return_location,
    returnAt: row.return_at,
    vehicleClass: row.vehicle_class ?? undefined,
    vehicleModel: row.vehicle_model ?? undefined,
    driverName: row.driver_name ?? undefined,
    emailId: row.email_id ?? undefined,
    bookedAt: row.booked_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function bindParams(car: RentalCar): Record<string, unknown> {
  return {
    ':id': car.id,
    ':rental_key': rentalCarKey(car),
    ':provider': car.provider,
    ':confirmation_number': car.confirmationNumber,
    ':pickup_location': car.pickupLocation,
    ':pickup_address': car.pickupAddress ?? null,
    ':pickup_phone': car.pickupPhone ?? null,
    ':pickup_at': car.pickupAt,
    ':return_location': car.returnLocation,
    ':return_at': car.returnAt,
    ':vehicle_class': car.vehicleClass ?? null,
    ':vehicle_model': car.vehicleModel ?? null,
    ':driver_name': car.driverName ?? null,
    ':email_id': car.emailId ?? null,
    ':booked_at': car.bookedAt ?? null,
    ':created_at': car.createdAt,
    ':updated_at': car.updatedAt,
  };
}

export class SqliteRentalCarRepository implements RentalCarRepository {
  async list(): Promise<RentalCar[]> {
    return queryAll<RentalCarRow>('SELECT * FROM rental_cars ORDER BY pickup_at ASC, id ASC').map(toDomain);
  }

  async getByKey(key: string): Promise<RentalCar | undefined> {
    const row = queryOne<RentalCarRow>('SELECT * FROM rental_cars WHERE rental_key = :k', { ':k': key });
    return row ? toDomain(row) : undefined;
  }

  async create(car: RentalCar): Promise<void> {
    execute(
      `INSERT INTO rental_cars
         (id, rental_key, provider, confirmation_number, pickup_location, pickup_address, pickup_phone,
          pickup_at, return_location, return_at, vehicle_class, vehicle_model, driver_name,
          email_id, booked_at, created_at, updated_at)
       VALUES (:id, :rental_key, :provider, :confirmation_number, :pickup_location, :pickup_address, :pickup_phone,
          :pickup_at, :return_location, :return_at, :vehicle_class, :vehicle_model, :driver_name,
          :email_id, :booked_at, :created_at, :updated_at)`,
      bindParams(car),
    );
  }

  async update(car: RentalCar): Promise<void> {
    execute(
      `UPDATE rental_cars SET
         rental_key = :rental_key, provider = :provider, confirmation_number = :confirmation_number,
         pickup_location = :pickup_location, pickup_address = :pickup_address, pickup_phone = :pickup_phone,
         pickup_at = :pickup_at, return_location = :return_location, return_at = :return_at,
         vehicle_class = :vehicle_class, vehicle_model = :vehicle_model, driver_name = :driver_name,
         email_id = :email_id, booked_at = :booked_at, updated_at = :updated_at
       WHERE id = :id`,
      bindParams(car),
    );
  }

  async delete(id: string): Promise<void> {
    execute('DELETE FROM rental_cars WHERE id = :id', { ':id': id });
  }
}
