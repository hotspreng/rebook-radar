/**
 * One-off: clear ALL flights (and their quotes) from the app's sql.js database,
 * leaving passengers and accounts intact. Used to verify that the Gmail import
 * re-creates the trips from scratch.
 *
 * The app MUST be closed when this runs (it overwrites the DB on save).
 *
 * Run from the desktop workspace so sql.js resolves:
 *   node ../scripts/clear-flights.mjs
 */
import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DB_PATH = join(homedir(), 'AppData', 'Roaming', '@swr', 'desktop', 'southwest-rebooker.db');

async function main() {
  if (!existsSync(DB_PATH)) {
    console.error(`Database not found at ${DB_PATH}.`);
    process.exit(1);
  }

  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(DB_PATH));
  db.run('PRAGMA foreign_keys = ON;');

  const before = db.exec('SELECT COUNT(*) AS n FROM flights')[0]?.values[0][0] ?? 0;

  db.run('DELETE FROM quotes');
  db.run('DELETE FROM flights');

  const after = db.exec('SELECT COUNT(*) AS n FROM flights')[0]?.values[0][0] ?? 0;
  const passengers = db.exec('SELECT COUNT(*) AS n FROM passengers')[0]?.values[0][0] ?? 0;

  writeFileSync(DB_PATH, Buffer.from(db.export()));
  db.close();

  console.log(`Cleared flights: ${before} -> ${after}. Passengers kept: ${passengers}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
