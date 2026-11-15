// AbandonmentDonut.jsx - FR-6.1: where people gave up, as a donut with a legend that shows
// the numbers. Fields get categorical colours in a fixed order (never cycled); beyond 7
// fields the smallest are folded into one grey "Other" slice. Slices are separated by a
// 2px surface-coloured gap.
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import ChartCard, { ChartTooltip } from './ChartCard.jsx';
import { foldOther, percent } from './dashboardData.js';

export default function AbandonmentDonut({ funnel }) {
  const slices = foldOther(funnel.map((f) => ({ name: f.label, value: f.dropped })));
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const colour = (s, i) => (s.other ? 'var(--other)' : `var(--series-${i + 1})`);
  const table = {
    columns: ['Field', 'Sessions that left here', 'Share of all who left'],
    rows: slices.map((s) => [s.name, s.value.toLocaleString(), percent(s.value / total)]),
  };

  return (
    <ChartCard title="Where people gave up" subtitle="Abandoned sessions, by the last field the person was on." table={total ? table : null}>
      {total === 0 ? (
        <p className="viz-muted">No one abandoned the form in this period.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative h-[220px] w-[220px] flex-none" role="img"
            aria-label={`Donut chart of ${total} abandoned sessions: ${slices.map((s) => `${s.name} ${s.value}`).join(', ')}`}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip content={<ChartTooltip format={(d) => `${d.name}: ${d.value.toLocaleString()} (${percent(d.value / total)})`} />} />
                <Pie data={slices} dataKey="value" nameKey="name" innerRadius={62} outerRadius={96} startAngle={90} endAngle={-270}
                  isAnimationActive={false} stroke="var(--surface-1)" strokeWidth={2}>
                  {slices.map((s, i) => <Cell key={s.name} fill={colour(s, i)} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="viz-tile-value">{total.toLocaleString()}</span>
              <span className="viz-tile-label">left</span>
            </div>
          </div>
          <ul className="viz-legend min-w-[180px] flex-1" aria-label="Legend">
            {slices.map((s, i) => (
              <li key={s.name}>
                <span className="viz-swatch" style={{ background: colour(s, i) }} aria-hidden="true" />
                <span>{s.name}</span>
                <span className="viz-legend-value">{s.value.toLocaleString()} · {percent(s.value / total)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ChartCard>
  );
}
