/**
 * One-off test-data importer.
 *
 * Reads the "Emmie Travel.xlsx" flight rows (already parsed below) and inserts a
 * passenger + flights directly into the app's sql.js database so the app can be
 * exercised without Gmail. Safe to re-run: it removes any prior rows for the
 * same passenger / confirmation numbers first.
 *
 * Run from the desktop workspace so sql.js resolves:
 *   node ../scripts/import-test-data.mjs
 */
import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

const DB_PATH = join(homedir(), 'AppData', 'Roaming', '@swr', 'desktop', 'southwest-rebooker.db');

const PASSENGER_NAME = 'Emily Jean Sprenger';

// Columns: confirmation, points, flightNumber, excelDate, origin, depFrac, dest, arrFrac
const ROWS = [
  ['AA2VAU', 15500, 'WN1308', 46303, 'ROC', 0.8125, 'MDW', 0.8472222222222222],
  ['AA4BCL', 15500, 'WN2246', 46304, 'MDW', 0.3229166666666667, 'ROC', 0.4340277777777778],
  ['AAQ5DQ', 22500, 'WN1308', 46304, 'ROC', 0.8125, 'MDW', 0.8472222222222222],
  ['AAU4GW', 11500, 'WN1142', 46305, 'MDW', 0.3368055555555556, 'ROC', 0.4513888888888889],
  ['AAY5FX', 11500, 'WN1308', 46305, 'ROC', 0.7152777777777778, 'MDW', 0.75],
  ['B5PEIW', 15500, 'WN2750', 46308, 'MDW', 0.5590277777777778, 'ROC', 0.6666666666666666],
  ['B5SECL', 15500, 'WN202', 46346, 'ROC', 0.7986111111111112, 'MDW', 0.8402777777777778],
  ['B5TDRD', 21500, 'WN1461', 46355, 'MDW', 0.3680555555555556, 'ROC', 0.4791666666666667],
  ['B5VL9I', 11000, 'WN1675', 46372, 'ROC', 0.7673611111111112, 'MDW', 0.8090277777777778],
  ['BC2CDV', 17500, 'WN2945', 46373, 'MDW', 0.5381944444444444, 'ROC', 0.6458333333333334],
  ['BC6IJH', 17500, 'WN202', 46373, 'ROC', 0.7986111111111112, 'MDW', 0.8402777777777778],
];

/** Excel serial date (+ optional day fraction) -> local ISO string (no tz). */
function excelToIso(serial, frac) {
  const baseMs = Date.UTC(1899, 11, 30) + serial * 86_400_000;
  const d = new Date(baseMs);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const totalMin = Math.round(frac * 24 * 60);
  const hh = String(Math.floor(totalMin / 60)).padStart(2, '0');
  const min = String(totalMin % 60).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:00`;
}

async function main() {
  if (!existsSync(DB_PATH)) {
    console.error(`Database not found at ${DB_PATH}. Launch the app once (npm run dev) to create it.`);
    process.exit(1);
  }

  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(DB_PATH));
  db.run('PRAGMA foreign_keys = ON;');

  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  // Clean up prior test rows so re-running is idempotent.
  const confList = ROWS.map((r) => `'${r[0]}'`).join(',');
  db.run(`DELETE FROM quotes WHERE flight_id IN (SELECT id FROM flights WHERE confirmation_number IN (${confList}))`);
  db.run(`DELETE FROM flights WHERE confirmation_number IN (${confList})`);

  // Reuse an existing passenger of this name, else create one.
  let passengerId;
  const sel = db.prepare('SELECT id FROM passengers WHERE full_name = :n');
  sel.bind({ ':n': PASSENGER_NAME });
  if (sel.step()) passengerId = sel.getAsObject().id;
  sel.free();

  if (!passengerId) {
    passengerId = `pax_${randomUUID()}`;
    db.run(
      `INSERT INTO passengers (id, full_name, rapid_rewards_number, account_ids, created_at, updated_at)
       VALUES (:id, :name, NULL, '[]', :now, :now)`,
      { ':id': passengerId, ':name': PASSENGER_NAME, ':now': now },
    );
  }

  let inserted = 0;
  for (const [conf, points, flightNo, serial, origin, depFrac, dest, arrFrac] of ROWS) {
    db.run(
      `INSERT INTO flights (
        id, passenger_id, account_id, confirmation_number,
        origin_code, origin_name, dest_code, dest_name,
        departure_dt, arrival_dt, fare_type, purchase_type,
        cash_usd, points, taxes_fees_usd, booking_date,
        source, notes, monitoring, created_at, updated_at
      ) VALUES (
        :id, :pid, NULL, :conf,
        :oc, NULL, :dc, NULL,
        :dep, :arr, 'wanna_get_away', 'points',
        NULL, :pts, 5.60, :booking,
        'manual', :notes, 1, :now, :now
      )`,
      {
        ':id': `flt_${randomUUID()}`,
        ':pid': passengerId,
        ':conf': conf,
        ':oc': origin,
        ':dc': dest,
        ':dep': excelToIso(serial, depFrac),
        ':arr': excelToIso(serial, arrFrac),
        ':pts': points,
        ':booking': today,
        ':notes': `Imported from Emmie Travel.xlsx · ${flightNo}`,
        ':now': now,
      },
    );
    inserted += 1;
  }

  writeFileSync(DB_PATH, Buffer.from(db.export()));
  db.close();
  console.log(`Imported ${inserted} flight(s) for ${PASSENGER_NAME} into ${DB_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
