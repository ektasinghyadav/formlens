// Removes the throwaway admin (and its form, sessions, events) made by the load test.
import { wipeAdmins } from './analyticsFixture.js';

export async function wipeAdminsByEmail(pool, email) {
  const [rows] = await pool.query('SELECT admin_id FROM admins WHERE email = ?', [email]);
  await wipeAdmins(pool, rows.map((r) => r.admin_id));
}
