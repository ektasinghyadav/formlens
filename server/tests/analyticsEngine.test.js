// analyticsEngine unit tests with HAND-CALCULATED numbers. Requirements: FR-5.1-5.3, NFR-5.1. (Sprint 5)
//
// Fixture (see helpers/analyticsFixture.js). now = 2026-11-10 12:00 UTC. F0, F1, F2 = fields in order.
//
//  session  started  status       what happened
//  S1       10:00    submitted    F0 2000+1000 ms, F1 2000 ms (error), F2 6000 ms
//  S2       10:30    abandoned    F0 4000, F1 6000 (error + correction), left at F1
//  S3       11:00    abandoned    F0 2000, F1 4000, F2 focused (no blur), left at F2
//  S4       11:30    abandoned    never touched a field
//  S5       11:55    active       focus F0 (no blur); an "error" on F2 it never focused. In progress (5 min)
//  S6       09:00    active       F0 1000, focus F1 (no blur). 3 hours old -> stale -> abandoned at F1
//  S7       11:40    submitted    F2 3000, then F0 1000; skipped F1
//  S8       Oct 1    abandoned    F0 1000, left at F0 (outside any "recent" range)
//
// By hand, S1..S7 (S8 excluded by from = Nov 1):
//   views 7, completions 2 (S1,S7), abandonments 4 (S2,S3,S4,S6), completion_rate 2/7 = 0.2857
//   furthest field: S1=F2 S2=F1 S3=F2 S5=F0 S6=F1 S7=F2   -> reached F0=6, F1=5, F2=3
//   left at (abandoned, last focus): S2=F1 S3=F2 S6=F1     -> dropped F0=0, F1=2, F2=1
//   drop_rate: 0/6=0, 2/5=0.4, 1/3=0.3333
//   focused: F0=6 (S1,S2,S3,S5,S6,S7) F1=4 (S1,S2,S3,S6) F2=3 (S1,S3,S7)
//   error_rate: F0 0, F1 2/4=0.5 (S1,S2), F2 0 (S5's error does not count: it never focused F2)
//   correction_rate: F1 1/4=0.25 (S2)
//   avg_time_ms: F0 (3000+4000+2000+1000+1000)/5=2200   F1 (2000+6000+4000)/3=4000   F2 (6000+3000)/2=4500
//   abandonment_rate: F0 0/6=0, F1 2/4=0.5, F2 1/3=0.3333
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import pool from '../db/connection.js';
import { getSummary, getFunnel, getFieldMetrics } from '../modules/analyticsEngine.js';
import { buildFixture, createAdmin, createForm, addSession, wipeAdmins } from './helpers/analyticsFixture.js';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const NOV1 = new Date('2026-11-01T00:00:00.000Z');
const admins = [];
let fx;
const opts = (extra = {}) => ({ from: NOV1, now: NOW, ...extra });
const byLabel = (rows) => Object.fromEntries(rows.map((r) => [r.label, r]));

beforeAll(async () => {
  const adminId = await createAdmin(pool, 'engine');
  admins.push(adminId);
  fx = await buildFixture(pool, adminId, NOW);
});
afterAll(async () => {
  await wipeAdmins(pool, admins);
  await pool.end();
});

describe('getSummary (FR-5.1)', () => {
  it('matches the hand-calculated numbers', async () => {
    expect(await getSummary(pool, fx.formId, opts())).toEqual({ views: 7, completions: 2, abandonments: 4, completion_rate: 0.2857 });
  });

  it('with no date range counts every session, including the old one', async () => {
    expect(await getSummary(pool, fx.formId, { now: NOW })).toEqual({ views: 8, completions: 2, abandonments: 5, completion_rate: 0.25 });
  });

  it('only counts sessions that STARTED inside the range (both ends inclusive)', async () => {
    const r = await getSummary(pool, fx.formId, { from: fx.at(60), to: fx.at(20), now: NOW }); // S3 (11:00), S4, S7 (11:40)
    expect(r).toEqual({ views: 3, completions: 1, abandonments: 2, completion_rate: 0.3333 });
  });

  it('a range with nothing in it gives zeros, never NaN', async () => {
    const r = await getSummary(pool, fx.formId, { from: new Date('2030-01-01'), now: NOW });
    expect(r).toEqual({ views: 0, completions: 0, abandonments: 0, completion_rate: 0 });
  });

  it('treats an "active" session as abandoned only once it is more than 30 minutes old (D-5)', async () => {
    // S6 started 09:00. At 09:20 it is still in progress; at 09:31 it is stale.
    const early = await getSummary(pool, fx.formId, opts({ now: new Date('2026-11-10T09:20:00Z') }));
    const late = await getSummary(pool, fx.formId, opts({ now: new Date('2026-11-10T09:31:00Z') }));
    expect(late.abandonments - early.abandonments).toBeGreaterThanOrEqual(1);
    expect(early.abandonments).toBe(3); // S2, S3, S4 (S5 and S6 both "in progress")
    expect(late.abandonments).toBe(4);  // + S6
  });

  it('a form with no sessions, and a form with exactly one session', async () => {
    const adminId = await createAdmin(pool, 'engine-small');
    admins.push(adminId);
    const empty = await createForm(pool, adminId, 'Empty', ['A']);
    expect(await getSummary(pool, empty.formId, { now: NOW })).toEqual({ views: 0, completions: 0, abandonments: 0, completion_rate: 0 });

    const one = await createForm(pool, adminId, 'One', ['A']);
    await addSession(pool, { ...one, started: new Date('2026-11-10T10:00:00Z'), status: 'submitted', events: [[0, 'form_opened', null], [0, 'focus', 0], [1500, 'blur', 0], [2000, 'form_submitted', null]] });
    expect(await getSummary(pool, one.formId, { now: NOW })).toEqual({ views: 1, completions: 1, abandonments: 0, completion_rate: 1 });
    expect(await getFunnel(pool, one.formId, { now: NOW })).toEqual([{ field_id: one.fieldIds[0], label: 'A', reached: 1, dropped: 0, drop_rate: 0 }]);
    expect((await getFieldMetrics(pool, one.formId, { now: NOW }))[0]).toMatchObject({ avg_time_ms: 1500, error_rate: 0, correction_rate: 0, abandonment_rate: 0 });
  });
});

describe('getFunnel (FR-5.3)', () => {
  it('matches the hand-calculated reached / dropped / drop_rate, in form order', async () => {
    const rows = await getFunnel(pool, fx.formId, opts());
    expect(rows.map((r) => r.label)).toEqual(['F0', 'F1', 'F2']);
    expect(rows.map((r) => r.field_id)).toEqual(fx.fieldIds);
    expect(rows.map((r) => [r.reached, r.dropped, r.drop_rate])).toEqual([[6, 0, 0], [5, 2, 0.4], [3, 1, 0.3333]]);
  });

  it('never goes up from one field to the next, even with out-of-order filling (S7 started at F2)', async () => {
    const reached = (await getFunnel(pool, fx.formId, opts())).map((r) => r.reached);
    for (let i = 1; i < reached.length; i++) expect(reached[i]).toBeLessThanOrEqual(reached[i - 1]);
  });

  it('does not count someone who submitted without visiting a later field as a drop (S7 skipped F1)', async () => {
    const f1 = (await getFunnel(pool, fx.formId, { from: fx.at(30), to: fx.at(10), now: NOW }))[1]; // S4 and S7 only
    expect(f1).toMatchObject({ reached: 1, dropped: 0 });
  });

  it('follows the date range', async () => {
    const rows = await getFunnel(pool, fx.formId, { from: fx.at(60), to: fx.at(20), now: NOW }); // S3, S4, S7
    expect(rows.map((r) => [r.reached, r.dropped, r.drop_rate])).toEqual([[2, 0, 0], [2, 0, 0], [2, 1, 0.5]]);
  });

  it('gives zeros for a range with no sessions, and an empty list for a form with no fields', async () => {
    expect((await getFunnel(pool, fx.formId, { from: new Date('2030-01-01'), now: NOW })).every((r) => r.reached === 0 && r.drop_rate === 0)).toBe(true);
    const adminId = await createAdmin(pool, 'engine-nofields');
    admins.push(adminId);
    const bare = await createForm(pool, adminId, 'No fields', []);
    expect(await getFunnel(pool, bare.formId, { now: NOW })).toEqual([]);
  });
});

describe('getFieldMetrics (FR-5.2)', () => {
  it('matches the hand-calculated time, error, correction and abandonment numbers', async () => {
    const m = byLabel(await getFieldMetrics(pool, fx.formId, opts()));
    const pick = (r) => [r.avg_time_ms, r.error_rate, r.correction_rate, r.abandonment_rate];
    expect(pick(m.F0)).toEqual([2200, 0, 0, 0]);
    expect(pick(m.F1)).toEqual([4000, 0.5, 0.25, 0.5]);
    expect(pick(m.F2)).toEqual([4500, 0, 0, 0.3333]);
  });

  it('sums repeated visits to a field within one session (S1 visited F0 twice: 2000 + 1000)', async () => {
    const only = await getFieldMetrics(pool, fx.formId, { from: fx.at(121), to: fx.at(119), now: NOW }); // S1 alone
    expect(byLabel(only).F0.avg_time_ms).toBe(3000);
  });

  it('ignores a focus that has no blur (S5 on F0; S6 on F1; S3 on F2)', async () => {
    const only = await getFieldMetrics(pool, fx.formId, { from: fx.at(6), to: fx.at(4), now: NOW }); // S5 alone
    expect(byLabel(only).F0.avg_time_ms).toBe(0); // its only focus never ended
  });

  it('does not count an error on a field the person never focused (S5 on F2)', async () => {
    const only = byLabel(await getFieldMetrics(pool, fx.formId, { from: fx.at(6), to: fx.at(4), now: NOW }));
    expect(only.F2.error_rate).toBe(0);
  });

  it('keeps every rate between 0 and 1 and returns whole-number times', async () => {
    for (const r of await getFieldMetrics(pool, fx.formId, { now: NOW })) {
      for (const v of [r.error_rate, r.correction_rate, r.abandonment_rate]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
      expect(Number.isInteger(r.avg_time_ms)).toBe(true);
    }
  });

  it('follows the date range, and gives zeros (not NaN) when nothing falls inside it', async () => {
    const none = await getFieldMetrics(pool, fx.formId, { from: new Date('2030-01-01'), now: NOW });
    expect(none).toHaveLength(3);
    for (const r of none) expect([r.avg_time_ms, r.error_rate, r.correction_rate, r.abandonment_rate]).toEqual([0, 0, 0, 0]);
  });
});

describe('simultaneous identical requests share one query, but nothing is cached (NFR-1.2)', () => {
  const eventQueries = (spy) => spy.mock.calls.filter((c) => String(c[0]).includes('JOIN events e')).length;

  it('a funnel and a field-metrics request at the same moment load the focus events only once each, and the same request twice loads once', async () => {
    const spy = vi.spyOn(pool, 'query');
    await Promise.all([getFunnel(pool, fx.formId, opts()), getFunnel(pool, fx.formId, opts()), getFunnel(pool, fx.formId, opts())]);
    expect(eventQueries(spy)).toBe(1); // three identical requests, one query
    spy.mockClear();
    await Promise.all([getFunnel(pool, fx.formId, opts()), getFieldMetrics(pool, fx.formId, opts())]);
    expect(eventQueries(spy)).toBe(2); // different event types: two queries, not one each per field of work
    spy.mockRestore();
  });

  it('a later request runs a fresh query and sees new data (no caching)', async () => {
    const adminId = await createAdmin(pool, 'engine-fresh');
    admins.push(adminId);
    const f = await createForm(pool, adminId, 'Fresh', ['A']);
    const first = await getFunnel(pool, f.formId, { now: NOW });
    expect(first[0].reached).toBe(0);
    await addSession(pool, { ...f, started: new Date('2026-11-10T10:00:00Z'), status: 'abandoned', events: [[0, 'focus', 0]] });
    const second = await getFunnel(pool, f.formId, { now: NOW });
    expect(second[0].reached).toBe(1);
  });

  it('requests for different date ranges are NOT mixed up', async () => {
    const [all, narrow] = await Promise.all([
      getSummary(pool, fx.formId, { now: NOW }),
      getSummary(pool, fx.formId, { from: fx.at(60), to: fx.at(20), now: NOW }),
    ]);
    expect(all.views).toBe(8);
    expect(narrow.views).toBe(3);
    const [fa, fb] = await Promise.all([getFunnel(pool, fx.formId, opts()), getFunnel(pool, fx.formId, { from: fx.at(60), to: fx.at(20), now: NOW })]);
    expect(fa[0].reached).toBe(6);
    expect(fb[0].reached).toBe(2);
  });
});

describe('module boundary (NFR-5.1)', () => {
  it('analyticsEngine.js uses no Express, request or response objects', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../modules/analyticsEngine.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from\s+['"]express['"]|require\(['"]express|\breq\.|\bres\.|import\s+pool/);
    expect(src).not.toMatch(/^import\s/m); // it imports nothing: the connection is passed in
  });
});
