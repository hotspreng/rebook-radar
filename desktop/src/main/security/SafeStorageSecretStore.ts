import { safeStorage } from 'electron';
import type { SecretStore } from '@swr/core';
import { logger } from '@swr/core';
import { execute, queryOne } from '../database/db.js';

interface SecretRow {
  account: string;
  ciphertext: string;
  updated_at: string;
}

const log = logger.child('secret-store');

/**
 * SecretStore backed by Electron `safeStorage`, which uses OS-level encryption:
 *   - Windows: DPAPI (per-user)
 *   - macOS:   Keychain
 *   - Linux:   libsecret / kwallet
 *
 * Only the resulting ciphertext (base64) is persisted in the local SQLite DB.
 * Plain-text passwords are never written to disk or logs.
 */
export class SafeStorageSecretStore implements SecretStore {
  constructor() {
    if (!safeStorage.isEncryptionAvailable()) {
      log.warn(
        'OS secure storage is not available; credentials cannot be encrypted on this machine.',
      );
    }
  }

  private ensureAvailable(): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        'OS-level secure storage (DPAPI/Keychain) is unavailable. Refusing to store credentials.',
      );
    }
  }

  async setPassword(account: string, password: string): Promise<void> {
    this.ensureAvailable();
    const ciphertext = safeStorage.encryptString(password).toString('base64');
    execute(
      `INSERT INTO secrets (account, ciphertext, updated_at)
       VALUES (:a, :c, :u)
       ON CONFLICT(account) DO UPDATE SET ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`,
      { ':a': account, ':c': ciphertext, ':u': new Date().toISOString() },
    );
    log.info('Stored encrypted credential', { account });
  }

  async getPassword(account: string): Promise<string | undefined> {
    const row = queryOne<SecretRow>('SELECT * FROM secrets WHERE account = :a', { ':a': account });
    if (!row) return undefined;
    this.ensureAvailable();
    try {
      return safeStorage.decryptString(Buffer.from(row.ciphertext, 'base64'));
    } catch (err) {
      log.error('Failed to decrypt stored credential', { account, error: String(err) });
      return undefined;
    }
  }

  async deletePassword(account: string): Promise<void> {
    execute('DELETE FROM secrets WHERE account = :a', { ':a': account });
    log.info('Deleted stored credential', { account });
  }
}
