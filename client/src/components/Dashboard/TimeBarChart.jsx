// TimeBarChart.jsx - FR-6.1: average time per field as horizontal bars (one series, so no
// legend box; the card title names it). Bars have rounded data-ends, each is labelled with
// its value, and a table view repeats the numbers.
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList, Tooltip, ResponsiveContainer } from 'recharts';
import ChartCard, { ChartTooltip } from './ChartCard.jsx';
import { seconds } from './dashboardData.js';

const shorten = (text) => (text.length > 18 ? `${text.slice(0, 17)}…` : text); // full name is in the tooltip and table

export default function TimeBarChart({ fields }) {
  const data = fields.map((f) => ({ name: f.label, secs: f.avg_time_ms / 1000, label: seconds(f.avg_time_ms), ms: f.avg_time_ms }));
  const table = { columns: ['Field', 'Average time'], rows: fields.map((f) => [f.label, seconds(f.avg_time_ms)]) };

  return (
    <ChartCard title="Average time per field" subtitle="Seconds a person spends in each field." table={table}>
      <div role="img" aria-label={`Bar chart of average seconds per field: ${data.map((d) => `${d.name} ${d.label}`).join(', ')}`}>
        <ResponsiveContainer width="100%" height={Math.max(180, data.length * 38 + 30)}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: 4 }}>
            <CartesianGrid horizontal={false} stroke="var(--grid)" />
            <XAxis type="number" tickFormatter={(v) => `${v}s`} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
            <YAxis type="category" dataKey="name" width={130} tickFormatter={shorten} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
            <Tooltip cursor={{ fill: 'var(--grid)', opacity: 0.4 }} content={<ChartTooltip format={(d) => `${d.name}: ${d.label} on average`} />} />
            <Bar dataKey="secs" fill="var(--series-1)" radius={[0, 4, 4, 0]} barSize={16} isAnimationActive={false}>
              <LabelList dataKey="label" position="right" fill="var(--text-primary)" stroke="none" fontSize={12} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
