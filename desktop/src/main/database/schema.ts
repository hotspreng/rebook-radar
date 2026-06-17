export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS passengers (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  rapid_rewards_number TEXT,
  account_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  username TEXT NOT NULL,
  credential_key TEXT NOT NULL,
  has_stored_credential INTEGER NOT NULL DEFAULT 0,
  passenger_ids TEXT NOT NULL DEFAULT '[]',
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS flights (
  id TEXT PRIMARY KEY,
  passenger_id TEXT NOT NULL,
  account_id TEXT,
  confirmation_number TEXT NOT NULL,
  origin_code TEXT NOT NULL,
  origin_name TEXT,
  dest_code TEXT NOT NULL,
  dest_name TEXT,
  departure_dt TEXT NOT NULL,
  arrival_dt TEXT,
  fare_type TEXT NOT NULL,
  purchase_type TEXT NOT NULL,
  cash_usd REAL,
  points INTEGER,
  taxes_fees_usd REAL NOT NULL DEFAULT 0,
  booking_date TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  notes TEXT,
  monitoring INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Encrypted account passwords. Value is DPAPI/safeStorage ciphertext (base64).
-- NEVER stores plain text.
CREATE TABLE IF NOT EXISTS secrets (
  account TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Latest price quote + comparison per flight (JSON blobs).
CREATE TABLE IF NOT EXISTS quotes (
  flight_id TEXT PRIMARY KEY,
  quote_json TEXT,
  comparison_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_flights_passenger ON flights(passenger_id);
CREATE INDEX IF NOT EXISTS idx_flights_account ON flights(account_id);
`;
