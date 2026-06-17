import type { Passenger, PassengerRepository } from '@swr/core';
import { execute, queryAll, queryOne } from '../db.js';

interface PassengerRow {
  id: string;
  full_name: string;
  rapid_rewards_number: string | null;
  account_ids: string;
  created_at: string;
  updated_at: string;
}

function toDomain(row: PassengerRow): Passenger {
  return {
    id: row.id,
    fullName: row.full_name,
    rapidRewardsNumber: row.rapid_rewards_number ?? undefined,
    accountIds: JSON.parse(row.account_ids || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqlitePassengerRepository implements PassengerRepository {
  async list(): Promise<Passenger[]> {
    return queryAll<PassengerRow>('SELECT * FROM passengers ORDER BY full_name').map(toDomain);
  }

  async get(id: string): Promise<Passenger | undefined> {
    const row = queryOne<PassengerRow>('SELECT * FROM passengers WHERE id = :id', { ':id': id });
    return row ? toDomain(row) : undefined;
  }

  async create(p: Passenger): Promise<Passenger> {
    execute(
      `INSERT INTO passengers (id, full_name, rapid_rewards_number, account_ids, created_at, updated_at)
       VALUES (:id, :full_name, :rr, :account_ids, :created_at, :updated_at)`,
      {
        ':id': p.id,
        ':full_name': p.fullName,
        ':rr': p.rapidRewardsNumber ?? null,
        ':account_ids': JSON.stringify(p.accountIds),
        ':created_at': p.createdAt,
        ':updated_at': p.updatedAt,
      },
    );
    return p;
  }

  async update(p: Passenger): Promise<Passenger> {
    execute(
      `UPDATE passengers SET full_name = :full_name, rapid_rewards_number = :rr,
       account_ids = :account_ids, updated_at = :updated_at WHERE id = :id`,
      {
        ':id': p.id,
        ':full_name': p.fullName,
        ':rr': p.rapidRewardsNumber ?? null,
        ':account_ids': JSON.stringify(p.accountIds),
        ':updated_at': p.updatedAt,
      },
    );
    return p;
  }

  async delete(id: string): Promise<void> {
    execute('DELETE FROM passengers WHERE id = :id', { ':id': id });
  }
}
