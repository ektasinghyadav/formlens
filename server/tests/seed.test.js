// Seed script tests. The demo data must be reproducible and shaped like the SRS story:
// people give up at "Resume Upload" (hard) and "Cover Letter" is slow. (Sprint 5, supports Sprints 6-7)
import { describe, it, expect, afterAll } from 'vitest';
import pool from '../db/connection.js';
import { seedDemo, makeRandom } from '../scripts/seed.js';
import { getSummary, getFieldMetrics } from '../modules/analyticsEngine.js';
import { wipeAdmins } from './helpers/analyticsFixture.js';

const email = `test-seed-${Date.now()}@example.test`;
const NOW = new Date('2026-11-10T12:00:00Z');
const adminIds = [];
afterAll(async () => {
  await wipeAdmins(pool, adminIds);
  await pool.end();
});

describe('seedDemo', () => {
  it('creates the requested number of sessions, with every submitted one having a submission', async () => {
    const r = await seedDemo(pool, { sessions: 60, seed: 1, now: NOW, email });
    adminIds.push(r.adminId);
    const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM sessions WHERE form_id = ?', [r.formId]);
    const [[{ subs }]] = await pool.query('SELECT COUNT(*) subs FROM submissions WHERE form_id = ?', [r.formId]);
    expect(n).toBe(60);
    expect(subs).toBe(r.submitted);
    expect(r.submitted + r.abandoned + r.stale).toBe(60);
    expect(r.events).toBeGreaterThan(60 * 10);
  });

  it('gives the same numbers for the same seed, and different numbers for another seed', async () => {
    const run = async (seed) => {
      const r = await seedDemo(pool, { sessions: 80, seed, now: NOW, email });
      const s = await getSummary(pool, r.formId, { now: NOW });
      return [r.events, r.submitted, r.abandoned, r.stale, s.completions];
    };
    const a = await run(5), b = await run(5), c = await run(6);
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
  });

  it('can reset: the old demo form is removed first', async () => {
    const before = await seedDemo(pool, { sessions: 20, seed: 2, now: NOW, email });
    const after = await seedDemo(pool, { sessions: 20, seed: 2, now: NOW, email, reset: true });
    const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM forms WHERE form_id = ?', [before.formId]);
    expect(n).toBe(0);
    const [[{ m }]] = await pool.query('SELECT COUNT(*) m FROM forms WHERE form_id = ?', [after.formId]);
    expect(m).toBe(1);
  });

  it('stores times in order inside each session, and never any typed text', async () => {
    const r = await seedDemo(pool, { sessions: 40, seed: 3, now: NOW, email, reset: true });
    const [[{ bad }]] = await pool.query(
      `SELECT COUNT(*) bad FROM events e JOIN sessions s ON s.session_id = e.session_id
       WHERE e.form_id = ? AND e.timestamp < s.started_at`, [r.formId]);
    expect(bad).toBe(0);
    const [rows] = await pool.query('SELECT DISTINCT metadata FROM events WHERE form_id = ? AND metadata IS NOT NULL', [r.formId]);
    for (const { metadata } of rows) expect(Object.keys(metadata)).toEqual(['chars']);
  });

  it('has the SRS story: Resume Upload is the hard field and Cover Letter is the slow one', async () => {
    const r = await seedDemo(pool, { sessions: 1500, seed: 42, now: NOW, email, reset: true });
    const m = Object.fromEntries((await getFieldMetrics(pool, r.formId, { now: NOW })).map((f) => [f.label, f]));
    const max = (key) => Object.entries(m).sort((x, y) => y[1][key] - x[1][key])[0][0];
    expect(max('abandonment_rate')).toBe('Resume Upload');
    expect(max('error_rate')).toBe('Resume Upload');
    expect(max('avg_time_ms')).toBe('Cover Letter');
    expect(m['Resume Upload'].abandonment_rate).toBeGreaterThan(0.2);
    const s = await getSummary(pool, r.formId, { now: NOW });
    expect(s.completion_rate).toBeGreaterThan(0.45);
    expect(s.completion_rate).toBeLessThan(0.8);
  }, 60000); // seeds 1,500 visits (~50,000 events), which takes a few seconds
});

describe('makeRandom', () => {
  it('is repeatable and stays between 0 and 1', () => {
    const a = makeRandom(9), b = makeRandom(9);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
