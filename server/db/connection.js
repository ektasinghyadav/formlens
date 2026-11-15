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
});

export default pool;
