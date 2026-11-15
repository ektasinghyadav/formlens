// Security review as tests. Requirements: FR-8.1, FR-8.2, NFR-3.1, NFR-3.2, NFR-3.3, NFR-5.2. (Sprint 8)
// 1) every endpoint in SPEC section 6 behaves as its "Auth" column says,
// 2) all SQL is parameterised (a scan of the source),  3) secrets are not in git.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import app from '../app.js';
import pool from '../db/connection.js';
import { envProblems } from '../config/checkEnv.js';
import { createAdmin, wipeAdmins } from './helpers/analyticsFixture.js';

const run = Date.now();
const password = 'correct horse battery';
const admins = [];
let tokenA, tokenB, formId;

async function newAdmin(tag) {
  const email = `test-security-${tag}-${run}@example.test`;
  await request(app).post('/api/v1/auth/register').send({ email, password });
  const token = (await request(app).post('/api/v1/auth/login').send({ email, password })).body.token;
  admins.push((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`)).body.adminId);
  return token;
}

beforeAll(async () => {
  tokenA = await newAdmin('a');
  tokenB = await newAdmin('b');
  formId = (await request(app).post('/api/v1/forms').set('Authorization', `Bearer ${tokenA}`).send({ title: 'Sec', fields: [{ field_type: 'text', label: 'x' }] })).body.form_id;
});
afterAll(async () => {
  await wipeAdmins(pool, admins);
  await pool.end();
});

// Every PROTECTED endpoint in SPEC section 6 (method, path).
const PROTECTED = (id) => [
  ['get', '/auth/me'],
  ['get', '/forms'], ['post', '/forms'],
  ['get', `/forms/${id}`], ['put', `/forms/${id}`], ['patch', `/forms/${id}/publish`], ['patch', `/forms/${id}/unpublish`],
  ['get', `/analytics/${id}/summary`], ['get', `/analytics/${id}/funnel`], ['get', `/analytics/${id}/fields`], ['get', `/analytics/${id}/recommendations`],
];
// Endpoints that take a :formId and must be limited to the owner.
const OWNED = (id) => PROTECTED(id).filter(([, path]) => path.includes(id));
const call = (method, path, token) => {
  const r = request(app)[method](`/api/v1${path}`).send(method === 'get' ? undefined : {});
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};

describe('protected endpoints (FR-8.1, NFR-3.1)', () => {
  it('every one answers 401 with no token', async () => {
    for (const [m, p] of PROTECTED(formId)) expect([m, p, (await call(m, p)).status]).toEqual([m, p, 401]);
  });

  it('every one answers 401 for a garbage, an expired, a wrong-secret, and an "alg: none" token', async () => {
    const tokens = [
      'garbage',
      jwt.sign({ adminId: randomUUID() }, process.env.JWT_SECRET, { expiresIn: -60 }),
      jwt.sign({ adminId: randomUUID() }, 'not-the-real-secret'),
      `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ adminId: randomUUID() })).toString('base64url')}.`,
    ];
    for (const t of tokens) for (const [m, p] of PROTECTED(formId)) expect([m, p, (await call(m, p, t)).status]).toEqual([m, p, 401]);
  });
});

describe("ownership: another admin cannot touch this admin's form (FR-8.2)", () => {
  it('every :formId endpoint answers 404 for admin B, and the form is unchanged afterwards', async () => {
    for (const [m, p] of OWNED(formId)) expect([m, p, (await call(m, p, tokenB)).status]).toEqual([m, p, 404]);
    const mine = await call('get', `/forms/${formId}`, tokenA);
    expect(mine.body.title).toBe('Sec');
    expect(mine.body.status).toBe('draft');
  });

  it('a valid token for an admin that no longer exists is refused', async () => {
    const ghost = jwt.sign({ adminId: randomUUID() }, process.env.JWT_SECRET);
    expect((await call('get', '/auth/me', ghost)).status).toBe(401);
    expect((await call('get', `/forms/${formId}`, ghost)).status).toBe(404);
  });
});

describe('public endpoints stay reachable without login (FR-2.1, FR-2.3, FR-3.x)', () => {
  it('are not blocked by the login check', async () => {
    expect((await call('get', '/health')).status).toBe(200);
    for (const [m, p] of [['get', '/forms/nope/public'], ['post', '/sessions'], ['post', '/events/batch'], ['post', `/forms/${randomUUID()}/submit`], ['post', `/forms/${randomUUID()}/upload`]]) {
      const status = (await call(m, p)).status;
      expect([m, p, status === 401]).toEqual([m, p, false]); // 400 / 404 are fine; 401 would mean "login required"
    }
  });
});

describe('responses and headers', () => {
  it('does not reveal the framework', async () => {
    expect((await call('get', '/health')).headers['x-powered-by']).toBeUndefined();
  });

  it('allows browser calls only from CLIENT_ORIGIN, never "*"', async () => {
    const res = await request(app).get('/api/v1/health').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBe(process.env.CLIENT_ORIGIN);
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('answers bad JSON with a short 400, with no stack trace or file paths', async () => {
    const res = await request(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"email": ');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/\bat\s.+\(|\.js:\d+|node_modules/);
  });

  it('never returns a password hash from any endpoint it exposes', async () => {
    const bodies = [await call('get', '/auth/me', tokenA), await call('get', '/forms', tokenA), await call('get', `/forms/${formId}`, tokenA)];
    for (const b of bodies) expect(JSON.stringify(b.body)).not.toMatch(/password|\$2[aby]\$/i);
  });
});

describe('SQL is parameterised everywhere (SRS: parameterised SQL only)', () => {
  // The ONLY things allowed inside ${...} in a SQL string are fixed fragments built by our own
  // code (the date-range and status expressions in the analytics engine), never request data.
  const ALLOWED = new Set(['range.sql', 'status.sql']);
  const dirs = ['routes', 'middleware', 'modules', 'scripts', 'config', 'db'];
  const files = dirs.flatMap((d) => readdirSync(resolve(import.meta.dirname, '..', d)).filter((f) => f.endsWith('.js')).map((f) => join(d, f)));

  it('finds the source files to scan', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('no SQL string contains an interpolation other than the two fixed fragments', () => {
    const offenders = [];
    for (const file of files) {
      const src = readFileSync(resolve(import.meta.dirname, '..', file), 'utf8');
      for (const m of src.matchAll(/\.query\(\s*`([\s\S]*?)`/g)) {
        for (const x of m[1].matchAll(/\$\{([^}]*)\}/g)) if (!ALLOWED.has(x[1].trim())) offenders.push(`${file}: \${${x[1]}}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no SQL is built with string + concatenation from request data', () => {
    for (const file of files) {
      const src = readFileSync(resolve(import.meta.dirname, '..', file), 'utf8');
      expect(src, file).not.toMatch(/\.query\(\s*(['"])(?:\\.|(?!\1).)*\1\s*\+/); // 'SELECT ... ' + something
    }
  });
});

describe('secrets and settings (NFR-3.3, NFR-5.2)', () => {
  const git = (cmd) => { try { return execSync(`git ${cmd}`, { cwd: resolve(import.meta.dirname, '../..'), encoding: 'utf8' }); } catch { return null; } };

  it('.env and uploaded files are ignored by git and not tracked', () => {
    const tracked = git('ls-files');
    if (tracked === null) return; // not inside a git checkout (e.g. a downloaded zip)
    expect(tracked.split('\n')).not.toContain('.env');
    expect(tracked).not.toMatch(/server\/uploads\//);
    expect(readFileSync(resolve(import.meta.dirname, '../../.gitignore'), 'utf8')).toMatch(/^\.env$/m);
  });

  it('no tracked file contains the real database password or JWT secret', () => {
    const tracked = git('ls-files');
    if (tracked === null) return;
    for (const secret of [process.env.DB_PASSWORD, process.env.JWT_SECRET, process.env.IP_HASH_SALT]) {
      const hits = git(`grep -l -F -- "${secret}"`);
      expect(hits ?? '').toBe(''); // git grep exits non-zero (null) when nothing matches
    }
  });

  it('the server refuses to start with missing, placeholder or short secrets', () => {
    const good = { DB_HOST: 'h', DB_USER: 'u', DB_PASSWORD: 'p', DB_NAME: 'd', JWT_SECRET: 'x'.repeat(40), IP_HASH_SALT: 's', CLIENT_ORIGIN: 'http://localhost' };
    expect(envProblems(good)).toEqual([]);
    expect(envProblems({ ...good, JWT_SECRET: undefined })[0]).toMatch(/JWT_SECRET is not set/);
    expect(envProblems({ ...good, JWT_SECRET: 'short' })[0]).toMatch(/too short/);
    expect(envProblems({ ...good, JWT_SECRET: 'change_me_to_a_long_random_string_aaaaaaaaaa' })[0]).toMatch(/placeholder/);
    expect(envProblems({})).toHaveLength(7);
  });

  it('the current .env passes the check', () => {
    expect(envProblems()).toEqual([]);
  });
});
