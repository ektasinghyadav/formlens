// routes/events.js - POST /events/batch: receives the tracker's events.
// Requirements: FR-3.1-3.4 (event capture), FR-4.1 (stored), NFR-2.1, NFR-3.2 (no PII), NFR-6.1.
// Flow: validate everything -> answer 202 at once -> save in the background. The browser
// never waits for the database (NFR-1.3), and every step is separate so a queue can be slotted
// in later without a rewrite (NFR-6.1): only enqueue() would change.
import { Router } from 'express';
import pool from '../db/connection.js';

const router = Router();

const EVENT_TYPES = [
  'focus', 'input', 'blur', 'error', 'correction', 'field_completed',
  'form_opened', 'form_submitted', 'form_abandoned',
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BATCH = 100;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // a replayed offline queue may be old, but not ancient
const MAX_FUTURE_MS = 5 * 60 * 1000; // allows a little clock difference

// NFR-3.2: events must never hold what the respondent typed. Instead of trying to spot
// "bad" keys (we could miss one), we keep ONLY a short allowlist and drop the rest.
export function cleanMetadata(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const out = {};
  if (Number.isFinite(m.chars) && m.chars >= 0 && m.chars <= 1e6) out.chars = Math.floor(m.chars);
  for (const key of ['rule', 'reason']) {
    // short lowercase codes only, so free text cannot sneak in
    if (typeof m[key] === 'string' && /^[a-z_]{1,30}$/.test(m[key])) out[key] = m[key];
  }
  return Object.keys(out).length ? out : null;
}

// Checks the shape of the request. Returns { error } or { events } (cleaned copies).
function checkShape(body) {
  const list = body?.events;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_BATCH) {
    return { error: `Send between 1 and ${MAX_BATCH} events` };
  }
  const now = Date.now();
  const events = [];
  for (const [i, e] of list.entries()) {
    const where = `Event ${i + 1}`;
    if (!e || typeof e !== 'object') return { error: `${where} is invalid` };
    if (!UUID.test(e.event_id) || !UUID.test(e.session_id) || !UUID.test(e.form_id)) return { error: `${where}: bad id` };
    if (e.field_id !== null && e.field_id !== undefined && !UUID.test(e.field_id)) return { error: `${where}: bad field_id` };
    if (!EVENT_TYPES.includes(e.event_type)) return { error: `${where}: unknown event_type` };
    if (e.event_type === 'form_submitted') return { error: `${where}: form_submitted is written by the server` }; // D-4
    const t = Date.parse(e.timestamp);
    if (Number.isNaN(t) || t > now + MAX_FUTURE_MS || t < now - MAX_AGE_MS) return { error: `${where}: timestamp out of range` };
    events.push({
      event_id: e.event_id, session_id: e.session_id, form_id: e.form_id,
      field_id: e.field_id ?? null, event_type: e.event_type, time: new Date(t),
      metadata: cleanMetadata(e.metadata),
    });
  }
  return { events };
}

// Checks the events against the database: session exists and belongs to the form, and any
// field belongs to that form. Returns { error } or { sessions } (id -> status).
async function checkReferences(events) {
  const sessionIds = [...new Set(events.map((e) => e.session_id))];
  const [sessionRows] = await pool.query('SELECT session_id, form_id, status FROM sessions WHERE session_id IN (?)', [sessionIds]);
  const sessions = new Map(sessionRows.map((s) => [s.session_id, s]));

  const fieldIds = [...new Set(events.map((e) => e.field_id).filter(Boolean))];
  const fieldForm = new Map();
  if (fieldIds.length) {
    const [fieldRows] = await pool.query('SELECT field_id, form_id FROM fields WHERE field_id IN (?)', [fieldIds]);
    for (const f of fieldRows) fieldForm.set(f.field_id, f.form_id);
  }

  for (const e of events) {
    const s = sessions.get(e.session_id);
    if (!s || s.form_id !== e.form_id) return { error: 'Unknown session for this form' };
    if (e.field_id && fieldForm.get(e.field_id) !== e.form_id) return { error: 'Field does not belong to this form' };
  }
  return { sessions };
}

// Saves a validated batch. Safe to run twice (same event_id = same row).
async function persistEvents(events, sessions) {
  // form_abandoned only counts for a session that is still active (D-19g), and once per batch
  const seen = new Set();
  const toSave = events.filter((e) => {
    if (e.event_type !== 'form_abandoned') return true;
    const ok = sessions.get(e.session_id).status === 'active' && !seen.has(e.session_id);
    seen.add(e.session_id);
    return ok;
  });
  if (toSave.length) {
    const rows = toSave.map((e) => [
      e.event_id, e.session_id, e.field_id, e.form_id, e.event_type, e.time,
      e.metadata && JSON.stringify(e.metadata),
    ]);
    await pool.query(
      `INSERT INTO events (event_id, session_id, field_id, form_id, event_type, timestamp, metadata) VALUES ?
       ON DUPLICATE KEY UPDATE event_id = event_id`, // a retried event is simply ignored
      [rows]
    );
  }
  for (const e of toSave.filter((x) => x.event_type === 'form_abandoned')) {
    await pool.query("UPDATE sessions SET status = 'abandoned', ended_at = ? WHERE session_id = ? AND status = 'active'", [e.time, e.session_id]);
  }
}

// The one place that hands events to storage. Today: save straight away (retry once).
// Later (NFR-6.1): put them on a queue here instead; nothing else has to change.
async function enqueue(events, sessions) {
  try {
    await persistEvents(events, sessions);
  } catch (err) {
    console.error('Event insert failed, retrying once:', err.message);
    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      await persistEvents(events, sessions);
    } catch (err2) {
      console.error('Event insert failed again, batch lost:', err2.message); // logged, never crashes the server
    }
  }
}

router.post('/batch', async (req, res) => {
  const shape = checkShape(req.body);
  if (shape.error) return res.status(400).json({ error: shape.error });
  const refs = await checkReferences(shape.events);
  if (refs.error) return res.status(400).json({ error: refs.error });

  res.status(202).json({ accepted: shape.events.length }); // answer first ...
  await enqueue(shape.events, refs.sessions); // ... save afterwards
});

export default router;
