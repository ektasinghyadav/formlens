// Recommendations.jsx - FR-7.2: the High / Medium / Low advice list.
// Each priority is a badge with an icon AND a word, so it never depends on colour alone.
const BADGES = {
  high: { icon: '▲', text: 'High' },
  medium: { icon: '◆', text: 'Medium' },
  low: { icon: '▽', text: 'Low' },
};

export default function Recommendations({ items }) {
  return (
    <section className="viz-card" aria-label="Recommendations">
      <h2>Recommendations</h2>
      <p className="viz-sub">Fixed rules compared with your thresholds; most important first.</p>
      {items.length === 0 ? (
        <p className="viz-muted">No problems found in this period. Nothing needs fixing right now.</p>
      ) : (
        <ol className="space-y-3">
          {items.map((r, i) => {
            const b = BADGES[r.priority];
            return (
              <li key={`${r.field_id}-${i}`} className="border-b pb-3 last:border-b-0" style={{ borderColor: 'var(--grid)' }}>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className={`viz-badge viz-badge-${r.priority}`}>
                    <span className="viz-badge-icon" aria-hidden="true">{b.icon}</span>{b.text}
                  </span>
                  <strong>{r.label}</strong>
                </div>
                <p className="text-sm">{r.reason}</p>
                <p className="viz-muted text-sm">Suggestion: {r.suggestion}</p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
