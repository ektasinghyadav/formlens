// dashboardData.js - small plain helpers for the dashboard (no React). Requirements: FR-6.1, FR-6.2.

export const PRESETS = [
  { id: 'all', label: 'All time', days: null },
  { id: '7', label: 'Last 7 days', days: 7 },
  { id: '30', label: 'Last 30 days', days: 30 },
  { id: '90', label: 'Last 90 days', days: 90 },
];

// "2026-11-16" (UTC). The server reads dates as UTC too, so the two always agree.
export const ymd = (date) => date.toISOString().slice(0, 10);

// The range for a preset: from N days ago up to and including today. All time = no limits.
export function presetRange(days, now = new Date()) {
  if (!days) return { from: '', to: '' };
  return { from: ymd(new Date(now.getTime() - days * 24 * 60 * 60 * 1000)), to: ymd(now) };
}

// Returns '' when the range is fine, otherwise a message for the admin.
export function rangeProblem({ from, to }) {
  if (from && to && from > to) return 'The "From" date must not be after the "To" date.';
  return '';
}

// Keeps the biggest `max` slices and folds the rest into one "Other" slice.
// Slices with a value of 0 are dropped. (Never more than max + 1 colours on a donut.)
export function foldOther(items, max = 7) {
  const real = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  if (real.length <= max) return real;
  const rest = real.slice(max).reduce((sum, i) => sum + i.value, 0);
  return [...real.slice(0, max), { name: 'Other', value: rest, other: true }];
}

// Which of the funnel's 5 ramp steps a stage uses: spread evenly from first to last;
// with more than 5 stages neighbours share a step (each bar is also labelled directly).
export function rampStep(index, count, steps = 5) {
  return count <= 1 ? 0 : Math.round((index * (steps - 1)) / (count - 1));
}

export const percent = (fraction) => `${Math.round(fraction * 100)}%`;
export const percentOne = (fraction) => `${(fraction * 100).toFixed(1)}%`;
export const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;
