// FunnelPanel.jsx - FR-5.3 / FR-6.1: how many sessions reached each field, in order.
// One-hue ordered blue ramp (light to dark = first to last field). Each stage is labelled
// directly, so colour is never the only way to read it. A table view is included.
import { FunnelChart, Funnel, LabelList, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import ChartCard, { ChartTooltip } from './ChartCard.jsx';
import { percent, rampStep } from './dashboardData.js';

export default function FunnelPanel({ funnel }) {
  const first = funnel[0]?.reached ?? 0;
  const data = funnel.map((f, i) => ({
    ...f,
    name: f.label,
    text: `${f.label}: ${f.reached.toLocaleString()}`,
    fill: `var(--ramp-${rampStep(i, funnel.length) + 1})`,
  }));
  const table = {
    columns: ['Field', 'Reached', 'Left here', 'Drop rate'],
    rows: funnel.map((f) => [f.label, f.reached.toLocaleString(), f.dropped.toLocaleString(), percent(f.drop_rate)]),
  };

  return (
    <ChartCard title="Completion funnel" subtitle="How many sessions reached each field, in form order." table={table}>
      {first === 0 ? (
        <p className="viz-muted">No one has used a field yet in this period.</p>
      ) : (
        <div role="img" aria-label={`Funnel: ${funnel.map((f) => `${f.label} ${f.reached}`).join(', ')}`}>
          <ResponsiveContainer width="100%" height={Math.max(220, funnel.length * 46)}>
            <FunnelChart margin={{ top: 8, right: 170, bottom: 8, left: 8 }}>
              <Tooltip content={<ChartTooltip format={(d) => `${d.label}: ${d.reached.toLocaleString()} reached, ${d.dropped.toLocaleString()} left here (${percent(d.drop_rate)})`} />} />
              <Funnel dataKey="reached" data={data} isAnimationActive={false} lastShapeType="rectangle" stroke="var(--surface-1)" strokeWidth={2}>
                {data.map((d) => <Cell key={d.field_id} fill={d.fill} />)}
                <LabelList position="right" dataKey="text" fill="var(--text-primary)" stroke="none" fontSize={13} />
              </Funnel>
            </FunnelChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}
