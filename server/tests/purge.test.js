// Retention purge tests. Requirement: FR-4.2. (Sprint 8)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pool from '../db/connection.js';
import { purgeOldEvents } from '../scripts/purgeOldEvents.js';
import { createAdmin, createForm, wipeAdmins } from './helpers/analyticsFixture.js';

const NOW = new Date('2026-11-16T12:00:00Z');
const DAY = 86400e3;
const ago = (days, extraMs = 0) => new Date(NOW.getTime() - days * DAY - extraMs);
let adminId, formId, fieldId, sessionId;

async function addEvent(time) {
  await pool.query("INSERT INTO events (event_id, session_id, field_id, form_id, event_type, timestamp) VALUES (?, ?, ?, ?, 'focus', ?)", [randomUUID(), sessionId, fieldId, formId, time]);
}
const countEvents = async () => (await pool.query('SELECT COUNT(*) n FROM events WHERE form_id = ?', [formId]))[0][0].n;

beforeAll(async () => {
  adminId = await createAdmin(pool, 'purge');
  const f = await createForm(pool, adminId, 'Purge', ['A']);
  formId = f.formId; fieldId = f.fieldIds[0];
  sessionId = randomUUID();
  await pool.query('INSERT INTO sessions (session_id, form_id, started_at, status, ip_hash) VALUES (?, ?, ?, ?, ?)', [sessionId, formId, ago(300), 'submitted', 'a'.repeat(64)]);
});
afterAll(async () => {
  await wipeAdmins(pool, [adminId]);
  await pool.end();
});

describe('purgeOldEvents (FR-4.2)', () => {
  it('a dry run only counts: nothing is deleted', async () => {
    for (const d of [300, 200, 181, 179, 10, 0]) await addEvent(ago(d));
    const r = await purgeOldEvents(pool, { days: 180, dryRun: true, now: NOW });
    expect(r).toMatchObject({ dryRun: true, matched: 3, deleted: 0, days: 180 }); // 300, 200, 181 days old
    expect(await countEvents()).toBe(6);
  });

  it('deletes only events older than the retention period, and keeps the session', async () => {
    const r = await purgeOldEvents(pool, { days: 180, now: NOW });
    expect(r).toMatchObject({ dryRun: false, matched: 3, deleted: 3 });
    expect(await countEvents()).toBe(3); // 179, 10 and 0 days old remain
    const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM sessions WHERE session_id = ?', [sessionId]);
    expect(n).toBe(1);
  });

  it('keeps an event that is exactly at the cut-off, and removes one a moment older', async () => {
    await addEvent(ago(180)); // exactly 180 days: kept
    await addEvent(ago(180, 1000)); // one second older: removed
    const r = await purgeOldEvents(pool, { days: 180, now: NOW });
    expect(r.deleted).toBe(1);
  });

  it('a shorter or longer period changes what is removed (configurable)', async () => {
    expect((await purgeOldEvents(pool, { days: 365, dryRun: true, now: NOW })).matched).toBe(0);
    expect((await purgeOldEvents(pool, { days: 5, dryRun: true, now: NOW })).matched).toBeGreaterThanOrEqual(2); // 10 and 179 days old
  });

  it('works in batches and finishes with nothing left to delete', async () => {
    for (let i = 0; i < 12; i++) await addEvent(ago(400 + i));
    const r = await purgeOldEvents(pool, { days: 180, now: NOW, batchSize: 5 }); // 3 rounds of 5, 5, 2
    expect(r.deleted).toBe(12);
    expect((await purgeOldEvents(pool, { days: 180, dryRun: true, now: NOW })).matched).toBe(0);
  });

  it.each([0, -3, 1.5, NaN, undefined])('refuses a bad number of days (%s)', async (days) => {
    await expect(purgeOldEvents(pool, { days, now: NOW })).rejects.toThrow(/whole number/);
  });
});
