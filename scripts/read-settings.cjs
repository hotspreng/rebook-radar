const initSqlJs = require('sql.js');
const fs = require('fs');
const os = require('os');
const path = require('path');
const p = path.join(os.homedir(), 'AppData', 'Roaming', '@swr', 'desktop', 'southwest-rebooker.db');
initSqlJs().then((SQL) => {
  const db = new SQL.Database(fs.readFileSync(p));
  const r = db.exec("SELECT value FROM settings WHERE key='app'");
  if (!r.length) return console.log('NO SETTINGS ROW');
  console.log(JSON.stringify(JSON.parse(r[0].values[0][0]), null, 2));
});
