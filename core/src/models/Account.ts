/**
 * A Southwest account.
 *
 * IMPORTANT: This model NEVER contains a password. Secrets live exclusively in
 * the OS secure store (Windows Credential Manager via the desktop layer) and
 * are referenced indirectly by `credentialKey`.
 */
export interface Account {
  id: string;
  /** Friendly label shown in the UI (e.g. "Dad's account"). */
  label: string;
  /** Southwest username / Rapid Rewards number used to log in. */
  username: string;
  /**
   * Opaque key used to look up the password in the OS secure store.
   * The password itself is NEVER stored on this object or in the database.
   */
  credentialKey: string;
  /** Whether a password is currently saved in the secure store. */
  hasStoredCredential: boolean;
  /** Passenger ids that map to this account. */
  passengerIds: string[];
  /** Last successful automated trip sync, if any. */
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type NewAccount = Omit<
  Account,
  'id' | 'credentialKey' | 'hasStoredCredential' | 'createdAt' | 'updatedAt'
>;

/**
 * Credentials are only ever passed transiently (e.g. to perform a login) and
 * are never persisted in plain text.
 */
export interface AccountCredentials {
  username: string;
  password: string;
}
