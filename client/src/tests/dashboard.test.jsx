// @vitest-environment jsdom
// Dashboard screen tests. Requirements: FR-6.1, FR-6.2, FR-7.2, NFR-4.2. (Sprint 7)
// The API is faked. recharts' ResponsiveContainer is given a fixed size (jsdom has no layout).
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Dashboard from '../components/Dashboard/Dashboard.jsx';
import * as analytics from '../api/analytics.js';
import * as formsApi from '../api/forms.js';

vi.mock('recharts', async (orig) => {
  const m = await orig();
  return { ...m, ResponsiveContainer: ({ children, height }) => React.cloneElement(children, { width: 600, height: typeof height === 'number' ? height : 220 }) };
});
vi.mock('../api/analytics.js');
vi.mock('../api/forms.js');
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const NAMES = ['Full Name', 'Email', 'Resume Upload'];
const funnel = [
  { field_id: 'a', label: 'Full Name', reached: 100, dropped: 5, drop_rate: 0.05 },
  { field_id: 'b', label: 'Email', reached: 90, dropped: 10, drop_rate: 0.1111 },
  { field_id: 'c', label: 'Resume Upload', reached: 70, dropped: 30, drop_rate: 0.4286 },
];
const fields = [
  { field_id: 'a', label: 'Full Name', avg_time_ms: 6000, error_rate: 0.03, correction_rate: 0.01, abandonment_rate: 0.05 },
  { field_id: 'b', label: 'Email', avg_time_ms: 8500, error_rate: 0.12, correction_rate: 0.06, abandonment_rate: 0.1111 },
  { field_id: 'c', label: 'Resume Upload', avg_time_ms: 15900, error_rate: 0.39, correction_rate: 0.24, abandonment_rate: 0.4286 },
];
const summary = { views: 120, completions: 60, abandonments: 45, completion_rate: 0.5 };
const recs = [
  { rule: 'abandonment', priority: 'high', field_id: 'c', label: 'Resume Upload', reason: '43% of the sessions that reached "Resume Upload" left the form there.', suggestion: 'Simplify this field.' },
  { rule: 'error', priority: 'medium', field_id: 'c', label: 'Resume Upload', reason: '39% hit a validation error.', suggestion: 'Clarify the label.' },
  { rule: 'error', priority: 'low', field_id: 'b', label: 'Email', reason: '12% hit a validation error.', suggestion: 'Add an example.' },
];

function mockData(over = {}) {
  analytics.getSummary.mockResolvedValue({ data: over.summary ?? summary });
  analytics.getFunnel.mockResolvedValue({ data: over.funnel ?? funnel });
  analytics.getFields.mockResolvedValue({ data: over.fields ?? fields });
  analytics.getRecommendations.mockResolvedValue({ data: over.recs ?? recs });
  formsApi.getForm.mockResolvedValue({ data: { title: 'Job Application' } });
}
function open() {
  return render(
    <MemoryRouter initialEntries={['/admin/forms/F1/dashboard']}>
      <Routes><Route path="/admin/forms/:id/dashboard" element={<Dashboard />} /></Routes>
    </MemoryRouter>
  );
}
const calls = () => [analytics.getSummary, analytics.getFunnel, analytics.getFields, analytics.getRecommendations];

describe('showing the data (FR-6.1)', () => {
  it('shows the title, the four summary tiles, every chart, the field table and the recommendations', async () => {
    mockData();
    open();
    expect(await screen.findByRole('heading', { name: 'Job Application' })).toBeTruthy();
    const tiles = within(screen.getByRole('list', { name: 'Summary' }));
    expect(tiles.getByText('120')).toBeTruthy();
    expect(tiles.getByText('60')).toBeTruthy();
    expect(tiles.getByText('45')).toBeTruthy();
    expect(tiles.getByText('50.0%')).toBeTruthy();
    for (const name of ['Completion funnel', 'Where people gave up', 'Average time per field', 'Field details', 'Recommendations']) {
      expect(screen.getByRole('region', { name })).toBeTruthy();
    }
    expect(screen.getAllByRole('img').length).toBe(3); // funnel, donut, bar - each with a text description
    for (const call of calls()) expect(call).toHaveBeenCalledWith('F1', { from: '', to: '' }); // all time at first
  });

  it('puts the exact numbers in the field table', async () => {
    mockData();
    open();
    const table = within(await screen.findByRole('region', { name: 'Field details' }));
    const row = table.getByRole('row', { name: /Resume Upload/ });
    expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual(['15.9 s', '39%', '24%', '43%']);
  });

  it('every chart has a "view as table" alternative with the same numbers', async () => {
    mockData();
    open();
    await screen.findByRole('region', { name: 'Completion funnel' });
    expect(screen.getAllByText('View as table')).toHaveLength(3);
    const funnelTable = within(screen.getByRole('region', { name: 'Completion funnel' })).getByRole('table', { hidden: true });
    expect(within(funnelTable).getByRole('row', { name: /Resume Upload/, hidden: true }).textContent).toContain('70');
    const donutRegion = within(screen.getByRole('region', { name: 'Where people gave up' }));
    expect(donutRegion.getByRole('list', { name: 'Legend' }).textContent).toContain('Resume Upload');
    expect(donutRegion.getByRole('list', { name: 'Legend' }).textContent).toContain('30 · 67%'); // 30 of the 45 who left
  });

  it('groups the advice one card per field, worst first, with a word + icon priority (FR-7.2)', async () => {
    mockData();
    open();
    const panel = within(await screen.findByRole('region', { name: 'Recommendations' }));
    expect(panel.getByText(/2 fields need attention: 1 high · 1 low/)).toBeTruthy();
    const cards = panel.getAllByRole('listitem').filter((li) => li.className.includes('rec-card'));
    expect(cards.map((c) => c.querySelector('.rec-field').textContent)).toEqual(['Resume Upload', 'Email']); // Resume Upload has two problems but one card
    expect(cards.map((c) => c.querySelector('.viz-badge').textContent)).toEqual(['▲High', '▽Low']); // card badge = worst problem
    expect(panel.getByText('43% of the sessions that reached "Resume Upload" left the form there.')).toBeTruthy();
    expect(panel.getByText('Simplify this field.')).toBeTruthy();
    expect(panel.getByText('People quit here')).toBeTruthy();
  });
});

describe('date range filter (FR-6.2)', () => {
  it('refetches all four endpoints when a preset is chosen, and marks it as selected', async () => {
    mockData();
    open();
    await screen.findByRole('region', { name: 'Completion funnel' });
    expect(screen.getByRole('button', { name: 'All time' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
    await waitFor(() => expect(analytics.getSummary).toHaveBeenCalledTimes(2));
    const range = analytics.getSummary.mock.calls[1][1];
    expect(range.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(range.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const call of calls()) expect(call.mock.calls[1][1]).toEqual(range); // every widget gets the same range
    expect(screen.getByRole('button', { name: 'Last 7 days' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('refetches with custom From and To dates', async () => {
    mockData();
    open();
    await screen.findByRole('region', { name: 'Completion funnel' });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-10' } });
    await waitFor(() => expect(analytics.getRecommendations).toHaveBeenLastCalledWith('F1', { from: '2026-11-01', to: '2026-11-10' }));
  });

  it('shows a clear message and fetches nothing when From is after To', async () => {
    mockData();
    open();
    await screen.findByRole('region', { name: 'Completion funnel' });
    const before = analytics.getSummary.mock.calls.length;
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-10' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-01' } });
    expect((await screen.findByRole('alert')).textContent).toMatch(/From.*not be after.*To/);
    expect(analytics.getSummary.mock.calls.length).toBe(before + 1); // only the valid "From only" step fetched
    expect(screen.queryByRole('region', { name: 'Completion funnel' })).toBeNull(); // no stale charts under an invalid range
  });

  it('ignores a slow answer for an old range when a newer range has already answered', async () => {
    let releaseOld;
    const old = new Promise((resolve) => { releaseOld = () => resolve({ data: { views: 999, completions: 1, abandonments: 1, completion_rate: 0.001 } }); });
    mockData();
    analytics.getSummary.mockReturnValueOnce(old); // the FIRST request will be slow
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Last 30 days' })); // second request: fast
    await screen.findByRole('region', { name: 'Completion funnel' });
    releaseOld(); // the old answer arrives late
    await new Promise((r) => setTimeout(r, 20));
    expect(within(screen.getByRole('list', { name: 'Summary' })).getByText('120')).toBeTruthy();
    expect(screen.queryByText('999')).toBeNull();
  });
});

describe('loading, error and empty states', () => {
  it('shows a loading message first', async () => {
    mockData();
    analytics.getSummary.mockReturnValue(new Promise(() => {})); // never answers
    open();
    expect((await screen.findByRole('status')).textContent).toMatch(/Loading/);
  });

  it('shows an error with a working "Try again" button', async () => {
    mockData();
    analytics.getFunnel.mockRejectedValueOnce(new Error('network'));
    open();
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be loaded/);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('region', { name: 'Completion funnel' })).toBeTruthy();
  });

  it('says the form was not found when the server answers 404 (someone else\'s form)', async () => {
    mockData();
    analytics.getSummary.mockRejectedValue({ response: { status: 404 } });
    open();
    expect((await screen.findByRole('alert')).textContent).toMatch(/not found/);
  });

  it('shows a friendly empty state, no charts and no NaN, for a form with no sessions', async () => {
    mockData({
      summary: { views: 0, completions: 0, abandonments: 0, completion_rate: 0 },
      funnel: funnel.map((f) => ({ ...f, reached: 0, dropped: 0, drop_rate: 0 })),
      fields: fields.map((f) => ({ ...f, avg_time_ms: 0, error_rate: 0, correction_rate: 0, abandonment_rate: 0 })),
      recs: [],
    });
    open();
    expect(await screen.findByRole('heading', { name: 'No responses in this period' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Completion funnel' })).toBeNull();
    expect(screen.getByLabelText('From')).toBeTruthy(); // the filter stays, so they can widen the range
    expect(document.body.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('copes with sessions but nothing to show in a panel: no abandonments, nobody used a field, nothing to fix', async () => {
    mockData({
      summary: { views: 3, completions: 3, abandonments: 0, completion_rate: 1 },
      funnel: funnel.map((f) => ({ ...f, reached: 0, dropped: 0, drop_rate: 0 })),
      fields: fields.map((f) => ({ ...f, avg_time_ms: 0, error_rate: 0, correction_rate: 0, abandonment_rate: 0 })),
      recs: [],
    });
    open();
    expect(await screen.findByText('No one abandoned the form in this period.')).toBeTruthy();
    expect(screen.getByText('No one has used a field yet in this period.')).toBeTruthy();
    expect(screen.getByText(/No problems found/)).toBeTruthy();
    expect(screen.getByText('100.0%')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });
});

describe('responsive layout (NFR-4.2 / usable on a narrow window)', () => {
  it('uses a single column on narrow screens and two on wide ones (CSS classes), and scrolls the table sideways', async () => {
    mockData();
    const { container } = open();
    await screen.findByRole('region', { name: 'Completion funnel' });
    expect(container.querySelectorAll('.dash-grid > .dash-col').length).toBe(2); // charts column + advice column (CSS makes them 2 across when wide)
    expect(container.querySelector('.viz-stats')).not.toBeNull(); // summary strip: 2 across, then 4 (CSS)
    expect(container.querySelector('.overflow-x-auto table')).not.toBeNull();
  });
});
