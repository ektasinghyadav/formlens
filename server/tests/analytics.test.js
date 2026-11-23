// Analytics API tests. Requirements: FR-5.1-5.3, FR-6.2, FR-8.1, FR-8.2, NFR-3.1. (Sprint 5)
// Uses the same hand-calculated fixture as the engine tests (relative to the real clock here).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import app from '../app.js';
import pool from '../db/connection.js';
import { buildFixture, createForm, addSession, wipeAdmins } from './helpers/analyticsFixture.js';

const run = Date.now();
const password = 'correct horse battery';
const api = (url, token) => {
  const r = request(app).get(`/api/v1${url}`);
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};
const adminIds = [];
let tokenA, tokenB, fx;

async function newAdmin(tag) {
  const email = `test-analytics-${tag}-${run}@example.test`;
  await request(app).post('/api/v1/auth/register').send({ email, password });
  const token = (await request(app).post('/api/v1/auth/login').send({ email, password })).body.token;
  const me = await api('/auth/me', token);
  adminIds.push(me.body.adminId);
  return { token, adminId: me.body.adminId };
}
const monthAgo = () => new Date(Date.now() - 30 * 86400e3).toISOString();
const url = (kind, query = '') => `/analytics/${fx.formId}/${kind}${query}`;

beforeAll(async () => {
  const a = await newAdmin('a');
  tokenA = a.token;
  tokenB = (await newAdmin('b')).token;
  fx = await buildFixture(pool, a.adminId, new Date());
});
afterAll(async () => {
  await wipeAdmins(pool, adminIds);
  await pool.end();
});

describe('who may ask (FR-8.1, FR-8.2, NFR-3.1)', () => {
  it.each(['summary', 'funnel', 'fields'])('%s: 401 without a token', async (kind) => {
    expect((await api(url(kind))).status).toBe(401);
  });

  it.each(['summary', 'funnel', 'fields'])("%s: another admin gets 404 for this admin's form", async (kind) => {
    expect((await api(url(kind), tokenB)).status).toBe(404);
  });

  it('an unknown form id gives the same 404', async () => {
    expect((await api(`/analytics/${randomUUID()}/summary`, tokenA)).status).toBe(404);
  });
});

describe('response shapes (SPEC section 6)', () => {
  it('summary has exactly views, completions, abandonments, completion_rate', async () => {
    const res = await api(url('summary', `?from=${monthAgo()}`), tokenA);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['abandonments', 'completion_rate', 'completions', 'views']);
    expect(res.body).toEqual({ views: 7, completions: 2, abandonments: 4, completion_rate: 0.2857 });
  });

  it('funnel rows have exactly field_id, label, reached, dropped, drop_rate', async () => {
    const res = await api(url('funnel', `?from=${monthAgo()}`), tokenA);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    for (const row of res.body) expect(Object.keys(row).sort()).toEqual(['drop_rate', 'dropped', 'field_id', 'label', 'reached']);
    expect(res.body.map((r) => [r.reached, r.dropped])).toEqual([[6, 0], [5, 2], [3, 1]]);
  });

  it('field rows have exactly field_id, label, avg_time_ms, error_rate, correction_rate, abandonment_rate', async () => {
    const res = await api(url('fields', `?from=${monthAgo()}`), tokenA);
    expect(res.status).toBe(200);
    for (const row of res.body) {
      expect(Object.keys(row).sort()).toEqual(['abandonment_rate', 'avg_time_ms', 'correction_rate', 'error_rate', 'field_id', 'label']);
    }
    expect(res.body.map((r) => r.avg_time_ms)).toEqual([2200, 4000, 4500]);
  });
});

describe('date range (FR-6.2)', () => {
  it('without a range, counts every session (the 40-day-old one too)', async () => {
    expect((await api(url('summary'), tokenA)).body.views).toBe(8);
  });

  it('narrows every endpoint to the sessions that started inside the range', async () => {
    const q = `?from=${fx.at(70).toISOString()}&to=${fx.at(15).toISOString()}`; // S3 (60 min ago), S4 (30), S7 (20)
    expect((await api(url('summary', q), tokenA)).body).toEqual({ views: 3, completions: 1, abandonments: 2, completion_rate: 0.3333 });
    expect((await api(url('funnel', q), tokenA)).body.map((r) => r.reached)).toEqual([2, 2, 2]);
    expect((await api(url('fields', q), tokenA)).body.map((r) => r.avg_time_ms)).toEqual([1500, 4000, 3000]); // F2: only S7 has a finished visit (S3 never left it)
  });

  it('a range with no sessions gives zeros', async () => {
    const res = await api(url('summary', '?from=2000-01-01&to=2000-12-31'), tokenA);
    expect(res.body).toEqual({ views: 0, completions: 0, abandonments: 0, completion_rate: 0 });
  });

  it('a date-only "to" includes that whole day (until 23:59:59.999 UTC)', async () => {
    const adminId = adminIds[0];
    const f = await createForm(pool, adminId, 'Late session', ['A']);
    await addSession(pool, { ...f, started: new Date('2026-11-10T23:30:00Z'), status: 'submitted', events: [[0, 'form_opened', null]] });
    const views = async (q) => (await api(`/analytics/${f.formId}/summary${q}`, tokenA)).body.views;
    expect(await views('?from=2026-11-10&to=2026-11-10')).toBe(1); // that day: included
    expect(await views('?to=2026-11-09')).toBe(0);                  // the day before: excluded
    expect(await views('?from=2026-11-11')).toBe(0);                // the day after: excluded
  });

  it.each([
    ['not a date', '?from=yesterday'],
    ['an impossible date', '?to=2026-02-31'],
    ['an impossible date-time', '?from=2026-04-31T10:00:00Z'],
    ['from after to', '?from=2026-11-10&to=2026-11-01'],
    ['a repeated parameter', '?from=2026-11-01&from=2026-11-02'],
    ['a date without a time zone', '?from=2026-11-10T10:00:00'],
  ])('rejects %s with 400', async (name, q) => {
    for (const kind of ['summary', 'funnel', 'fields']) expect((await api(url(kind, q), tokenA)).status).toBe(400);
  });
});

// kept last: it changes the shared fixture (D-25)
describe('archived fields (D-25)', () => {
  it('drop out of the field widgets but never change the form totals', async () => {
    const summaryBefore = (await api(url('summary', `?from=${monthAgo()}`), tokenA)).body;
    const fieldsBefore = (await api(url('fields', `?from=${monthAgo()}`), tokenA)).body;
    await pool.query('UPDATE fields SET archived_at = NOW() WHERE field_id = ?', [fx.fieldIds[0]]);

    const summary = (await api(url('summary', `?from=${monthAgo()}`), tokenA)).body;
    expect(summary).toEqual(summaryBefore);
    for (const kind of ['funnel', 'fields']) {
      const body = (await api(url(kind, `?from=${monthAgo()}`), tokenA)).body;
      expect(body.map((f) => f.field_id)).not.toContain(fx.fieldIds[0]);
      expect(body).toHaveLength(fieldsBefore.length - 1);
    }
  });
});
