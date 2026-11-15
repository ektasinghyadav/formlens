// config/thresholds.js - the cut-off numbers the recommendation engine uses. (FR-7.1 "configurable")
// A field is flagged when a metric is AT OR ABOVE a tier: Low, Medium or High (higher = worse).
// Change a number here (or set an environment variable) and the recommendations change.
// Starting values: docs/SPEC.md section 10 (Medium and High) and decision D-21 (Low, correction).
//
// Environment override, for any value:  THRESHOLD_<METRIC>_<TIER>
//   e.g.  THRESHOLD_ABANDONMENT_HIGH=0.25     THRESHOLD_TIME_MS_MEDIUM=15000     THRESHOLD_MIN_SESSIONS=10

export const DEFAULT_THRESHOLDS = {
  abandonment: { low: 0.08, medium: 0.15, high: 0.30 }, // share of sessions that left at the field (0-1)
  error: { low: 0.10, medium: 0.20, high: 0.40 },       // share of sessions with a validation error
  correction: { low: 0.10, medium: 0.20, high: 0.35 },  // share of sessions that had to correct an answer
  time_ms: { low: 12000, medium: 20000, high: 40000 },  // average milliseconds spent on the field
  minSessions: 5, // a field reached by fewer sessions than this is not judged (too little data)
};

function readNumber(env, name, fallback) {
  if (env[name] === undefined || env[name] === '') return fallback;
  const value = Number(env[name]);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number, got "${env[name]}"`);
  return value;
}

// Builds the thresholds from the defaults plus any environment overrides.
// Takes `env` as a parameter so tests can try different settings.
export function loadThresholds(env = process.env) {
  const out = { minSessions: readNumber(env, 'THRESHOLD_MIN_SESSIONS', DEFAULT_THRESHOLDS.minSessions) };
  for (const metric of ['abandonment', 'error', 'correction', 'time_ms']) {
    out[metric] = {};
    for (const tier of ['low', 'medium', 'high']) {
      out[metric][tier] = readNumber(env, `THRESHOLD_${metric.toUpperCase()}_${tier.toUpperCase()}`, DEFAULT_THRESHOLDS[metric][tier]);
    }
    const { low, medium, high } = out[metric];
    if (!(low <= medium && medium <= high)) throw new Error(`${metric} thresholds must satisfy low <= medium <= high`);
  }
  return out;
}

export default loadThresholds();
