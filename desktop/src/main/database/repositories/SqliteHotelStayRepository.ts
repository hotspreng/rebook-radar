import { hotelStayKey, type HotelProvider, type HotelStay, type HotelStayRepository } from '@swr/core';
import { execute, queryAll, queryOne } from '../db.js';

interface HotelStayRow {
  id: string;
  stay_key: string;
  provider: string;
  hotel_name: string;
  address: string | null;
  phone: string | null;
  check_in: string;
  check_out: string;
  nights: number | null;
  guest_names_json: string;
  guests: number | null;
  rooms: number | null;
  room_type: string | null;
  confirmation_number: string | null;
  booking_reference: string | null;
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

function toDomain(row: HotelStayRow): HotelStay {
  return {
    id: row.id,
    provider: row.provider as HotelProvider,
    hotelName: row.hotel_name,
    address: row.address ?? undefined,
    phone: row.phone ?? undefined,
    checkIn: row.check_in,
    checkOut: row.check_out,
    nights: row.nights ?? undefined,
    guestNames: parseNames(row.guest_names_json),
    guests: row.guests ?? undefined,
    rooms: row.rooms ?? undefined,
    roomType: row.room_type ?? undefined,
    confirmationNumber: row.confirmation_number ?? undefined,
    bookingReference: row.booking_reference ?? undefined,
    emailId: row.email_id ?? undefined,
    bookedAt: row.booked_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function bindParams(stay: HotelStay): Record<string, unknown> {
  return {
    ':id': stay.id,
    ':stay_key': hotelStayKey(stay),
    ':provider': stay.provider,
    ':hotel_name': stay.hotelName,
    ':address': stay.address ?? null,
    ':phone': stay.phone ?? null,
    ':check_in': stay.checkIn,
    ':check_out': stay.checkOut,
    ':nights': stay.nights ?? null,
    ':guest_names_json': JSON.stringify(stay.guestNames),
    ':guests': stay.guests ?? null,
    ':rooms': stay.rooms ?? null,
    ':room_type': stay.roomType ?? null,
    ':confirmation_number': stay.confirmationNumber ?? null,
    ':booking_reference': stay.bookingReference ?? null,
    ':email_id': stay.emailId ?? null,
    ':booked_at': stay.bookedAt ?? null,
    ':created_at': stay.createdAt,
    ':updated_at': stay.updatedAt,
  };
}

export class SqliteHotelStayRepository implements HotelStayRepository {
  async list(): Promise<HotelStay[]> {
    return queryAll<HotelStayRow>('SELECT * FROM hotel_stays ORDER BY check_in ASC, id ASC').map(toDomain);
  }

  async getByKey(key: string): Promise<HotelStay | undefined> {
    const row = queryOne<HotelStayRow>('SELECT * FROM hotel_stays WHERE stay_key = :k', { ':k': key });
    return row ? toDomain(row) : undefined;
  }

  async create(stay: HotelStay): Promise<void> {
    execute(
      `INSERT INTO hotel_stays
         (id, stay_key, provider, hotel_name, address, phone, check_in, check_out, nights,
          guest_names_json, guests, rooms, room_type, confirmation_number, booking_reference,
          email_id, booked_at, created_at, updated_at)
       VALUES (:id, :stay_key, :provider, :hotel_name, :address, :phone, :check_in, :check_out, :nights,
          :guest_names_json, :guests, :rooms, :room_type, :confirmation_number, :booking_reference,
          :email_id, :booked_at, :created_at, :updated_at)`,
      bindParams(stay),
    );
  }

  async update(stay: HotelStay): Promise<void> {
    execute(
      `UPDATE hotel_stays SET
         stay_key = :stay_key, provider = :provider, hotel_name = :hotel_name, address = :address,
         phone = :phone, check_in = :check_in, check_out = :check_out, nights = :nights,
         guest_names_json = :guest_names_json, guests = :guests, rooms = :rooms, room_type = :room_type,
         confirmation_number = :confirmation_number, booking_reference = :booking_reference,
         email_id = :email_id, booked_at = :booked_at, updated_at = :updated_at
       WHERE id = :id`,
      bindParams(stay),
    );
  }

  async delete(id: string): Promise<void> {
    execute('DELETE FROM hotel_stays WHERE id = :id', { ':id': id });
  }
}
