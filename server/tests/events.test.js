// Event ingest tests. Requirements: FR-3.1-3.4, FR-4.1, NFR-2.1, NFR-3.2, NFR-6.1. (Sprint 4)
// Real dfua database, throwaway admin (test-events-...), everything deleted afterwards.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import app from '../app.js';
import pool from '../db/connection.js';

const run = Date.now();
const email = `test-events-${run}@example.test`;
const password = 'correct horse battery';
const api = (method, url) => request(app)[method](`/api/v1${url}`);

let token, formId, otherFormId, fieldA, fieldB, otherField;
const auth = (r) => r.set('Authorization', `Bearer ${token}`);

const newSession = async (id = formId) => (await api('post', '/sessions').send({ form_id: id })).body.session_id;
const ev = (sessionId, over = {}) => ({
  event_id: randomUUID(), session_id: sessionId, form_id: formId, field_id: fieldA,
  event_type: 'focus', timestamp: new Date().toISOString(), metadata: null, ...over,
});
const post = (events) => api('post', '/events/batch').send({ events });
const rowCount = async (sid) => (await pool.query('SELECT COUNT(*) n FROM events WHERE session_id = ?', [sid]))[0][0].n;
// events are saved AFTER the 202 reply, so wait (briefly) for them to show up
async function waitForRows(sid, n) {
  for (let i = 0; i < 50; i++) {
    if ((await rowCount(sid)) >= n) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`expected ${n} rows for ${sid}, got ${await rowCount(sid)}`);
}
const status = async (sid) => (await pool.query('SELECT status, ended_at FROM sessions WHERE session_id = ?', [sid]))[0][0];

beforeAll(async () => {
  await api('post', '/auth/register').send({ email, password });
  token = (await api('post', '/auth/login').send({ email, password })).body.token;
  const make = async (title) => {
    const id = (await auth(api('post', '/forms')).send({ title, fields: [{ field_type: 'text', label: 'A' }, { field_type: 'text', label: 'B' }] })).body.form_id;
    await auth(api('patch', `/forms/${id}/publish`));
    return { id, fields: (await auth(api('get', `/forms/${id}`))).body.fields };
  };
  const one = await make('Events one');
  const two = await make('Events two');
  formId = one.id; fieldA = one.fields[0].field_id; fieldB = one.fields[1].field_id;
  otherFormId = two.id; otherField = two.fields[0].field_id;
});

afterAll(async () => {
  const [rows] = await pool.query("SELECT form_id FROM forms WHERE admin_id IN (SELECT admin_id FROM admins WHERE email LIKE 'test-events-%@example.test')");
  const ids = rows.length ? `(${rows.map((r) => `'${r.form_id}'`).join(',')})` : "('none')";
  await pool.query(`DELETE FROM field_responses WHERE submission_id IN (SELECT submission_id FROM submissions WHERE form_id IN ${ids})`);
  await pool.query(`DELETE FROM submissions WHERE form_id IN ${ids}`);
  await pool.query(`DELETE FROM events WHERE form_id IN ${ids}`);
  await pool.query(`DELETE FROM sessions WHERE form_id IN ${ids}`);
  await pool.query(`DELETE FROM fields WHERE form_id IN ${ids}`);
  await pool.query(`DELETE FROM forms WHERE form_id IN ${ids}`);
  await pool.query("DELETE FROM admins WHERE email LIKE 'test-events-%@example.test'");
  await pool.end();
});

describe('accepting events (FR-3.1-3.4)', () => {
  it('answers 202 and stores every event with its session, form and field ids', async () => {
    const sid = await newSession();
    const types = ['form_opened', 'focus', 'input', 'blur', 'field_completed'];
    const events = types.map((t) => ev(sid, { event_type: t, field_id: t === 'form_opened' ? null : fieldA }));
    const res = await post(events);
    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(5);
    await waitForRows(sid, 5);
    const [rows] = await pool.query('SELECT event_type, field_id, form_id FROM events WHERE session_id = ? ORDER BY timestamp, event_id', [sid]);
    expect(rows.map((r) => r.event_type).sort()).toEqual([...types].sort());
    expect(rows.find((r) => r.event_type === 'form_opened').field_id).toBeNull(); // session-level event
    expect(rows.every((r) => r.form_id === formId)).toBe(true);
  });

  it('keeps millisecond precision on timestamps and stores them in UTC', async () => {
    const sid = await newSession();
    await post([ev(sid, { timestamp: '2026-11-16T10:20:30.123Z'.replace('2026-11-16', new Date().toISOString().slice(0, 10)) })]);
    await waitForRows(sid, 1);
    const [[row]] = await pool.query('SELECT timestamp FROM events WHERE session_id = ?', [sid]);
    expect(row.timestamp.toISOString().slice(11)).toBe('10:20:30.123Z');
    const [[clock]] = await pool.query("SELECT @@session.time_zone tz, NOW() now");
    expect(clock.tz).toBe('+00:00');
    expect(Math.abs(clock.now.getTime() - Date.now())).toBeLessThan(5000);
  });

  it('ignores a retried event instead of counting it twice (NFR-2.1)', async () => {
    const sid = await newSession();
    const e = ev(sid);
    await post([e]);
    await waitForRows(sid, 1);
    expect((await post([e, ev(sid, { event_type: 'blur' })])).status).toBe(202); // same event_id again + one new
    await waitForRows(sid, 2);
    await new Promise((r) => setTimeout(r, 150));
    expect(await rowCount(sid)).toBe(2);
  });
});

describe('what is stored never contains typed text (NFR-3.2)', () => {
  it('keeps only the allowlisted metadata and drops everything else', async () => {
    const sid = await newSession();
    const secret = 'my-secret-password-123';
    await post([
      ev(sid, { event_type: 'input', metadata: { chars: 5, value: secret, text: secret, email: 'a@b.co', nested: { v: secret } } }),
      ev(sid, { event_type: 'error', metadata: { rule: 'format', reason: 'Free text with spaces and WORDS', message: secret } }),
      ev(sid, { event_type: 'input', metadata: { value: secret } }),
    ]);
    await waitForRows(sid, 3);
    const [rows] = await pool.query('SELECT event_type, metadata FROM events WHERE session_id = ? ORDER BY event_type, event_id', [sid]);
    expect(JSON.stringify(rows)).not.toContain(secret);
    expect(JSON.stringify(rows)).not.toContain('a@b.co');
    expect(rows.find((r) => r.event_type === 'error').metadata).toEqual({ rule: 'format' }); // free-text reason rejected
    const inputs = rows.filter((r) => r.event_type === 'input').map((r) => r.metadata);
    expect(inputs).toContainEqual({ chars: 5 });
    expect(inputs).toContainEqual(null);
  });
});

describe('rejecting bad batches with 400 (nothing is stored)', () => {
  it.each([
    ['no events', () => ({ events: [] })],
    ['events not a list', () => ({ events: 'x' })],
    ['no body', () => ({})],
  ])('%s', async (name, body) => {
    expect((await api('post', '/events/batch').send(body())).status).toBe(400);
  });

  it('more than 100 events', async () => {
    const sid = await newSession();
    expect((await post(Array.from({ length: 101 }, () => ev(sid)))).status).toBe(400);
    expect(await rowCount(sid)).toBe(0);
    expect((await post(Array.from({ length: 100 }, () => ev(sid)))).status).toBe(202); // exactly 100 is fine
  });

  it.each([
    ['an unknown event type', { event_type: 'hover' }],
    ['a client-sent form_submitted (the server writes that one)', { event_type: 'form_submitted' }],
    ['a malformed event id', { event_id: 'abc' }],
    ['a malformed field id', { field_id: 'abc' }],
    ['a bad timestamp', { timestamp: 'yesterday' }],
    ['a timestamp in the future', { timestamp: new Date(Date.now() + 3600e3).toISOString() }],
    ['a timestamp from last month', { timestamp: new Date(Date.now() - 30 * 86400e3).toISOString() }],
  ])('%s', async (name, over) => {
    const sid = await newSession();
    expect((await post([ev(sid), ev(sid, over)])).status).toBe(400); // one bad event rejects the whole batch
    await new Promise((r) => setTimeout(r, 100));
    expect(await rowCount(sid)).toBe(0); // including the valid one
  });

  it('an unknown session, a session of another form, and a field of another form', async () => {
    const sid = await newSession();
    expect((await post([ev(randomUUID())])).status).toBe(400);
    expect((await post([ev(sid, { form_id: otherFormId })])).status).toBe(400);
    expect((await post([ev(sid, { field_id: otherField })])).status).toBe(400);
    expect((await post([ev(sid, { field_id: randomUUID() })])).status).toBe(400);
  });
});

describe('abandonment (D-5, D-19g)', () => {
  it('marks an active session abandoned and records when it ended', async () => {
    const sid = await newSession();
    await post([ev(sid, { event_type: 'focus', field_id: fieldB }), ev(sid, { event_type: 'form_abandoned', field_id: fieldB })]);
    await waitForRows(sid, 2);
    for (let i = 0; i < 25 && (await status(sid)).status !== 'abandoned'; i++) await new Promise((r) => setTimeout(r, 40));
    const s = await status(sid);
    expect(s.status).toBe('abandoned');
    expect(s.ended_at).not.toBeNull();
  });

  it('does not store form_abandoned a second time, nor touch a submitted session', async () => {
    const sid = await newSession();
    await post([ev(sid, { event_type: 'form_abandoned' })]);
    await waitForRows(sid, 1);
    await post([ev(sid, { event_type: 'form_abandoned' })]); // already abandoned -> ignored
    await new Promise((r) => setTimeout(r, 200));
    expect(await rowCount(sid)).toBe(1);

    const fieldRows = (await auth(api('get', `/forms/${formId}`))).body.fields;
    const sid2 = await newSession();
    const sub = await api('post', `/forms/${formId}/submit`).send({ session_id: sid2, responses: fieldRows.map((f) => ({ field_id: f.field_id, value: 'x' })) });
    expect(sub.status).toBe(201);
    await post([ev(sid2, { event_type: 'form_abandoned' })]);
    await new Promise((r) => setTimeout(r, 200));
    expect((await status(sid2)).status).toBe('submitted'); // stays submitted
    expect(await rowCount(sid2)).toBe(1); // only the server's form_submitted
  });

  it('lets a visit marked abandoned (tab was hidden) still be submitted when the person returns', async () => {
    const sid = await newSession();
    await post([ev(sid, { event_type: 'form_abandoned' })]);
    for (let i = 0; i < 25 && (await status(sid)).status !== 'abandoned'; i++) await new Promise((r) => setTimeout(r, 40));
    const fieldRows = (await auth(api('get', `/forms/${formId}`))).body.fields;
    const sub = await api('post', `/forms/${formId}/submit`).send({ session_id: sid, responses: fieldRows.map((f) => ({ field_id: f.field_id, value: 'x' })) });
    expect(sub.status).toBe(201);
    expect((await status(sid)).status).toBe('submitted');
  });
});

describe('failure handling (NFR-2.1, NFR-6.1)', () => {
  it('still answers 202 and keeps running if the database insert fails; the retry then saves it', async () => {
    const sid = await newSession();
    const original = pool.query.bind(pool);
    const spy = vi.spyOn(pool, 'query').mockImplementation((sql, ...rest) =>
      typeof sql === 'string' && sql.includes('INSERT INTO events') && spy.mock.calls.filter((c) => String(c[0]).includes('INSERT INTO events')).length === 1
        ? Promise.reject(new Error('simulated database failure'))
        : original(sql, ...rest)
    );
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post([ev(sid)]);
    expect(res.status).toBe(202);
    await waitForRows(sid, 1); // the single automatic retry saved it
    expect(errors.mock.calls[0][0]).toContain('retrying');
    spy.mockRestore();
    errors.mockRestore();
    expect((await api('get', '/health')).status).toBe(200); // server is fine
  });
});
