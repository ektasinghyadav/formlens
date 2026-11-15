// SummaryCards.jsx - FR-5.1 headline numbers as four tiles.
import { percentOne } from './dashboardData.js';

export default function SummaryCards({ summary }) {
  const tiles = [
    ['Views', summary.views.toLocaleString()],
    ['Completions', summary.completions.toLocaleString()],
    ['Abandonments', summary.abandonments.toLocaleString()],
    ['Completion rate', percentOne(summary.completion_rate)],
  ];
  return (
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Summary">
      {tiles.map(([label, value]) => (
        <li key={label} className="viz-card">
          <div className="viz-tile-value">{value}</div>
          <div className="viz-tile-label">{label}</div>
        </li>
      ))}
    </ul>
  );
}
