// scripts/seed.js - makes SYNTHETIC demo data (SRS 2.6: test data is synthetic, never real people).
// Requirements: FR-4.1 (stored data), supports the tests/demo for FR-5.x, FR-6.x, FR-7.x, NFR-1.2.
// Usage:  npm run seed                (5,000 sessions)      npm run seed -- --sessions 200
//         npm run seed -- --reset     (delete the old demo form first; adds a fresh one)
// Creates (or reuses) the demo admin  demo@example.com / demo-password-123  and a demo form
// "Demo: Job Application" whose shape matches the SRS example: lots of people give up at
// "Resume Upload" (the hard field), and "Cover Letter" is slow.
// The random numbers come from a seeded generator, so the same seed gives the same data.
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcrypt';

export const DEMO_EMAIL = 'demo@example.com';
export const DEMO_PASSWORD = 'demo-password-123';
export const DEMO_TITLE = 'Demo: Job Application';

// Per field: how long people spend, and how often things go wrong (chances are 0-1).
const FIELDS = [
  { label: 'Full Name',     type: 'text',     required: true,  timeMs: 6000,  error: 0.03, correct: 0.4, abandon: 0.01 },
  { label: 'Email',         type: 'email',    required: true,  timeMs: 8000,  error: 0.12, correct: 0.5, abandon: 0.015 },
  { label: 'Phone',         type: 'number',   required: false, timeMs: 9000,  error: 0.14, correct: 0.5, abandon: 0.02 },
  { label: 'Resume Upload', type: 'file',     required: true,  timeMs: 15000, error: 0.38, correct: 0.6, abandon: 0.34 }, // the HARD field
  { label: 'Cover Letter',  type: 'text',     required: false, timeMs: 45000, error: 0.05, correct: 0.3, abandon: 0.06 }, // the SLOW field
  { label: 'City',          type: 'dropdown', required: false, timeMs: 4000,  error: 0.01, correct: 0.3, abandon: 0.005 },
];
const DAY = 24 * 60 * 60 * 1000;

// Small, fast, seedable random number generator (mulberry32). Returns numbers in [0, 1).
export function makeRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function deleteDemoForms(db, adminId) {
  const [forms] = await db.query('SELECT form_id FROM forms WHERE admin_id = ? AND title = ?', [adminId, DEMO_TITLE]);
  for (const { form_id: id } of forms) {
    await db.query('DELETE FROM recommendations WHERE form_id = ?', [id]);
    await db.query('DELETE FROM events WHERE form_id = ?', [id]);
    await db.query('DELETE FROM submissions WHERE form_id = ?', [id]);
    await db.query('DELETE FROM sessions WHERE form_id = ?', [id]);
    await db.query('DELETE FROM fields WHERE form_id = ?', [id]);
    await db.query('DELETE FROM forms WHERE form_id = ?', [id]);
  }
}

// Builds the event list for ONE visit. Times only ever move forward (each step adds >= 1 ms).
function simulateSession(rand, startedAt, fields) {
  const events = [];
  let t = 0;
  const add = (type, field, metadata = null) => events.push({ type, field, ms: t, metadata });
  add('form_opened', null);
  let status = 'submitted';
  let abandonedAt = null;

  for (const f of fields) {
    t += 300 + Math.floor(rand() * 1500); // moving to the next field
    add('focus', f.id);
    const spend = Math.max(800, Math.round(f.timeMs * (0.4 + rand() * 1.2))); // 40%-160% of the average
    const keystrokes = 2 + Math.floor(rand() * 6);
    for (let k = 1; k <= keystrokes; k++) {
      t += Math.max(1, Math.floor((spend / keystrokes) * (0.5 + rand())));
      add('input', f.id, { chars: k * 3 });
    }
    let hadError = false;
    if (rand() < f.error) {
      hadError = true;
      t += 200 + Math.floor(rand() * 800);
      add('error', f.id);
      if (rand() < f.correct) {
        t += 500 + Math.floor(rand() * 2000);
        add('correction', f.id);
        t += 300 + Math.floor(rand() * 1500);
        add('input', f.id, { chars: 5 });
      }
    }
    // some people give up here: for most the cursor leaves first, for some the tab just closes
    if (rand() < f.abandon) {
      if (rand() < 0.5) { t += 200; add('blur', f.id); }
      t += 300 + Math.floor(rand() * 1000);
      add('form_abandoned', f.id);
      status = 'abandoned';
      abandonedAt = t;
      break;
    }
    t += 100 + Math.floor(rand() * 500);
    add('blur', f.id);
    if (!hadError || rand() < 0.7) { t += 1; add('field_completed', f.id); }
  }
  if (status === 'submitted') { t += 500 + Math.floor(rand() * 2000); add('form_submitted', null); }
  return { events, status, endedMs: status === 'abandoned' ? abandonedAt : t };
}

async function insertChunks(db, sql, rows, size = 4000) {
  for (let i = 0; i < rows.length; i += size) await db.query(sql, [rows.slice(i, i + size)]);
}

// Creates the demo admin (if needed), the demo form and `sessions` synthetic visits.
export async function seedDemo(db, { sessions = 5000, seed = 42, reset = false, now = new Date(), days = 30, email = DEMO_EMAIL } = {}) {
  let [[admin]] = await db.query('SELECT admin_id FROM admins WHERE email = ?', [email]);
  if (!admin) {
    admin = { admin_id: randomUUID() };
    const hash = await bcrypt.hash(DEMO_PASSWORD, Number(process.env.BCRYPT_ROUNDS) || 12);
    await db.query('INSERT INTO admins (admin_id, email, password_hash) VALUES (?, ?, ?)', [admin.admin_id, email, hash]);
  }
  if (reset) await deleteDemoForms(db, admin.admin_id);

  const formId = randomUUID();
  await db.query("INSERT INTO forms (form_id, admin_id, title, status, share_link, published_at) VALUES (?, ?, ?, 'published', ?, NOW())", [
    formId, admin.admin_id, DEMO_TITLE, `demo${randomUUID().replace(/-/g, '').slice(0, 12)}`,
  ]);
  const fields = FIELDS.map((f, i) => ({
    ...f,
    id: randomUUID(),
    validations: f.type === 'dropdown' ? { options: ['Tezpur', 'Guwahati', 'Delhi'] } : f.type === 'file' ? { maxFileSizeMB: 5 } : null,
    position: i,
  }));
  await insertChunks(db, 'INSERT INTO fields (field_id, form_id, field_type, label, is_required, position, validations) VALUES ?',
    fields.map((f) => [f.id, formId, f.type, f.label, f.required, f.position, f.validations && JSON.stringify(f.validations)]));

  const rand = makeRandom(seed);
  const sessionRows = [], eventRows = [], submissionRows = [];
  const counts = { submitted: 0, abandoned: 0, stale: 0 };
  for (let i = 0; i < sessions; i++) {
    // whole seconds, because sessions.started_at has no milliseconds (events do)
    const startedAt = new Date(Math.floor((now.getTime() - rand() * days * DAY) / 1000) * 1000);
    const sim = simulateSession(rand, startedAt, fields);
    let { status, events } = sim;
    // about 1 visit in 100 was simply left open: still "active" long after (stale, counted as abandoned)
    if (status === 'abandoned' && rand() < 0.04) {
      status = 'active';
      events = events.filter((e) => e.type !== 'form_abandoned');
      counts.stale++;
    } else counts[status]++;
    const sessionId = randomUUID();
    const ended = status === 'active' ? null : new Date(startedAt.getTime() + sim.endedMs);
    sessionRows.push([sessionId, formId, startedAt, ended, status, Math.floor(rand() * 1e15).toString(16).padStart(64, '0')]);
    for (const e of events) {
      eventRows.push([randomUUID(), sessionId, e.field, formId, e.type, new Date(startedAt.getTime() + e.ms), e.metadata && JSON.stringify(e.metadata)]);
    }
    if (status === 'submitted') submissionRows.push([randomUUID(), sessionId, formId, ended]);
  }
  await insertChunks(db, 'INSERT INTO sessions (session_id, form_id, started_at, ended_at, status, ip_hash) VALUES ?', sessionRows);
  await insertChunks(db, 'INSERT INTO events (event_id, session_id, field_id, form_id, event_type, timestamp, metadata) VALUES ?', eventRows);
  await insertChunks(db, 'INSERT INTO submissions (submission_id, session_id, form_id, submitted_at) VALUES ?', submissionRows);

  return { adminId: admin.admin_id, formId, fields: fields.map((f) => ({ field_id: f.id, label: f.label })), sessions, events: eventRows.length, ...counts };
}

// Run from the command line: `npm run seed`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { default: pool } = await import('../db/connection.js');
  const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? Number(process.argv[i + 1]) : fallback; };
  const started = Date.now();
  const r = await seedDemo(pool, { sessions: arg('sessions', 5000), seed: arg('seed', 42), reset: process.argv.includes('--reset') });
  console.log(`Seeded ${r.sessions} sessions and ${r.events} events in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  console.log(`  submitted ${r.submitted}, abandoned ${r.abandoned}, left open (stale) ${r.stale}`);
  console.log(`  form id: ${r.formId}`);
  console.log(`  log in as ${DEMO_EMAIL} / ${DEMO_PASSWORD} to see it`);
  await pool.end();
}
