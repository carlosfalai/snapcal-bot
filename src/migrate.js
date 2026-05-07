const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

(async () => {
  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    console.log('Running', f);
    await pool.query(sql);
  }
  console.log('Migrations done.');
  await pool.end();
})().catch((e) => { console.error('migrate failed:', e); process.exit(1); });
