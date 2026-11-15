// ChartCard.jsx - a titled card around one chart, with a "view as table" alternative.
// The table is for people who cannot use the colours (and a way to read exact numbers):
// every chart on the dashboard has one. Requirements: FR-6.1, NFR-4.2.
export default function ChartCard({ title, subtitle, table, children }) {
  return (
    <section className="viz-card" aria-label={title}>
      <h2>{title}</h2>
      {subtitle && <p className="viz-sub">{subtitle}</p>}
      {children}
      {table && (
        <details className="mt-3">
          <summary className="viz-muted cursor-pointer text-sm">View as table</summary>
          <table className="viz-table mt-2">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>{table.columns.map((c, i) => <th key={c} scope="col" className={i > 0 ? 'num' : ''}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row[0]}>{row.map((cell, i) => (i === 0 ? <th key={i} scope="row">{cell}</th> : <td key={i} className="num">{cell}</td>))}</tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}

// The little box shown when hovering a mark (a hover layer on every chart).
export function ChartTooltip({ active, payload, format }) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return <div className="viz-tooltip">{format(item.payload ?? item)}</div>;
}
