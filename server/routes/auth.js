// routes/auth.js - register, login, and "who am I". Requirements: FR-8.1, NFR-3.1, NFR-3.3.
import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import pool from '../db/connection.js';
import requireAuth from '../middleware/auth.js';

const router = Router();

const ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 12; // cost 12 per SRS
const MIN_PASSWORD = 8; // D-14
const MAX_PASSWORD = 72; // bcrypt only reads the first 72 bytes
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A fake hash used when the email is unknown, so "no such user" takes as long as
// "wrong password". Otherwise response time would reveal which emails are registered.
const DUMMY_HASH = await bcrypt.hash('not-a-real-password', ROUNDS);

function readCredentials(body) {
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  return { email, password };
}

// POST /auth/register - create an admin account.
router.post('/register', async (req, res) => {
  const { email, password } = readCredentials(req.body);
  if (!EMAIL_PATTERN.test(email) || email.length > 255) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }
  if (password.length < MIN_PASSWORD || Buffer.byteLength(password) > MAX_PASSWORD) {
    return res.status(400).json({ error: `Password must be ${MIN_PASSWORD}-${MAX_PASSWORD} characters` });
  }

  const adminId = randomUUID();
  const passwordHash = await bcrypt.hash(password, ROUNDS); // only the hash is ever stored
  try {
    // "?" placeholders = parameterised SQL, so input can't be run as SQL
    await pool.query('INSERT INTO admins (admin_id, email, password_hash) VALUES (?, ?, ?)', [
      adminId,
      email,
      passwordHash,
    ]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    throw err;
  }
  res.status(201).json({ adminId, email });
});

// POST /auth/login - exchange email + password for a JWT.
router.post('/login', async (req, res) => {
  const { email, password } = readCredentials(req.body);
  const [rows] = await pool.query('SELECT admin_id, password_hash FROM admins WHERE email = ?', [email]);
  const admin = rows[0];

  const ok = await bcrypt.compare(password, admin ? admin.password_hash : DUMMY_HASH);
  if (!admin || !ok) {
    return res.status(401).json({ error: 'Invalid credentials' }); // same message for both cases
  }

  const token = jwt.sign({ adminId: admin.admin_id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  });
  res.json({ token });
});

// GET /auth/me - protected; proves the token works and the admin still exists.
router.get('/me', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT admin_id, email FROM admins WHERE admin_id = ?', [req.adminId]);
  if (!rows[0]) return res.status(401).json({ error: 'Authentication required' });
  res.json({ adminId: rows[0].admin_id, email: rows[0].email });
});

export default router;
