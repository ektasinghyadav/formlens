// connection.js - one shared MySQL connection pool. Requirement: FR-4.1.
// A "pool" keeps a few connections open and lends them out, which is faster than
// opening a new connection for every request.
import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 10,
  timezone: 'Z', // JavaScript dates are read and written as UTC
});

// Make every new connection use UTC too, so "NOW()", stored times and date filters all agree
// no matter which time zone the computer is in (project rule: timestamps in UTC).
pool.pool.on('connection', (conn) => conn.query("SET time_zone = '+00:00'"));

export default pool;
