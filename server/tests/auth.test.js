// Auth tests. Requirements: FR-8.1, NFR-3.1, NFR-3.3. (Sprint 1)
// Uses the real dfua database with throwaway emails (test-auth-...) that are deleted after.
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../app.js';
import pool from '../db/connection.js';

const run = Date.now();
const email = `test-auth-${run}@example.test`;
const password = 'correct horse battery';

afterAll(async () => {
  await pool.query("DELETE FROM admins WHERE email LIKE 'test-auth-%@example.test'");
  await pool.end();
});

describe('POST /auth/register', () => {
  it('creates an admin and never returns the password or hash', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ email, password });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe(email);
    expect(JSON.stringify(res.body)).not.toContain(password);
    expect(JSON.stringify(res.body)).not.toMatch(/hash|\$2/i);
  });

  it('stores a 60-char bcrypt hash, not the plain password', async () => {
    const [rows] = await pool.query('SELECT password_hash FROM admins WHERE email = ?', [email]);
    const hash = rows[0].password_hash;
    expect(hash).toHaveLength(60);
    expect(hash).toMatch(/^\$2[aby]\$12\$/); // bcrypt, cost 12
    expect(hash).not.toContain(password);
  });

  it('rejects a duplicate email, even in different letter case', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ email: email.toUpperCase(), password });
    expect(res.status).toBe(409);
  });

  it('rejects an invalid email', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ email: 'not-an-email', password });
    expect(res.status).toBe(400);
  });

  it('rejects a password shorter than 8 characters', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: `test-auth-short-${run}@example.test`, password: 'short' });
    expect(res.status).toBe(400);
  });

  it('rejects a missing body', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /auth/login', () => {
  it('returns a JWT carrying only the adminId, expiring in 8 hours', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    const payload = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(typeof payload.adminId).toBe('string');
    expect(payload.exp - payload.iat).toBe(8 * 60 * 60);
    expect(JSON.stringify(res.body)).not.toContain(password);
  });

  it('gives the same generic error for a wrong password and an unknown email', async () => {
    const wrong = await request(app).post('/api/v1/auth/login').send({ email, password: 'wrong password!' });
    const unknown = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `test-auth-nobody-${run}@example.test`, password });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('is not fooled by SQL in the email field', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: "' OR '1'='1", password });
    expect(res.status).toBe(401);
  });
});

describe('GET /auth/me (protected)', () => {
  async function validToken() {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password });
    return res.body.token;
  }

  it('returns the admin when the token is valid', async () => {
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${await validToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(email);
  });

  it('returns 401 with no token', async () => {
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
  });

  it('returns 401 for a garbage token', async () => {
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer not.a.token');
    expect(res.status).toBe(401);
  });

  it('returns 401 for an expired token', async () => {
    const expired = jwt.sign({ adminId: 'x' }, process.env.JWT_SECRET, { expiresIn: -10 });
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  it('returns 401 for a token signed with the wrong secret', async () => {
    const forged = jwt.sign({ adminId: 'x' }, 'some-other-secret');
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });
});
