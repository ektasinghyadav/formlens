// Recommendation engine + endpoint with a real database. Requirements: FR-7.1, FR-7.2, FR-8.2. (Sprint 6)
// Same hand-calculated fixture as the analytics tests (see analyticsEngine.test.js for the table).
// For the fixture, over "the last 30 days" (S1..S7), by hand:
//   F0: reached 6, nothing wrong.
//   F1: reached 5; abandonment 50% (High, line is 30%), errors 50% (High, line 40%), corrections 25% (Medium, 20-35%).
//   F2: reached only 3 (< 5): not judged, one Low "not enough data" note.
//   Rule 2 for F2: F1 dropped 40% but F1 itself has 50% errors, so the drop is blamed on F1, not F2: no flag.
//   => 4 recommendations: high abandonment F1, high error F1, medium correction F1, low note F2.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import app from '../app.js';
import pool from '../db/connection.js';
import { buildRecommendations, saveRecommendations } from '../modules/recommendEngine.js';
import { buildFixture, wipeAdmins } from './helpers/analyticsFixture.js';

const run = Date.now();
const password = 'correct horse battery';
const api = (url, token) => {
  const r = request(app).get(`/api/v1${url}`);
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};
const adminIds = [];
let tokenA, tokenB, fx;

async function newAdmin(tag) {
  const email = `test-recs-${tag}-${run}@example.test`;
  await request(app).post('/api/v1/auth/register').send({ email, password });
  const token = (await request(app).post('/api/v1/auth/login').send({ email, password })).body.token;
  const me = await api('/auth/me', token);
  adminIds.push(me.body.adminId);
  return { token, adminId: me.body.adminId };
}
const monthAgo = () => new Date(Date.now() - 30 * 86400e3).toISOString();
const url = (query = '') => `/analytics/${fx.formId}/recommendations${query}`;
const stored = async () => (await pool.query('SELECT priority, reason FROM recommendations WHERE form_id = ? ORDER BY FIELD(priority, "high", "medium", "low"), reason', [fx.formId]))[0];

const EXPECTED = (fieldIds) => [
  { rule: 'abandonment', priority: 'high', field_id: fieldIds[1], label: 'F1', reason: '50% of the sessions that reached "F1" left the form there.', suggestion: 'Simplify this field, make it optional, or reduce the effort it asks for.' },
  { rule: 'error', priority: 'high', field_id: fieldIds[1], label: 'F1', reason: '50% of the sessions that reached "F1" hit a validation error.', suggestion: 'Clarify the label, add an example or placeholder, or relax or explain the validation rule.' },
  { rule: 'correction', priority: 'medium', field_id: fieldIds[1], label: 'F1', reason: '25% of the sessions that reached "F1" had to correct their answer.', suggestion: 'Add input hints or format masks so people get it right the first time.' },
  { rule: 'not_enough_data', priority: 'low', field_id: fieldIds[2], label: 'F2', reason: 'Only 3 sessions reached "F2" so far.', suggestion: 'Share the form with more people; at least 5 sessions are needed before this field can be assessed.' },
];

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

describe('buildRecommendations (engine + database)', () => {
  it('gives the hand-calculated list for the fixture, High first', async () => {
    expect(await buildRecommendations(pool, fx.formId, { from: new Date(Date.now() - 30 * 86400e3) })).toEqual(EXPECTED(fx.fieldIds));
  });

  it('a stricter or looser threshold changes the result (configurable)', async () => {
    const from = new Date(Date.now() - 30 * 86400e3);
    const strict = { minSessions: 5, abandonment: { low: 0.01, medium: 0.02, high: 0.03 }, error: { low: 0.01, medium: 0.02, high: 0.03 }, correction: { low: 0.01, medium: 0.02, high: 0.03 }, time_ms: { low: 1000, medium: 2000, high: 3000 } };
    const lax = { ...strict, abandonment: { low: 0.9, medium: 0.95, high: 0.99 }, error: { low: 0.9, medium: 0.95, high: 0.99 }, correction: { low: 0.9, medium: 0.95, high: 0.99 }, time_ms: { low: 1e6, medium: 2e6, high: 3e6 } };
    const strictList = await buildRecommendations(pool, fx.formId, { from, thresholds: strict });
    const laxList = await buildRecommendations(pool, fx.formId, { from, thresholds: lax });
    expect(strictList.length).toBeGreaterThan(EXPECTED(fx.fieldIds).length);
    expect(laxList.map((r) => r.priority)).toEqual(['low']); // only the "not enough data" note remains
  });

  it('a form with no sessions gets no recommendations', async () => {
    expect(await buildRecommendations(pool, fx.formId, { from: new Date('2030-01-01') })).toEqual([]);
  });
});

describe('saveRecommendations', () => {
  it('replaces the previous list (no duplicates), and an error halfway changes nothing', async () => {
    const list = EXPECTED(fx.fieldIds);
    await saveRecommendations(pool, fx.formId, list);
    await saveRecommendations(pool, fx.formId, list); // same again: still 4 rows, not 8
    expect(await stored()).toHaveLength(4);

    const broken = [{ ...list[0], reason: 'would replace the list' }, { ...list[1], priority: 'urgent' }]; // 'urgent' is not allowed
    await expect(saveRecommendations(pool, fx.formId, broken)).rejects.toThrow();
    const after = await stored();
    expect(after).toHaveLength(4); // the old list is still there
    expect(after.some((r) => r.reason === 'would replace the list')).toBe(false);
  });
});

describe('GET /analytics/:formId/recommendations (FR-7.2, FR-8.1, FR-8.2)', () => {
  it('401 without a token; 404 for another admin\'s form and for an unknown form', async () => {
    expect((await api(url())).status).toBe(401);
    expect((await api(url(), tokenB)).status).toBe(404);
    expect((await api(`/analytics/${randomUUID()}/recommendations`, tokenA)).status).toBe(404);
  });

  it('returns exactly {rule, priority, field_id, label, reason, suggestion}, sorted High to Low, and saves them', async () => {
    const res = await api(url(`?from=${monthAgo()}`), tokenA);
    expect(res.status).toBe(200);
    for (const r of res.body) expect(Object.keys(r).sort()).toEqual(['field_id', 'label', 'priority', 'reason', 'rule', 'suggestion']);
    expect(res.body).toEqual(EXPECTED(fx.fieldIds));
    const rank = { high: 0, medium: 1, low: 2 };
    const ranks = res.body.map((r) => rank[r.priority]);
    expect(ranks).toEqual([...ranks].sort());
    const rows = await stored();
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.priority)).toEqual(['high', 'high', 'medium', 'low']);
  });

  it('every call replaces the saved list, following the date range', async () => {
    await api(url(`?from=${monthAgo()}`), tokenA);
    expect(await stored()).toHaveLength(4);

    const narrow = await api(url(`?from=${new Date(Date.now() - 70 * 60e3).toISOString()}&to=${new Date(Date.now() - 15 * 60e3).toISOString()}`), tokenA);
    expect(narrow.body.map((r) => r.reason)).toEqual([ // 3 sessions: every field reached by only 2
      'Only 2 sessions reached "F0" so far.', 'Only 2 sessions reached "F1" so far.', 'Only 2 sessions reached "F2" so far.',
    ]);
    expect(await stored()).toHaveLength(3); // replaced, not added to

    const none = await api(url('?from=2000-01-01&to=2000-12-31'), tokenA);
    expect(none.body).toEqual([]);
    expect(await stored()).toHaveLength(0);
  });

  it('rejects bad dates with 400 and leaves the saved list alone', async () => {
    await api(url(`?from=${monthAgo()}`), tokenA);
    expect((await api(url('?from=yesterday'), tokenA)).status).toBe(400);
    expect(await stored()).toHaveLength(4);
  });
});
