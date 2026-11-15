// modules/analyticsEngine.js - turns stored sessions and events into usability numbers.
// Requirements: FR-5.1 (summary), FR-5.2 (per-field metrics), FR-5.3 (funnel), NFR-1.2 (fast),
// NFR-5.1 (PURE module: no Express, no req/res; the database connection is passed in and
// plain objects come out, so it can be tested without a web server).
// Formulas: docs/SPEC.md section 10 and decisions D-3 / D-20.
//
// Approach: one indexed query fetches the field events of the sessions in the date range,
// then plain JavaScript walks through each session once and tallies the numbers. (We first
// tried doing it all with SQL window functions; on 5,000 sessions that took 4-6 seconds
// because MySQL had to sort and copy ~200,000 rows again and again. This is ~10x faster
// and easier to read.)
//
// Every function takes (db, formId, options) where options = { from, to, now }:
//   from / to : Date or null - only sessions that STARTED inside [from, to] count
//   now       : Date (default: the real time) - lets tests fix the clock for the 30-minute rule

const STALE_MS = 30 * 60 * 1000; // an "active" session older than this is treated as abandoned (D-5)

// Fraction rounded to 4 decimals; 0 (never NaN) when nothing to divide by.
const ratio = (part, whole) => (whole === 0 ? 0 : Math.round((part / whole) * 10000) / 10000);

// SQL pieces shared by the queries. `s` is always the sessions table.
function rangeClause({ from, to }) {
  const sql = [];
  const params = [];
  if (from) { sql.push('AND s.started_at >= ?'); params.push(from); }
  if (to) { sql.push('AND s.started_at <= ?'); params.push(to); }
  return { sql: sql.join(' '), params };
}

// The session's status, with stale "active" visits counted as abandoned.
function statusExpr(now) {
  return {
    sql: "(CASE WHEN s.status = 'active' AND s.started_at < ? THEN 'abandoned' ELSE s.status END)",
    param: new Date(now.getTime() - STALE_MS),
  };
}

// While a query is running, an identical request (same form, range and clock minute) waits for
// that same query instead of starting its own. The dashboard asks for the funnel, the field
// metrics and the recommendations at once, and the last one needs the first two again, so
// without this the same ~200,000 events would be loaded four times at the same moment.
// Nothing is kept afterwards (no cache), so a later request always sees fresh data.
const running = new Map();
function shareWhileRunning(key, work) {
  if (!running.has(key)) running.set(key, work().finally(() => running.delete(key)));
  return running.get(key);
}
const sharedKey = (kind, formId, { from, to, now }, extra = '') =>
  JSON.stringify([kind, formId, from?.getTime() ?? null, to?.getTime() ?? null, Math.floor(now.getTime() / 60000), extra]);

const fieldsOf = async (db, formId) =>
  (await db.query('SELECT field_id, label, position FROM fields WHERE form_id = ? ORDER BY position', [formId]))[0];

// Status of every session in the range: Map(session_id -> 'submitted' | 'abandoned' | 'active')
function loadStatuses(db, formId, range) {
  return shareWhileRunning(sharedKey('statuses', formId, range), () => queryStatuses(db, formId, range));
}
async function queryStatuses(db, formId, { from, to, now }) {
  const status = statusExpr(now);
  const range = rangeClause({ from, to });
  const [rows] = await db.query(
    `SELECT s.session_id, ${status.sql} AS status FROM sessions s WHERE s.form_id = ? ${range.sql}`,
    [status.param, formId, ...range.params]
  );
  return new Map(rows.map((r) => [r.session_id, r.status]));
}

// The field-level events of the sessions in the range, grouped by session and in time order:
// Map(session_id -> [{ field_id, type, time(ms) }]).
function loadEventsBySession(db, formId, range, types) {
  return shareWhileRunning(sharedKey('events', formId, range, types.join()), () => queryEvents(db, formId, range, types));
}
async function queryEvents(db, formId, { from, to }, types) {
  const range = rangeClause({ from, to });
  const [rows] = await db.query(
    `SELECT e.session_id, e.field_id, e.event_type, e.timestamp
     FROM sessions s JOIN events e ON e.session_id = s.session_id
     WHERE s.form_id = ? ${range.sql} AND e.field_id IS NOT NULL AND e.event_type IN (?)
     ORDER BY e.session_id, e.timestamp, e.event_id`,
    [formId, ...range.params, types]
  );
  const bySession = new Map();
  for (const r of rows) {
    if (!bySession.has(r.session_id)) bySession.set(r.session_id, []);
    bySession.get(r.session_id).push({ field_id: r.field_id, type: r.event_type, time: r.timestamp.getTime() });
  }
  // Events in the same millisecond have no natural order. Fix one: a focus comes before a
  // blur; anything still tied keeps the database's order (by event id), because JavaScript's
  // sort is stable. So the answer never changes between runs.
  const rank = { focus: 0, blur: 1 };
  for (const list of bySession.values()) {
    list.sort((a, b) => a.time - b.time || (rank[a.type] ?? 2) - (rank[b.type] ?? 2));
  }
  return bySession;
}

// Reads ONE session's events and works out what happened in it.
function analyseSession(events, positionOf) {
  const focused = new Set(), errored = new Set(), corrected = new Set();
  const spent = new Map(); // field -> total ms between a focus and the blur right after it
  const openSince = new Map(); // field -> time of a focus still waiting for its blur
  let furthest = -1; // position of the furthest field focused
  let lastFocus = null; // field focused most recently (where the person was when they left)

  for (const e of events) {
    if (e.type === 'focus') {
      focused.add(e.field_id);
      openSince.set(e.field_id, e.time); // a second focus without a blur replaces the first
      furthest = Math.max(furthest, positionOf.get(e.field_id) ?? -1);
      lastFocus = e.field_id;
    } else if (e.type === 'blur') {
      if (openSince.has(e.field_id)) {
        spent.set(e.field_id, (spent.get(e.field_id) ?? 0) + (e.time - openSince.get(e.field_id)));
        openSince.delete(e.field_id);
      } // a blur with no focus before it is ignored; a focus that never gets a blur is ignored too
    } else if (e.type === 'error') errored.add(e.field_id);
    else if (e.type === 'correction') corrected.add(e.field_id);
  }
  return { focused, errored, corrected, spent, furthest, lastFocus };
}

// FR-5.1: { views, completions, abandonments, completion_rate }
export async function getSummary(db, formId, { from = null, to = null, now = new Date() } = {}) {
  const status = statusExpr(now);
  const range = rangeClause({ from, to });
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS views,
            COALESCE(SUM(x.st = 'submitted'), 0) AS completions,
            COALESCE(SUM(x.st = 'abandoned'), 0) AS abandonments
     FROM (SELECT ${status.sql} AS st FROM sessions s WHERE s.form_id = ? ${range.sql}) x`,
    [status.param, formId, ...range.params]
  );
  const views = Number(row.views);
  const completions = Number(row.completions);
  return { views, completions, abandonments: Number(row.abandonments), completion_rate: ratio(completions, views) };
}

// FR-5.3: [{ field_id, label, reached, dropped, drop_rate }] in form order
export async function getFunnel(db, formId, { from = null, to = null, now = new Date() } = {}) {
  const range = { from, to, now };
  const [fields, statuses, events] = await Promise.all([
    fieldsOf(db, formId), loadStatuses(db, formId, range), loadEventsBySession(db, formId, range, ['focus']),
  ]);
  const positionOf = new Map(fields.map((f) => [f.field_id, f.position]));
  const reached = new Map(fields.map((f) => [f.field_id, 0]));
  const dropped = new Map(fields.map((f) => [f.field_id, 0]));

  for (const [sessionId, list] of events) {
    const s = analyseSession(list, positionOf);
    for (const f of fields) if (s.furthest >= f.position) reached.set(f.field_id, reached.get(f.field_id) + 1);
    if (statuses.get(sessionId) === 'abandoned' && dropped.has(s.lastFocus)) dropped.set(s.lastFocus, dropped.get(s.lastFocus) + 1);
  }
  return fields.map((f) => ({
    field_id: f.field_id,
    label: f.label,
    reached: reached.get(f.field_id),
    dropped: dropped.get(f.field_id),
    drop_rate: ratio(dropped.get(f.field_id), reached.get(f.field_id)),
  }));
}

// FR-5.2 (+ abandonment per field for FR-5.3):
// [{ field_id, label, avg_time_ms, error_rate, correction_rate, abandonment_rate }] in form order
export async function getFieldMetrics(db, formId, { from = null, to = null, now = new Date() } = {}) {
  const range = { from, to, now };
  const [fields, statuses, events] = await Promise.all([
    fieldsOf(db, formId), loadStatuses(db, formId, range),
    loadEventsBySession(db, formId, range, ['focus', 'blur', 'error', 'correction']),
  ]);
  const positionOf = new Map(fields.map((f) => [f.field_id, f.position]));
  const tally = new Map(fields.map((f) => [f.field_id, { focused: 0, errored: 0, corrected: 0, abandoned: 0, timeSum: 0, timeN: 0 }]));

  for (const [sessionId, list] of events) {
    const s = analyseSession(list, positionOf);
    for (const fieldId of s.focused) {
      const t = tally.get(fieldId);
      if (!t) continue;
      t.focused++;
      if (s.errored.has(fieldId)) t.errored++; // only sessions that focused the field count (D-20c)
      if (s.corrected.has(fieldId)) t.corrected++;
      if (s.spent.has(fieldId)) { t.timeSum += s.spent.get(fieldId); t.timeN++; }
    }
    if (statuses.get(sessionId) === 'abandoned' && tally.has(s.lastFocus)) tally.get(s.lastFocus).abandoned++;
  }
  return fields.map((f) => {
    const t = tally.get(f.field_id);
    return {
      field_id: f.field_id,
      label: f.label,
      avg_time_ms: t.timeN ? Math.round(t.timeSum / t.timeN) : 0,
      error_rate: ratio(t.errored, t.focused),
      correction_rate: ratio(t.corrected, t.focused),
      abandonment_rate: ratio(t.abandoned, t.focused),
    };
  });
}
