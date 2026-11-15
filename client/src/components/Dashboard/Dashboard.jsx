// Dashboard.jsx - one screen per form: summary, funnel, donut, time chart, field table and
// recommendations, all filtered by one date range. Requirements: FR-6.1, FR-6.2, FR-7.2,
// FR-8.2 (the server only answers for the admin's own forms).
// All numbers come from the API (the same numbers the tests check); this file only draws them.
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getForm } from '../../api/forms.js';
import { getFields, getFunnel, getRecommendations, getSummary } from '../../api/analytics.js';
import AbandonmentDonut from './AbandonmentDonut.jsx';
import DateRangeFilter from './DateRangeFilter.jsx';
import FieldTable from './FieldTable.jsx';
import FunnelPanel from './FunnelPanel.jsx';
import Recommendations from './Recommendations.jsx';
import SummaryCards from './SummaryCards.jsx';
import TimeBarChart from './TimeBarChart.jsx';
import { rangeProblem } from './dashboardData.js';
import './dashboard.css';

export default function Dashboard() {
  const { id } = useParams();
  const [title, setTitle] = useState('');
  const [range, setRange] = useState({ from: '', to: '' }); // '' = no limit = all time
  const [data, setData] = useState(null); // { summary, funnel, fields, recommendations }
  const [state, setState] = useState('loading'); // loading | ready | error | notfound
  const [attempt, setAttempt] = useState(0); // bumping this re-runs the load (Retry button)
  const problem = rangeProblem(range);

  useEffect(() => {
    getForm(id).then((res) => setTitle(res.data.title)).catch(() => {});
  }, [id]);

  // Whenever the form or the date range changes, fetch all four sets of numbers together.
  useEffect(() => {
    if (problem) return undefined; // a bad range is shown as a message; nothing is fetched
    let cancelled = false; // a slow answer for an OLD range must not overwrite a newer one
    setState('loading');
    Promise.all([getSummary(id, range), getFunnel(id, range), getFields(id, range), getRecommendations(id, range)])
      .then(([summary, funnel, fields, recommendations]) => {
        if (cancelled) return;
        setData({ summary: summary.data, funnel: funnel.data, fields: fields.data, recommendations: recommendations.data });
        setState('ready');
      })
      .catch((err) => {
        if (!cancelled) setState(err.response?.status === 404 ? 'notfound' : 'error');
      });
    return () => { cancelled = true; };
  }, [id, range, problem, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return (
    <div className="viz-root">
      <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
        <div>
          <Link to="/admin/forms" className="text-sm underline">← Back to your forms</Link>
          <h1 className="mt-1 text-2xl font-bold">{title ? `${title}: dashboard` : 'Dashboard'}</h1>
        </div>

        <DateRangeFilter range={range} onChange={setRange} problem={problem} />

        {state === 'loading' && <p role="status">Loading the numbers…</p>}
        {state === 'notfound' && <p role="alert" className="viz-error">Error: this form was not found.</p>}
        {state === 'error' && (
          <div role="alert" className="viz-error">
            <p>Error: the dashboard could not be loaded.</p>
            <button type="button" className="viz-button mt-2" onClick={retry}>Try again</button>
          </div>
        )}

        {state === 'ready' && !problem && data.summary.views === 0 && (
          <section className="viz-card" aria-label="No data">
            <h2>No responses in this period</h2>
            <p className="viz-muted">Nobody has opened this form between these dates. Share the form's link, or choose a wider date range.</p>
          </section>
        )}

        {state === 'ready' && !problem && data.summary.views > 0 && (
          <>
            <SummaryCards summary={data.summary} />
            <div className="grid gap-4 lg:grid-cols-2">
              <FunnelPanel funnel={data.funnel} />
              <AbandonmentDonut funnel={data.funnel} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <TimeBarChart fields={data.fields} />
              <Recommendations items={data.recommendations} />
            </div>
            <FieldTable fields={data.fields} />
          </>
        )}
      </main>
    </div>
  );
}
