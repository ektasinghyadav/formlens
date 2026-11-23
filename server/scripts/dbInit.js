// dbInit.js - `npm run db:init` applies db/schema.sql to the database in .env. (FR-4.1)
import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';

const schemaPath = new URL('../db/schema.sql', import.meta.url);
const sql = await readFile(schemaPath, 'utf8');

// multipleStatements lets one call run the whole file. It is only enabled for this
// one-off script, never for the app's pool, because it makes SQL injection worse.
const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  multipleStatements: true,
});

try {
  await conn.query(sql);
  // D-25: databases made before the archive feature lack fields.archived_at (CREATE TABLE IF NOT EXISTS
  // does not change an existing table), so add it once.
  const [[{ n }]] = await conn.query(
    "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'fields' AND column_name = 'archived_at'"
  );
  if (n === 0) await conn.query('ALTER TABLE fields ADD COLUMN archived_at TIMESTAMP NULL');
  const [tables] = await conn.query('SHOW TABLES');
  console.log(`Schema applied. ${tables.length} tables in ${process.env.DB_NAME}.`);
} finally {
  await conn.end();
}
