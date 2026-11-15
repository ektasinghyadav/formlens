// 50 respondents at the same time. Requirements: NFR-2.1, SRS 2.4, NFR-1.3 / FR-3.4 (batching works under load). (Sprint 8)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import app from '../app.js';
import pool from '../db/connection.js';
import { createLoadForm, simulateRespondents, verifyStored } from '../scripts/loadTest.js';
import { wipeAdminsByEmail } from './helpers/loadCleanup.js';

let server, baseUrl, form;
beforeAll(async () => {
  server = app.listen(0); // a real HTTP server on a free port, so the simulated browsers use real requests
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  form = await createLoadForm(baseUrl);
});
afterAll(async () => {
  await wipeAdminsByEmail(pool, form.email);
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

describe('50 concurrent respondents (SRS 2.4, NFR-2.1)', () => {
  it('no request fails, and every acknowledged event is stored exactly once', async () => {
    const run = await simulateRespondents({ baseUrl, form, respondents: 50 });
    expect(run.problems).toEqual([]);
    expect(run.submitted + run.abandoned).toBe(50);
    expect(run.submitted).toBeGreaterThan(20);
    expect(run.abandoned).toBeGreaterThan(5);
    expect(run.acknowledged).toBeGreaterThan(50 * 5);

    const db = await verifyStored(pool, form, run);
    expect(db.stored).toBe(db.expectedEvents);   // nothing acknowledged was lost
    expect(db.distinct).toBe(db.stored);          // nothing stored twice
    expect(db.submissions).toBe(run.submitted);
    expect(db.submittedEvents).toBe(run.submitted); // exactly one server-written form_submitted per submit
    expect(db.byStatus.submitted).toBe(run.submitted);
    expect(db.byStatus.abandoned).toBe(run.abandoned);
    expect(db.sessions).toBe(50);
  }, 60000);
});
