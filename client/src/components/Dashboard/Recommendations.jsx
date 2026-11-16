// Recommendations.jsx - FR-7.2: the High / Medium / Low advice, grouped one card per field.
// The server sends a flat list (one item per problem). A field with three problems used to show
// as three separate rows, which read as repetition, so here we group the rows by field.
// Each priority is a badge with an icon AND a word, so it never depends on colour alone.
const BADGES = {
  high: { icon: '▲', text: 'High' },
  medium: { icon: '◆', text: 'Medium' },
  low: { icon: '▽', text: 'Low' },
};
const RANK = { high: 0, medium: 1, low: 2 };

// Plain-English name of the kind of problem (the `rule` the server sends).
const ISSUES = {
  abandonment: 'People quit here',
  drop_before: 'People quit just before this field',
  error: 'Validation errors',
  correction: 'Answers get corrected',
  time: 'Takes a long time',
  not_enough_data: 'Not enough data yet',
};

// Groups the flat list by field. Cards are ordered by their worst problem; the list from the
// server is already High-first, so the first item of a field decides its place.
export function groupByField(items) {
  const groups = [];
  for (const r of items) {
    let g = groups.find((x) => x.field_id === r.field_id);
    if (!g) {
      g = { field_id: r.field_id, label: r.label, priority: r.priority, issues: [] };
      groups.push(g);
    }
    if (RANK[r.priority] < RANK[g.priority]) g.priority = r.priority;
    g.issues.push(r);
  }
  return groups.sort((a, b) => RANK[a.priority] - RANK[b.priority]); // stable: keeps form order inside a tier
}

function Badge({ priority }) {
  const b = BADGES[priority];
  return (
    <span className={`viz-badge viz-badge-${priority}`}>
      <span className="viz-badge-icon" aria-hidden="true">{b.icon}</span>{b.text}
    </span>
  );
}

export default function Recommendations({ items }) {
  const groups = groupByField(items);
  const count = (p) => groups.filter((g) => g.priority === p).length; // fields, by their worst problem
  return (
    <section className="viz-card" aria-label="Recommendations">
      <h2>Recommendations</h2>
      <p className="viz-sub">What to fix on your form, most urgent first. Each card is one field.</p>
      {items.length === 0 ? (
        <p className="viz-muted">No problems found in this period. Nothing needs fixing right now.</p>
      ) : (
        <>
          <p className="rec-summary">
            {groups.length} {groups.length === 1 ? 'field needs' : 'fields need'} attention:{' '}
            {['high', 'medium', 'low'].filter(count).map((p) => `${count(p)} ${BADGES[p].text.toLowerCase()}`).join(' · ')}
          </p>
          <ul className="rec-key" aria-label="What the priorities mean">
            <li><Badge priority="high" /> Fix first. Far past your limit.</li>
            <li><Badge priority="medium" /> Worth fixing soon.</li>
            <li><Badge priority="low" /> Keep an eye on it.</li>
          </ul>
          <ol className="rec-list">
            {groups.map((g) => (
              <li key={g.field_id} className={`rec-card rec-card-${g.priority}`}>
                <div className="rec-head">
                  <strong className="rec-field">{g.label}</strong>
                  <Badge priority={g.priority} />
                </div>
                <ul className="rec-issues">
                  {g.issues.map((r, i) => (
                    <li key={`${r.rule}-${i}`} className="rec-issue">
                      <div className="rec-issue-title">
                        {g.issues.length > 1 && <span className={`rec-dot rec-dot-${r.priority}`} aria-hidden="true" />}
                        {ISSUES[r.rule] ?? 'Issue'}
                        {g.issues.length > 1 && <span className="viz-muted"> ({BADGES[r.priority].text.toLowerCase()})</span>}
                      </div>
                      <p className="rec-reason">{r.reason}</p>
                      <p className="rec-fix"><span>What to do:</span> {r.suggestion}</p>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
