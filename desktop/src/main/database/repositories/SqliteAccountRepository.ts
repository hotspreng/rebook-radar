import type { Account, AccountRepository } from '@swr/core';
import { execute, queryAll, queryOne } from '../db.js';

interface AccountRow {
  id: string;
  label: string;
  username: string;
  credential_key: string;
  has_stored_credential: number;
  passenger_ids: string;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

function toDomain(row: AccountRow): Account {
  return {
    id: row.id,
    label: row.label,
    username: row.username,
    credentialKey: row.credential_key,
    hasStoredCredential: row.has_stored_credential === 1,
    passengerIds: JSON.parse(row.passenger_ids || '[]'),
    lastSyncedAt: row.last_synced_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteAccountRepository implements AccountRepository {
  async list(): Promise<Account[]> {
    return queryAll<AccountRow>('SELECT * FROM accounts ORDER BY label').map(toDomain);
  }

  async get(id: string): Promise<Account | undefined> {
    const row = queryOne<AccountRow>('SELECT * FROM accounts WHERE id = :id', { ':id': id });
    return row ? toDomain(row) : undefined;
  }

  async create(a: Account): Promise<Account> {
    execute(
      `INSERT INTO accounts
        (id, label, username, credential_key, has_stored_credential, passenger_ids, last_synced_at, created_at, updated_at)
       VALUES (:id, :label, :username, :ck, :has, :pids, :synced, :created_at, :updated_at)`,
      {
        ':id': a.id,
        ':label': a.label,
        ':username': a.username,
        ':ck': a.credentialKey,
        ':has': a.hasStoredCredential ? 1 : 0,
        ':pids': JSON.stringify(a.passengerIds),
        ':synced': a.lastSyncedAt ?? null,
        ':created_at': a.createdAt,
        ':updated_at': a.updatedAt,
      },
    );
    return a;
  }

  async update(a: Account): Promise<Account> {
    execute(
      `UPDATE accounts SET label = :label, username = :username, credential_key = :ck,
        has_stored_credential = :has, passenger_ids = :pids, last_synced_at = :synced,
        updated_at = :updated_at WHERE id = :id`,
      {
        ':id': a.id,
        ':label': a.label,
        ':username': a.username,
        ':ck': a.credentialKey,
        ':has': a.hasStoredCredential ? 1 : 0,
        ':pids': JSON.stringify(a.passengerIds),
        ':synced': a.lastSyncedAt ?? null,
        ':updated_at': a.updatedAt,
      },
    );
    return a;
  }

  async delete(id: string): Promise<void> {
    execute('DELETE FROM accounts WHERE id = :id', { ':id': id });
  }
}
