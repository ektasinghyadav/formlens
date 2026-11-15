// routes/sessions.js - POST /sessions: start one respondent's visit. No login.
// Requirements: FR-4.1 (sessions stored), FR-3.3 (session_id on every event), NFR-3.2 (no raw IP).
import { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import pool from '../db/connection.js';

const router = Router();

// D-11: store SHA-256(IP + secret salt), never the IP itself. Same visitor -> same hash,
// but the hash cannot be turned back into an address without the salt.
function hashIp(ip) {
  return createHash('sha256').update(`${ip}${process.env.IP_HASH_SALT}`).digest('hex'); // 64 hex chars
}

router.post('/', async (req, res) => {
  const formId = typeof req.body?.form_id === 'string' ? req.body.form_id : '';
  const [rows] = await pool.query("SELECT form_id FROM forms WHERE form_id = ? AND status = 'published'", [formId]);
  if (!rows[0]) return res.status(404).json({ error: 'This form is not available' });

  const sessionId = randomUUID();
  await pool.query('INSERT INTO sessions (session_id, form_id, ip_hash) VALUES (?, ?, ?)', [
    sessionId, formId, hashIp(req.ip),
  ]);
  res.status(201).json({ session_id: sessionId });
});

export default router;
