// recommendEngine unit tests. Requirements: FR-7.1, FR-7.2, NFR-5.1. (Sprint 6)
// Written BEFORE the engine. flagFields works on plain numbers, so most tests need no database.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { flagFields } from '../modules/recommendEngine.js';
import { DEFAULT_THRESHOLDS as T } from '../config/thresholds.js';

// A field with "healthy" numbers unless a test overrides them.
function field(label, over = {}) {
  const f = { reached: 100, drop_rate: 0, avg_time_ms: 5000, error_rate: 0, correction_rate: 0, abandonment_rate: 0, ...over };
  return { label, field_id: `id-${label}`, ...f };
}
// Builds the {funnel, fields} input from a list of fields in form order.
function metrics(...list) {
  return {
    funnel: list.map((f) => ({ field_id: f.field_id, label: f.label, reached: f.reached, dropped: 0, drop_rate: f.drop_rate })),
    fields: list.map((f) => ({ field_id: f.field_id, label: f.label, avg_time_ms: f.avg_time_ms, error_rate: f.error_rate, correction_rate: f.correction_rate, abandonment_rate: f.abandonment_rate })),
  };
}
const flags = (list, thresholds = T) => flagFields(metrics(...list), thresholds);
const one = (over) => flags([field('X', over)]);

describe('rules fire exactly at each tier boundary (FR-7.1)', () => {
  const cases = [
    ['abandonment_rate', 'abandonment', 'abandonment', (v) => v],
    ['error_rate', 'error', 'error', (v) => v],
    ['correction_rate', 'correction', 'correction', (v) => v],
    ['avg_time_ms', 'time_ms', 'time', (v) => v],
  ];
  for (const [key, group, rule] of cases) {
    it(`${rule}: Low / Medium / High at the threshold, and nothing just below Low`, () => {
      for (const tier of ['low', 'medium', 'high']) {
        const atTier = one({ [key]: T[group][tier] });
        expect(atTier.filter((r) => r.rule === rule).map((r) => r.priority)).toEqual([tier]); // exactly at the line: flagged
      }
      const below = one({ [key]: T[group].low * 0.999 });
      expect(below.filter((r) => r.rule === rule)).toEqual([]);
      const justBelowHigh = one({ [key]: T[group].high * 0.999 });
      expect(justBelowHigh.find((r) => r.rule === rule).priority).toBe('medium');
    });
  }

  it('a healthy field produces no recommendations', () => {
    expect(one({})).toEqual([]);
  });
});

describe('what a recommendation contains (FR-7.2)', () => {
  it('has priority, field id, label, a reason that quotes the real number, and a suggestion', () => {
    const [r] = flags([field('Resume', { abandonment_rate: 0.38 })]);
    expect(r).toMatchObject({ priority: 'high', field_id: 'id-Resume', label: 'Resume', rule: 'abandonment' });
    expect(r.reason).toBe('38% of the sessions that reached "Resume" left the form there.');
    expect(r.suggestion).toMatch(/simplif|optional/i);
  });

  it('quotes error, correction and time numbers in plain words', () => {
    const r = Object.fromEntries(one({ error_rate: 0.42, correction_rate: 0.25, avg_time_ms: 45200 }).map((x) => [x.rule, x]));
    expect(r.error.reason).toContain('42%');
    expect(r.error.suggestion).toMatch(/label|example|validation/i);
    expect(r.correction.reason).toContain('25%');
    expect(r.correction.suggestion).toMatch(/hint|mask/i);
    expect(r.time.reason).toContain('45.2 seconds');
    expect(r.time.suggestion).toMatch(/split|shorten|help text/i);
  });

  it('can give one field several recommendations, one per rule hit', () => {
    const rules = one({ error_rate: 0.5, correction_rate: 0.4, abandonment_rate: 0.35 }).map((r) => r.rule);
    expect(rules).toEqual(['abandonment', 'error', 'correction']);
  });
});

describe('ordering', () => {
  it('sorts High, then Medium, then Low; ties by rule order (abandonment first), then field order', () => {
    const list = flags([
      field('A', { error_rate: 0.12 }),                         // low error
      field('B', { error_rate: 0.45, abandonment_rate: 0.31 }), // high error + high abandonment
      field('C', { avg_time_ms: 25000 }),                       // medium time
      field('D', { abandonment_rate: 0.9 }),                    // high abandonment
    ]);
    expect(list.map((r) => `${r.priority}:${r.rule}:${r.label}`)).toEqual([
      'high:abandonment:B', 'high:abandonment:D', 'high:error:B', 'medium:time:C', 'low:error:A',
    ]);
  });
});

describe('minimum sessions (too little data)', () => {
  it('does not judge a field reached by fewer than the minimum; adds one Low "not enough data" note instead', () => {
    const list = flags([field('Few', { reached: 4, abandonment_rate: 1, error_rate: 1, avg_time_ms: 999999 })]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ priority: 'low', rule: 'not_enough_data', field_id: 'id-Few' });
    expect(list[0].reason).toBe('Only 4 sessions reached "Few" so far.');
    expect(list[0].suggestion).toMatch(/at least 5/);
  });

  it('judges a field reached by exactly the minimum, says "1 session" correctly, and ignores a field nobody reached', () => {
    expect(flags([field('Edge', { reached: 5, abandonment_rate: 0.5 })]).map((r) => r.rule)).toEqual(['abandonment']);
    expect(flags([field('One', { reached: 1 })])[0].reason).toBe('Only 1 session reached "One" so far.');
    expect(flags([field('None', { reached: 0, abandonment_rate: 0.9 })])).toEqual([]);
  });
});

describe('rule 2: high drop immediately before a field -> simplify THAT (next) field (the SRS example)', () => {
  it('flags the field AFTER the drop when the previous field looks fine by itself', () => {
    const list = flags([field('Phone', { drop_rate: 0.35 }), field('Resume')]);
    const r = list.find((x) => x.rule === 'drop_before');
    expect(r).toMatchObject({ priority: 'high', field_id: 'id-Resume', label: 'Resume' });
    expect(r.reason).toBe('35% of the sessions that reached "Phone" left before reaching "Resume".');
    expect(r.suggestion).toContain('Simplify "Resume"');
  });

  it('uses the same tiers as abandonment', () => {
    const tiers = [0.08, 0.15, 0.30].map((v) => flags([field('P', { drop_rate: v }), field('N')]).find((x) => x.rule === 'drop_before').priority);
    expect(tiers).toEqual(['low', 'medium', 'high']);
  });

  it('does not fire when the previous field is itself the problem (high errors or slow)', () => {
    expect(flags([field('P', { drop_rate: 0.5, error_rate: 0.25 }), field('N')]).some((x) => x.rule === 'drop_before')).toBe(false);
    expect(flags([field('P', { drop_rate: 0.5, avg_time_ms: 21000 }), field('N')]).some((x) => x.rule === 'drop_before')).toBe(false);
  });

  it('never fires for the first field, and needs enough sessions on the previous field', () => {
    expect(flags([field('First', { drop_rate: 0.9 })]).some((x) => x.rule === 'drop_before')).toBe(false);
    expect(flags([field('P', { drop_rate: 0.9, reached: 3 }), field('N')]).some((x) => x.rule === 'drop_before')).toBe(false);
  });
});

describe('thresholds are configurable (FR-7.1)', () => {
  it('changing a threshold changes the result', () => {
    const f = { abandonment_rate: 0.2 };
    expect(one(f)[0].priority).toBe('medium'); // 20% with the defaults
    const stricter = { ...T, abandonment: { low: 0.05, medium: 0.1, high: 0.15 } };
    expect(flags([field('X', f)], stricter)[0].priority).toBe('high');
    const looser = { ...T, abandonment: { low: 0.3, medium: 0.4, high: 0.5 } };
    expect(flags([field('X', f)], looser)).toEqual([]);
  });

  it('the minimum-sessions number is configurable too', () => {
    expect(flags([field('X', { reached: 8, abandonment_rate: 0.5 })], { ...T, minSessions: 10 })[0].rule).toBe('not_enough_data');
  });
});

describe('edge cases and module boundary (NFR-5.1)', () => {
  it('handles a form with no fields', () => {
    expect(flagFields({ funnel: [], fields: [] }, T)).toEqual([]);
  });

  it('recommendEngine.js uses no Express, request or response objects', () => {
    const src = readFileSync(new URL('../modules/recommendEngine.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from\s+['"]express['"]|\breq\.|\bres\.|import\s+pool|db\/connection/);
  });
});
