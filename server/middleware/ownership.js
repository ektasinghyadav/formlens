// middleware/ownership.js - "is this YOUR form?" check. Requirement: FR-8.2.
// Runs on every route with :formId, after requireAuth. It looks up the form by BOTH the id
// in the URL and the logged-in admin's id, in one query. No row -> 404 (D-16): a form that
// is someone else's looks exactly like a form that does not exist, so ids can't be probed.
import pool from '../db/connection.js';

export default async function requireOwnership(req, res, next) {
  const [rows] = await pool.query('SELECT * FROM forms WHERE form_id = ? AND admin_id = ?', [
    req.params.formId,
    req.adminId,
  ]);
  if (!rows[0]) return res.status(404).json({ error: 'Form not found' });
  req.form = rows[0]; // later steps reuse it instead of querying again
  next();
}
