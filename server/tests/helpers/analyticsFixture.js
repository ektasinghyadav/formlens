// Shared test data for the analytics tests: 8 tiny sessions whose numbers were worked out
// BY HAND (see the table in analyticsEngine.test.js). Times are given as "minutes before now"
// so the same data works with a fixed clock (engine tests) and the real clock (API tests).
import { randomUUID } from 'node:crypto';

const MIN = 60 * 1000;

export async function createAdmin(pool, tag) {
  const adminId = randomUUID();
  // 60 characters of filler: engine tests don't log in, they only need an owner row
  await pool.query('INSERT INTO admins (admin_id, email, password_hash) VALUES (?, ?, ?)', [adminId, `test-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`, 'x'.repeat(60)]);
  return adminId;
}

export async function createForm(pool, adminId, title, labels) {
  const formId = randomUUID();
  await pool.query("INSERT INTO forms (form_id, admin_id, title, status, share_link) VALUES (?, ?, ?, 'published', ?)", [formId, adminId, title, randomUUID().slice(0, 16)]);
  const fieldIds = [];
  for (const [i, label] of labels.entries()) {
    const id = randomUUID();
    await pool.query("INSERT INTO fields (field_id, form_id, field_type, label, position) VALUES (?, ?, 'text', ?, ?)", [id, formId, label, i]);
    fieldIds.push(id);
  }
  return { formId, fieldIds };
}

// events: [[offsetMs, eventType, fieldIndex|null], ...]  (offset counted from the session start)
export async function addSession(pool, { formId, fieldIds, started, status, events }) {
  const sessionId = randomUUID();
  await pool.query('INSERT INTO sessions (session_id, form_id, started_at, status, ip_hash) VALUES (?, ?, ?, ?, ?)', [sessionId, formId, started, status, 'a'.repeat(64)]);
  if (events.length) {
    const rows = events.map(([offset, type, field]) => [randomUUID(), sessionId, field === null ? null : fieldIds[field], formId, type, new Date(started.getTime() + offset), null]);
    await pool.query('INSERT INTO events (event_id, session_id, field_id, form_id, event_type, timestamp, metadata) VALUES ?', [rows]);
  }
  return sessionId;
}

// Three fields F0, F1, F2 and eight sessions S1..S8 (see the hand calculation in the engine test).
export async function buildFixture(pool, adminId, now) {
  const { formId, fieldIds } = await createForm(pool, adminId, 'Fixture form', ['F0', 'F1', 'F2']);
  const at = (minutesAgo) => new Date(now.getTime() - minutesAgo * MIN);
  const add = (minutesAgo, status, events) => addSession(pool, { formId, fieldIds, started: at(minutesAgo), status, events });
  const sessions = {};

  // S1 submitted. F0 twice (2000 + 1000 ms), F1 with an error (2000 ms), F2 (6000 ms)
  sessions.S1 = await add(120, 'submitted', [
    [0, 'form_opened', null],
    [0, 'focus', 0], [2000, 'blur', 0], [2000, 'field_completed', 0],
    [2000, 'focus', 1], [3000, 'error', 1], [4000, 'blur', 1],
    [4000, 'focus', 2], [10000, 'blur', 2],
    [10000, 'focus', 0], [11000, 'blur', 0],
    [11500, 'form_submitted', null],
  ]);
  // S2 abandoned at F1: F0 4000 ms, F1 6000 ms with an error and a correction
  sessions.S2 = await add(90, 'abandoned', [
    [0, 'form_opened', null],
    [0, 'focus', 0], [4000, 'blur', 0],
    [4000, 'focus', 1], [8000, 'error', 1], [9000, 'correction', 1], [10000, 'blur', 1],
    [10000, 'form_abandoned', 1],
  ]);
  // S3 abandoned at F2 without ever leaving it (focus with no blur): F0 2000 ms, F1 4000 ms
  sessions.S3 = await add(60, 'abandoned', [
    [0, 'form_opened', null],
    [0, 'focus', 0], [2000, 'blur', 0],
    [2000, 'focus', 1], [6000, 'blur', 1],
    [6000, 'focus', 2],
    [7000, 'form_abandoned', 2],
  ]);
  // S4 abandoned without touching any field
  sessions.S4 = await add(30, 'abandoned', [[0, 'form_opened', null], [3000, 'form_abandoned', null]]);
  // S5 still in progress (5 min old): focus on F0 with no blur, and an error on F2 that it never focused
  sessions.S5 = await add(5, 'active', [[0, 'form_opened', null], [0, 'focus', 0], [5000, 'error', 2]]);
  // S6 "active" for 3 hours: stale, so counted as abandoned (last focus = F1, no blur). F0 1000 ms
  sessions.S6 = await add(180, 'active', [
    [0, 'form_opened', null], [0, 'focus', 0], [1000, 'blur', 0], [1000, 'focus', 1],
  ]);
  // S7 submitted, filled out of order and skipped F1: F2 3000 ms, then F0 1000 ms
  sessions.S7 = await add(20, 'submitted', [
    [0, 'form_opened', null], [0, 'focus', 2], [3000, 'blur', 2], [3000, 'focus', 0], [4000, 'blur', 0],
    [5000, 'form_submitted', null],
  ]);
  // S8 started 40 days ago (outside "recent" ranges), abandoned at F0 after 1000 ms
  sessions.S8 = await add(40 * 24 * 60, 'abandoned', [
    [0, 'form_opened', null], [0, 'focus', 0], [1000, 'blur', 0], [1000, 'form_abandoned', 0],
  ]);
  return { formId, fieldIds, sessions, at };
}

// Deletes everything belonging to the given admins (children first).
export async function wipeAdmins(pool, adminIds) {
  if (!adminIds.length) return;
  const [forms] = await pool.query('SELECT form_id FROM forms WHERE admin_id IN (?)', [adminIds]);
  const ids = forms.map((f) => f.form_id);
  if (ids.length) {
    await pool.query('DELETE FROM field_responses WHERE submission_id IN (SELECT submission_id FROM submissions WHERE form_id IN (?))', [ids]);
    await pool.query('DELETE FROM submissions WHERE form_id IN (?)', [ids]);
    await pool.query('DELETE FROM recommendations WHERE form_id IN (?)', [ids]);
    await pool.query('DELETE FROM events WHERE form_id IN (?)', [ids]);
    await pool.query('DELETE FROM sessions WHERE form_id IN (?)', [ids]);
    await pool.query('DELETE FROM fields WHERE form_id IN (?)', [ids]);
    await pool.query('DELETE FROM forms WHERE form_id IN (?)', [ids]);
  }
  await pool.query('DELETE FROM admins WHERE admin_id IN (?)', [adminIds]);
}
