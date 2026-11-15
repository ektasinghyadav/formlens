// modules/recommendEngine.js - turns the analytics numbers into plain advice. (FR-7.1, FR-7.2)
// Requirement NFR-5.1: a separate, PURE module. It never touches Express; the database is
// passed in, plain objects come out. No machine learning: a fixed list of rules and
// cut-off numbers (SRS 1.2), so every recommendation can be explained by pointing at a number.
//
// The rules (docs/SPEC.md section 10, decision D-21):
//   1 abandonment   many people leave the form AT this field        -> simplify it / make it optional
//   2 drop_before   many people leave right BEFORE this field        -> simplify this (next) field
//   3 error         many people hit a validation error here          -> clarify label / example / rule
//   4 correction    many people have to correct their answer here    -> add hints or format masks
//   5 time          people spend a long time here                    -> split / shorten / add help
// Each metric has three cut-offs (Low, Medium, High) from config/thresholds.js.
import { randomUUID } from 'node:crypto';
import defaultThresholds from '../config/thresholds.js';
import { getFunnel, getFieldMetrics } from './analyticsEngine.js';

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const RULE_ORDER = ['abandonment', 'drop_before', 'error', 'correction', 'time', 'not_enough_data'];

// The tier a value reaches ("at or above"), or null if it is below Low.
function tierOf(value, tiers) {
  if (value >= tiers.high) return 'high';
  if (value >= tiers.medium) return 'medium';
  if (value >= tiers.low) return 'low';
  return null;
}

const percent = (fraction) => `${Math.round(fraction * 100)}%`;
const seconds = (ms) => (ms / 1000).toFixed(1);

// Looks at every field's numbers and returns the recommendations, most important first.
// Input: { funnel, fields } exactly as returned by the analytics engine. Output items:
// { rule, priority, field_id, label, reason, suggestion }
export function flagFields({ funnel, fields }, thresholds = defaultThresholds) {
  const found = [];
  const min = thresholds.minSessions;
  const add = (rule, priority, field, reason, suggestion, order) => found.push({ rule, priority, field_id: field.field_id, label: field.label, reason, suggestion, order });

  fields.forEach((f, i) => {
    const step = funnel[i]; // same position = same field
    const label = f.label;

    // A field few people reached cannot be judged fairly: say so instead of guessing.
    if (step.reached > 0 && step.reached < min) {
      add('not_enough_data', 'low', f,
        `Only ${step.reached} session${step.reached === 1 ? '' : 's'} reached "${label}" so far.`,
        `Share the form with more people; at least ${min} sessions are needed before this field can be assessed.`, i);
    } else if (step.reached >= min) {
      let tier = tierOf(f.abandonment_rate, thresholds.abandonment);
      if (tier) add('abandonment', tier, f, `${percent(f.abandonment_rate)} of the sessions that reached "${label}" left the form there.`,
        'Simplify this field, make it optional, or reduce the effort it asks for.', i);

      tier = tierOf(f.error_rate, thresholds.error);
      if (tier) add('error', tier, f, `${percent(f.error_rate)} of the sessions that reached "${label}" hit a validation error.`,
        'Clarify the label, add an example or placeholder, or relax or explain the validation rule.', i);

      tier = tierOf(f.correction_rate, thresholds.correction);
      if (tier) add('correction', tier, f, `${percent(f.correction_rate)} of the sessions that reached "${label}" had to correct their answer.`,
        'Add input hints or format masks so people get it right the first time.', i);

      tier = tierOf(f.avg_time_ms, thresholds.time_ms);
      if (tier) add('time', tier, f, `People spend ${seconds(f.avg_time_ms)} seconds on "${label}" on average.`,
        'Split it, shorten it, or add help text. Check whether the field is needed at all.', i);
    }

    // Rule 2: people leave right BEFORE this field (the SRS example). The evidence is the
    // previous field's drop rate. It only counts when the previous field looks fine on its
    // own (few errors, not slow); otherwise that field is the likelier cause (rule 1 covers it).
    if (i > 0) {
      const prev = fields[i - 1];
      const prevStep = funnel[i - 1];
      const tier = tierOf(prevStep.drop_rate, thresholds.abandonment);
      const prevLooksFine = prev.error_rate < thresholds.error.medium && prev.avg_time_ms < thresholds.time_ms.medium;
      if (tier && prevLooksFine && prevStep.reached >= min) {
        add('drop_before', tier, f, `${percent(prevStep.drop_rate)} of the sessions that reached "${prev.label}" left before reaching "${label}".`,
          `Simplify "${label}": it may look too long or too hard from the previous step.`, i);
      }
    }
  });

  return found
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule) || a.order - b.order)
    .map(({ order, ...rest }) => rest); // `order` was only needed for sorting
}

// Reads the numbers for a form and date range from the analytics engine, applies the rules.
// Returns [{ priority, field_id, label, reason, suggestion }], High first.
export async function buildRecommendations(db, formId, { from = null, to = null, now = new Date(), thresholds = defaultThresholds } = {}) {
  const range = { from, to, now };
  const [funnel, fields] = await Promise.all([getFunnel(db, formId, range), getFieldMetrics(db, formId, range)]);
  return flagFields({ funnel, fields }, thresholds).map(({ rule, ...rec }) => rec);
}

// D-12: the saved list for a form is always the result of the latest run. Delete the old
// rows and insert the new ones in ONE transaction, so a failure never leaves half a list.
export async function saveRecommendations(db, formId, recommendations) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM recommendations WHERE form_id = ?', [formId]);
    for (const r of recommendations) {
      await conn.query(
        'INSERT INTO recommendations (rec_id, form_id, field_id, priority, reason, suggestion) VALUES (?, ?, ?, ?, ?, ?)',
        [randomUUID(), formId, r.field_id, r.priority, r.reason, r.suggestion]
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
