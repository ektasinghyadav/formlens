// @vitest-environment jsdom
// Form Builder screen tests. Requirements: FR-1.1-1.4, NFR-4.1. (Sprint 2)
// The API layer is faked, so these test what the admin sees and what we would send.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import FormList from '../components/FormBuilder/FormList.jsx';
import FormEditor from '../components/FormBuilder/FormEditor.jsx';
import * as formsApi from '../api/forms.js';

vi.mock('../api/forms.js');
afterEach(() => { cleanup(); vi.resetAllMocks(); });

function renderEditor(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/forms/:id/edit" element={<FormEditor />} />
        <Route path="/admin/forms" element={<p>LIST PAGE</p>} />
      </Routes>
    </MemoryRouter>
  );
}
const labels = () => screen.getAllByLabelText('Question shown to the respondent').map((i) => i.value);

describe('FormList', () => {
  const forms = [
    { form_id: '1', title: 'Job form', status: 'draft', share_url: null, created_at: '2026-11-16T10:00:00Z' },
    { form_id: '2', title: 'Survey', status: 'published', share_url: 'http://x/f/abc', created_at: '2026-11-16T10:00:00Z' },
  ];

  it('shows status as words, and the right actions for each status', async () => {
    formsApi.listForms.mockResolvedValue({ data: forms });
    render(<MemoryRouter><FormList /></MemoryRouter>);
    const draftRow = (await screen.findByText('Job form')).closest('tr');
    const pubRow = screen.getByText('Survey').closest('tr');
    expect(within(draftRow).getByText('Draft')).toBeTruthy();
    expect(within(draftRow).getByRole('button', { name: 'Publish' })).toBeTruthy();
    expect(within(draftRow).queryByRole('button', { name: 'Copy link' })).toBeNull();
    expect(within(pubRow).getByText('Published')).toBeTruthy();
    expect(within(pubRow).getByRole('button', { name: 'Unpublish' })).toBeTruthy();
    expect(within(pubRow).getByRole('button', { name: 'Copy link' })).toBeTruthy();
    expect(within(pubRow).getByRole('link', { name: 'Dashboard' }).getAttribute('href')).toBe('/admin/forms/2/dashboard');
  });

  it('publishes a draft and reloads the list', async () => {
    formsApi.listForms.mockResolvedValue({ data: forms });
    formsApi.publishForm.mockResolvedValue({ data: {} });
    render(<MemoryRouter><FormList /></MemoryRouter>);
    const row = (await screen.findByText('Job form')).closest('tr');
    fireEvent.click(within(row).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(formsApi.publishForm).toHaveBeenCalledWith('1'));
    await waitFor(() => expect(formsApi.listForms).toHaveBeenCalledTimes(2));
  });

  it('shows a friendly message when there are no forms', async () => {
    formsApi.listForms.mockResolvedValue({ data: [] });
    render(<MemoryRouter><FormList /></MemoryRouter>);
    expect(await screen.findByText(/no forms yet/i)).toBeTruthy();
  });
});

describe('FormEditor', () => {
  it('adds fields of each type with ready-to-use labels, and deletes one', () => {
    renderEditor('/admin/forms/new/edit');
    for (const name of ['Short text', 'Email', 'Number', 'Dropdown', 'File upload']) {
      fireEvent.click(screen.getByRole('button', { name: `+ ${name}` }));
    }
    expect(labels()).toEqual(['Your name', 'Your email', 'A number', 'Choose one', 'Upload a file']);
    fireEvent.click(screen.getByRole('button', { name: 'Delete field 2' }));
    expect(labels()).toEqual(['Your name', 'A number', 'Choose one', 'Upload a file']);
  });

  it('reorders with the down and up buttons', () => {
    renderEditor('/admin/forms/new/edit');
    fireEvent.click(screen.getByRole('button', { name: '+ Short text' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Email' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move field 1 down' }));
    expect(labels()).toEqual(['Your email', 'Your name']);
    fireEvent.click(screen.getByRole('button', { name: 'Move field 2 up' }));
    expect(labels()).toEqual(['Your name', 'Your email']);
  });

  it('reorders by dragging a card onto another', () => {
    renderEditor('/admin/forms/new/edit');
    fireEvent.click(screen.getByRole('button', { name: '+ Short text' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Email' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Number' }));
    const cards = screen.getAllByRole('listitem');
    fireEvent.dragStart(cards[0]);
    fireEvent.drop(cards[2]);
    expect(labels()).toEqual(['Your email', 'A number', 'Your name']);
  });

  it('saves a new draft with the exact payload the API expects', async () => {
    formsApi.createForm.mockResolvedValue({ data: { form_id: 'new-id' } });
    formsApi.getForm.mockResolvedValue({ data: { form_id: 'new-id', title: 'Job', status: 'draft', share_url: null, fields: [] } });
    renderEditor('/admin/forms/new/edit');
    fireEvent.change(screen.getByLabelText('Form title'), { target: { value: 'Job' } });
    fireEvent.click(screen.getByRole('button', { name: '+ File upload' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(formsApi.createForm).toHaveBeenCalled());
    expect(formsApi.createForm.mock.calls[0][0]).toEqual({
      title: 'Job',
      fields: [{ field_type: 'file', label: 'Upload a file', is_required: false, validations: { maxFileSizeMB: 5 } }],
    });
    expect(await screen.findByText('Draft saved.')).toBeTruthy();
  });

  it('publishes in ONE click: saves, publishes, and shows the link to copy (NFR-4.1)', async () => {
    formsApi.createForm.mockResolvedValue({ data: { form_id: 'f9' } });
    formsApi.publishForm.mockResolvedValue({ data: { status: 'published', share_url: 'http://localhost:5173/f/tok123' } });
    formsApi.getForm.mockResolvedValue({
      data: { form_id: 'f9', title: 'T', status: 'published', share_url: 'http://localhost:5173/f/tok123', fields: [] },
    });
    renderEditor('/admin/forms/new/edit');
    fireEvent.change(screen.getByLabelText('Form title'), { target: { value: 'T' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Short text' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish' })); // the single click
    expect((await screen.findByLabelText('Share this link with respondents')).value).toBe('http://localhost:5173/f/tok123');
    expect(formsApi.publishForm).toHaveBeenCalledWith('f9');
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Unpublish' })).toBeTruthy();
  });

  it('shows the server\'s message as text when saving fails', async () => {
    formsApi.createForm.mockRejectedValue({ response: { data: { error: 'Title is required (max 255 characters)' } } });
    renderEditor('/admin/forms/new/edit');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Title is required');
  });

  it('loads an existing form into the editor, keeping field ids when saving', async () => {
    const form = {
      form_id: 'e1', title: 'Existing', status: 'draft', share_url: null,
      fields: [{ field_id: 'fid1', field_type: 'text', label: 'Name', is_required: true, position: 0, validations: null }],
    };
    formsApi.getForm.mockResolvedValue({ data: form });
    formsApi.updateForm.mockResolvedValue({ data: form });
    renderEditor('/admin/forms/e1/edit');
    expect((await screen.findByLabelText('Form title')).value).toBe('Existing');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(formsApi.updateForm).toHaveBeenCalled());
    expect(formsApi.updateForm.mock.calls[0][1].fields[0].field_id).toBe('fid1');
  });
});
