// Unit tests for the dashboard helpers. Requirements: FR-6.1, FR-6.2. (Sprint 7)
import { describe, it, expect } from 'vitest';
import { presetRange, rangeProblem, foldOther, rampStep, percent, percentOne, seconds, ymd } from '../components/Dashboard/dashboardData.js';

const NOW = new Date('2026-11-16T15:30:00Z');

describe('presetRange', () => {
  it('"all time" has no limits', () => {
    expect(presetRange(null, NOW)).toEqual({ from: '', to: '' });
  });
  it('"last 7 days" runs from 7 days ago to today (UTC dates)', () => {
    expect(presetRange(7, NOW)).toEqual({ from: '2026-11-09', to: '2026-11-16' });
    expect(presetRange(30, NOW)).toEqual({ from: '2026-10-17', to: '2026-11-16' });
  });
  it('formats dates as UTC', () => {
    expect(ymd(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01');
  });
});

describe('rangeProblem', () => {
  it('accepts empty, one-sided, equal and ordered ranges', () => {
    for (const r of [{ from: '', to: '' }, { from: '2026-11-01', to: '' }, { from: '', to: '2026-11-01' }, { from: '2026-11-01', to: '2026-11-01' }, { from: '2026-11-01', to: '2026-11-02' }]) {
      expect(rangeProblem(r)).toBe('');
    }
  });
  it('rejects From after To', () => {
    expect(rangeProblem({ from: '2026-11-05', to: '2026-11-01' })).toMatch(/must not be after/);
  });
});

describe('foldOther', () => {
  const items = (...values) => values.map((value, i) => ({ name: `f${i}`, value }));
  it('drops zero slices and sorts biggest first', () => {
    expect(foldOther(items(0, 5, 9, 0)).map((i) => i.value)).toEqual([9, 5]);
  });
  it('folds everything past the limit into one "Other" slice that keeps the total', () => {
    const r = foldOther(items(1, 2, 3, 4, 5, 6, 7, 8, 9, 10), 7);
    expect(r).toHaveLength(8);
    expect(r.at(-1)).toEqual({ name: 'Other', value: 1 + 2 + 3, other: true });
    expect(r.reduce((s, i) => s + i.value, 0)).toBe(55);
  });
  it('does not fold when there are exactly max slices; empty in, empty out', () => {
    expect(foldOther(items(1, 2, 3), 3)).toHaveLength(3);
    expect(foldOther([])).toEqual([]);
  });
});

describe('rampStep', () => {
  it('spreads up to 5 stages across the ramp, and groups neighbours beyond that', () => {
    expect([0, 1, 2].map((i) => rampStep(i, 3))).toEqual([0, 2, 4]);
    expect([0, 1, 2, 3, 4].map((i) => rampStep(i, 5))).toEqual([0, 1, 2, 3, 4]);
    const many = Array.from({ length: 12 }, (_, i) => rampStep(i, 12));
    expect(many[0]).toBe(0);
    expect(many[11]).toBe(4);
    expect(many).toEqual([...many].sort((a, b) => a - b)); // never goes backwards
    expect(rampStep(0, 1)).toBe(0);
  });
});

describe('formatting', () => {
  it('formats rates and times', () => {
    expect(percent(0.3333)).toBe('33%');
    expect(percentOne(0.6494)).toBe('64.9%');
    expect(percentOne(0)).toBe('0.0%');
    expect(seconds(44916)).toBe('44.9 s');
    expect(seconds(0)).toBe('0.0 s');
  });
});
