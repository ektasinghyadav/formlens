// FieldTable.jsx - FR-5.2 / FR-6.1: per-field time, error, correction and abandonment numbers.
import { percent, seconds } from './dashboardData.js';

export default function FieldTable({ fields }) {
  return (
    <section className="viz-card" aria-label="Field details">
      <h2>Field details</h2>
      <p className="viz-sub">Error, correction and abandonment rates are shares of the sessions that reached the field.</p>
      <div className="overflow-x-auto">
        <table className="viz-table">
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col" className="num">Avg time</th>
              <th scope="col" className="num">Error rate</th>
              <th scope="col" className="num">Correction rate</th>
              <th scope="col" className="num">Abandonment rate</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f.field_id}>
                <th scope="row">{f.label}</th>
                <td className="num">{seconds(f.avg_time_ms)}</td>
                <td className="num">{percent(f.error_rate)}</td>
                <td className="num">{percent(f.correction_rate)}</td>
                <td className="num">{percent(f.abandonment_rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
