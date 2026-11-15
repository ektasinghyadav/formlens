// scripts/loadTest.js - simulates many respondents using one form AT THE SAME TIME.
// Requirements: NFR-2.1 (no loss of acknowledged events), SRS 2.4 (a demo of 50 concurrent
// respondents). Each simulated person does what a real browser does: open the public form,
// start a session, send batches of events shaped exactly like the tracker's, then either submit
// or leave (form_abandoned). The script counts every event the server ACKNOWLEDGED (HTTP 202)
// and then checks that every one of them is really in the database.
// Usage:  npm run loadtest                       (50 respondents against http://localhost:3000)
//         npm run loadtest -- --respondents 200 --url http://localhost:3000
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(baseUrl, method, path, { token, body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// A throwaway admin with one published 4-field form, made through the real API.
export async function createLoadForm(baseUrl) {
  const email = `loadtest-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
  await call(baseUrl, 'POST', '/auth/register', { body: { email, password: 'load-test-password' } });
  const { body: { token } } = await call(baseUrl, 'POST', '/auth/login', { body: { email, password: 'load-test-password' } });
  const { body: { form_id: formId } } = await call(baseUrl, 'POST', '/forms', {
    token,
    body: {
      title: 'Load test form',
      fields: [
        { field_type: 'text', label: 'Name', is_required: true },
        { field_type: 'email', label: 'Email' },
        { field_type: 'number', label: 'Age' },
        { field_type: 'dropdown', label: 'City', validations: { options: ['Tezpur', 'Guwahati'] } },
      ],
    },
  });
  const { body: pub } = await call(baseUrl, 'PATCH', `/forms/${formId}/publish`, { token });
  return { email, token, formId, shareLink: pub.share_link };
}

// One person's visit. Returns what the server acknowledged, so the caller can verify it.
async function oneRespondent(baseUrl, form, index) {
  const problems = [];
  const expect = (res, ok, what) => { if (!ok.includes(res.status)) problems.push(`${what}: HTTP ${res.status}`); return res; };

  await sleep(Math.random() * 300); // people do not all arrive in the same millisecond
  const page = expect(await call(baseUrl, 'GET', `/forms/${form.shareLink}/public`), [200], 'open form');
  const fields = page.body?.fields ?? [];
  const session = expect(await call(baseUrl, 'POST', '/sessions', { body: { form_id: form.formId } }), [201], 'start session');
  const sessionId = session.body?.session_id;
  if (!sessionId) return { problems, acknowledged: 0, outcome: 'failed' };

  // Build the events like the tracker would, with believable timestamps (a few seconds ago).
  let t = Date.now() - 20000;
  const events = [];
  const add = (type, fieldId = null, metadata = null) => { t += 50 + Math.floor(Math.random() * 400); events.push({ event_id: randomUUID(), session_id: sessionId, form_id: form.formId, field_id: fieldId, event_type: type, timestamp: new Date(t).toISOString(), metadata }); };
  add('form_opened');
  const willSubmit = index % 10 < 7; // about 70% finish
  const stopAt = willSubmit ? fields.length : Math.floor(Math.random() * fields.length);
  for (const [i, f] of fields.entries()) {
    if (i === stopAt && !willSubmit) break;
    add('focus', f.field_id);
    for (let k = 1; k <= 4; k++) add('input', f.field_id, { chars: k * 3 });
    if (Math.random() < 0.2) { add('error', f.field_id); add('correction', f.field_id); }
    add('blur', f.field_id);
    add('field_completed', f.field_id);
  }
  if (!willSubmit) add('form_abandoned', fields[Math.min(stopAt, fields.length - 1)]?.field_id ?? null);

  // Send in batches of at most 100, like the tracker, spread over a short time.
  let acknowledged = 0;
  for (let i = 0; i < events.length; i += 100) {
    const res = expect(await call(baseUrl, 'POST', '/events/batch', { body: { events: events.slice(i, i + 100) } }), [202], 'send events');
    if (res.status === 202) acknowledged += res.body.accepted;
    await sleep(Math.random() * 100);
  }

  if (willSubmit) {
    const answers = { Name: 'Load Test', Email: 'load@example.com', Age: '30', City: 'Tezpur' };
    const responses = fields.map((f) => ({ field_id: f.field_id, value: answers[f.label] }));
    expect(await call(baseUrl, 'POST', `/forms/${form.formId}/submit`, { body: { session_id: sessionId, responses } }), [201], 'submit');
  }
  return { problems, acknowledged, outcome: willSubmit ? 'submitted' : 'abandoned', sessionId };
}

// Runs `respondents` visits at the same time and totals what happened.
export async function simulateRespondents({ baseUrl, form, respondents = 50 }) {
  const started = Date.now();
  const results = await Promise.all(Array.from({ length: respondents }, (_, i) => oneRespondent(baseUrl, form, i)));
  return {
    respondents,
    seconds: (Date.now() - started) / 1000,
    acknowledged: results.reduce((sum, r) => sum + r.acknowledged, 0),
    submitted: results.filter((r) => r.outcome === 'submitted').length,
    abandoned: results.filter((r) => r.outcome === 'abandoned').length,
    problems: results.flatMap((r) => r.problems),
    sessionIds: results.map((r) => r.sessionId).filter(Boolean),
  };
}

// Checks the database against what the server acknowledged. Returns plain numbers.
export async function verifyStored(db, form, run) {
  const ids = run.sessionIds;
  // events are saved just AFTER the 202 reply, so wait (up to 15 s) for the last ones
  const expectedEvents = run.acknowledged + run.submitted; // + one server-written form_submitted per submit
  let stored = 0;
  for (let i = 0; i < 75; i++) {
    [[{ n: stored }]] = await db.query('SELECT COUNT(*) AS n FROM events WHERE form_id = ?', [form.formId]);
    if (stored >= expectedEvents) break;
    await sleep(200);
  }
  const [[{ distinct_ids: distinct }]] = await db.query('SELECT COUNT(DISTINCT event_id) AS distinct_ids FROM events WHERE form_id = ?', [form.formId]);
  const [statuses] = await db.query('SELECT status, COUNT(*) AS n FROM sessions WHERE form_id = ? GROUP BY status', [form.formId]);
  const [[{ subs }]] = await db.query('SELECT COUNT(*) AS subs FROM submissions WHERE form_id = ?', [form.formId]);
  const [[{ submittedEvents }]] = await db.query("SELECT COUNT(*) AS submittedEvents FROM events WHERE form_id = ? AND event_type = 'form_submitted'", [form.formId]);
  return {
    sessions: ids.length, expectedEvents, stored, distinct,
    byStatus: Object.fromEntries(statuses.map((s) => [s.status, s.n])), submissions: subs, submittedEvents,
  };
}

// Run from the command line: `npm run loadtest`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : fallback; };
  const baseUrl = `${arg('url', 'http://localhost:3000')}/api/v1`;
  const respondents = Number(arg('respondents', 50));
  const { default: pool } = await import('../db/connection.js');
  const { wipeAdminsByEmail } = await import('../tests/helpers/loadCleanup.js');
  const form = await createLoadForm(baseUrl);
  try {
    console.log(`Simulating ${respondents} respondents at the same time on ${baseUrl} ...`);
    const run = await simulateRespondents({ baseUrl, form, respondents });
    const db = await verifyStored(pool, form, run);
    console.log(`  finished in ${run.seconds.toFixed(1)} s: ${run.submitted} submitted, ${run.abandoned} abandoned`);
    console.log(`  HTTP problems: ${run.problems.length}${run.problems.length ? ' -> ' + run.problems.slice(0, 5).join('; ') : ''}`);
    console.log(`  events acknowledged (202): ${run.acknowledged} + ${run.submitted} server-written form_submitted = ${db.expectedEvents} expected`);
    console.log(`  events found in the database: ${db.stored} (${db.distinct} distinct ids)`);
    console.log(`  sessions by status: ${JSON.stringify(db.byStatus)}; submissions: ${db.submissions}`);
    const ok = run.problems.length === 0 && db.stored === db.expectedEvents && db.distinct === db.stored && db.submissions === run.submitted;
    console.log(ok ? 'RESULT: OK - no errors, no lost and no duplicated events.' : 'RESULT: PROBLEM - see the numbers above.');
    process.exitCode = ok ? 0 : 1;
  } finally {
    await wipeAdminsByEmail(pool, form.email);
    await pool.end();
  }
}
