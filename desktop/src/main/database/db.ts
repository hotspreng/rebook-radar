import initSqlJs, { type Database } from 'sql.js';
import { app } from 'electron';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { MIGRATIONS, SCHEMA_SQL } from './schema.js';

let db: Database | null = null;
let dbPath = '';

export async function initDatabase(): Promise<Database> {
  const SQL = await initSqlJs();
  dbPath = getDbPath();

  if (existsSync(dbPath)) {
    db = new SQL.Database(readFileSync(dbPath));
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON;');
  db.run(SCHEMA_SQL);
  runMigrations(db);
  saveDatabase();
  return db;
}

/** Add columns missing from databases created before they were introduced. */
function runMigrations(database: Database): void {
  const existing = (table: string): Set<string> => {
    const cols = new Set<string>();
    const stmt = database.prepare(`PRAGMA table_info(${table})`);
    try {
      while (stmt.step()) cols.add((stmt.getAsObject() as { name: string }).name);
    } finally {
      stmt.free();
    }
    return cols;
  };
  for (const m of MIGRATIONS) {
    if (!existing(m.table).has(m.column)) database.run(m.ddl);
  }
  normalizeLegacyUtcTimestamps(database);
}

/**
 * Convert a UTC ISO instant (e.g. "2026-12-14T02:25:00.000Z") to a naive
 * local wall-clock string ("2026-12-13T20:25:00"). Used to repair manual
 * flights saved by an older build that converted the entered local time to
 * UTC, which shifted evening departures to the next calendar day.
 */
function utcToLocalNaive(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

/**
 * One-time, idempotent repair of manual flights whose departure/arrival were
 * stored as a UTC instant (suffix "Z") instead of a local wall-clock string.
 * Imported trips and fare quotes are always naive-local, so any "Z" timestamp
 * is a legacy manual entry. When the fix shifts the calendar date, the stored
 * quote and price history were fetched for the wrong day, so they are cleared
 * and repopulated on the next price check. Re-running finds no "Z" rows.
 */
function normalizeLegacyUtcTimestamps(database: Database): void {
  const rows: { id: string; departure_dt: string; arrival_dt: string | null }[] = [];
  const stmt = database.prepare(
    "SELECT id, departure_dt, arrival_dt FROM flights WHERE departure_dt LIKE '%Z' OR arrival_dt LIKE '%Z'",
  );
  try {
    while (stmt.step()) {
      rows.push(
        stmt.getAsObject() as { id: string; departure_dt: string; arrival_dt: string | null },
      );
    }
  } finally {
    stmt.free();
  }

  for (const r of rows) {
    const newDep = r.departure_dt.endsWith('Z') ? utcToLocalNaive(r.departure_dt) : r.departure_dt;
    const newArr =
      r.arrival_dt && r.arrival_dt.endsWith('Z') ? utcToLocalNaive(r.arrival_dt) : r.arrival_dt ?? null;
    database.run('UPDATE flights SET departure_dt = :dep, arrival_dt = :arr WHERE id = :id', {
      ':dep': newDep,
      ':arr': newArr,
      ':id': r.id,
    } as never);

    if (newDep.slice(0, 10) !== r.departure_dt.slice(0, 10)) {
      database.run('DELETE FROM quotes WHERE flight_id = :id', { ':id': r.id } as never);
      database.run('DELETE FROM price_history WHERE flight_id = :id', { ':id': r.id } as never);
    }
  }
}

function getDbPath(): string {
  const userDataPath = app.getPath('userData');
  mkdirSync(userDataPath, { recursive: true });
  return join(userDataPath, 'southwest-rebooker.db');
}

export function saveDatabase(): void {
  if (!db) return;
  writeFileSync(dbPath, Buffer.from(db.export()));
}

export function getDb(): Database {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

export function closeDatabase(): void {
  if (db) {
    saveDatabase();
    db.close();
    db = null;
  }
}

/** Run a query and return rows as plain objects. */
export function queryAll<T = Record<string, unknown>>(
  sql: string,
  params: Record<string, unknown> = {},
): T[] {
  const database = getDb();
  const stmt = database.prepare(sql);
  try {
    stmt.bind(params as never);
    const rows: T[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as T);
    return rows;
  } finally {
    stmt.free();
  }
}

/** Run a query and return the first row, if any. */
export function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: Record<string, unknown> = {},
): T | undefined {
  return queryAll<T>(sql, params)[0];
}

/** Execute a write statement and persist the DB to disk. */
export function execute(sql: string, params: Record<string, unknown> = {}): void {
  const database = getDb();
  database.run(sql, params as never);
  saveDatabase();
}
