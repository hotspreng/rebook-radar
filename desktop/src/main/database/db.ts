import initSqlJs, { type Database } from 'sql.js';
import { app } from 'electron';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { SCHEMA_SQL } from './schema.js';

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
  saveDatabase();
  return db;
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
