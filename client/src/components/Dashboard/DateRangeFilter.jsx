// DateRangeFilter.jsx - FR-6.2: filter the whole dashboard by date range.
// Preset buttons plus two date boxes. Every change here makes the dashboard refetch.
import { PRESETS, presetRange } from './dashboardData.js';

export default function DateRangeFilter({ range, onChange, problem }) {
  // a preset button is "pressed" while the dates match it
  const active = PRESETS.find((p) => {
    const r = presetRange(p.days);
    return r.from === range.from && r.to === range.to;
  })?.id;

  return (
    <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Date range">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" className="viz-button" aria-pressed={active === p.id} onClick={() => onChange(presetRange(p.days))}>
            {p.label}
          </button>
        ))}
      </div>
      <div>
        <label htmlFor="range-from" className="block text-xs viz-muted">From</label>
        <input id="range-from" type="date" className="viz-input" value={range.from} max={range.to || undefined}
          onChange={(e) => onChange({ ...range, from: e.target.value })} />
      </div>
      <div>
        <label htmlFor="range-to" className="block text-xs viz-muted">To</label>
        <input id="range-to" type="date" className="viz-input" value={range.to} min={range.from || undefined}
          onChange={(e) => onChange({ ...range, to: e.target.value })} />
      </div>
      {problem && <p role="alert" className="text-sm font-medium">Error: {problem}</p>}
    </div>
  );
}
