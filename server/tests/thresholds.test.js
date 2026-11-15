// Threshold configuration tests. Requirement: FR-7.1 ("configurable threshold"). (Sprint 6)
import { describe, it, expect } from 'vitest';
import defaults, { loadThresholds, DEFAULT_THRESHOLDS } from '../config/thresholds.js';

describe('loadThresholds', () => {
  it('uses the SPEC section 10 values for Medium and High', () => {
    expect(DEFAULT_THRESHOLDS.abandonment).toMatchObject({ medium: 0.15, high: 0.30 });
    expect(DEFAULT_THRESHOLDS.error).toMatchObject({ medium: 0.20, high: 0.40 });
    expect(DEFAULT_THRESHOLDS.time_ms).toMatchObject({ medium: 20000, high: 40000 });
    expect(DEFAULT_THRESHOLDS.minSessions).toBe(5);
    expect(defaults).toEqual(loadThresholds({})); // the module's default export = no overrides
  });

  it('lets an environment variable change one value and leaves the rest alone', () => {
    const t = loadThresholds({ THRESHOLD_ABANDONMENT_HIGH: '0.5', THRESHOLD_MIN_SESSIONS: '10', THRESHOLD_TIME_MS_LOW: '5000' });
    expect(t.abandonment).toEqual({ low: 0.08, medium: 0.15, high: 0.5 });
    expect(t.minSessions).toBe(10);
    expect(t.time_ms.low).toBe(5000);
    expect(t.error).toEqual(DEFAULT_THRESHOLDS.error);
  });

  it.each([
    ['not a number', { THRESHOLD_ERROR_HIGH: 'lots' }],
    ['zero or negative', { THRESHOLD_ERROR_HIGH: '0' }],
    ['tiers out of order', { THRESHOLD_ERROR_LOW: '0.9' }],
  ])('stops with a clear message for %s', (name, env) => {
    expect(() => loadThresholds(env)).toThrow(/THRESHOLD_|low <= medium/);
  });
});
