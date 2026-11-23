// @vitest-environment jsdom
// Respondent form page tests. Requirements: FR-2.1-2.3, NFR-4.2, NFR-7.1. (Sprint 3)
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import FormFill from '../components/FormFill/FormFill.jsx';
import * as formsApi from '../api/forms.js';
import { createTracker } from '../tracker/eventTracker.js';

vi.mock('../api/forms.js');
vi.mock('../tracker/eventTracker.js'); // the tracker has its own tests; here we only check FormFill starts and stops it
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const publicForm = {
  form_id: 'F1',
  title: 'Job application',
  fields: [
    { field_id: 'a', field_type: 'text', label: 'Full name', is_required: true, validations: null },
    { field_id: 'b', field_type: 'email', label: 'Email', is_required: false, validations: null },
    { field_id: 'c', field_type: 'dropdown', label: 'City', is_required: false, validations: { options: ['Tezpur', 'Guwahati'] } },
    { field_id: 'd', field_type: 'file', label: 'Resume', is_required: false, validations: { maxFileSizeMB: 1 } },
  ],
};

const trackerStub = () => { const t = { start: vi.fn(), stop: vi.fn() }; createTracker.mockReturnValue(t); return t; };

function open(link = 'tok') {
  if (!createTracker.getMockImplementation() && !createTracker.mock.results.length) trackerStub();
  formsApi.getPublicForm.mockResolvedValue({ data: publicForm });
  formsApi.createSession.mockResolvedValue({ data: { session_id: 'S1' } });
  return render(
    <MemoryRouter initialEntries={[`/f/${link}`]}>
      <Routes><Route path="/f/:shareLink" element={<FormFill />} /></Routes>
    </MemoryRouter>
  );
}
const typeInto = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('tracking hand-off (FR-3.4, SPEC section 4)', () => {
  it('starts the tracker on the form, with the session, and stops it when the form goes away', async () => {
    const t = trackerStub();
    formsApi.submitForm.mockResolvedValue({ data: {} });
    const { unmount } = open();
    await screen.findByRole('heading', { name: 'Job application' });
    expect(createTracker).toHaveBeenCalledTimes(1);
    const opts = createTracker.mock.calls[0][0];
    expect(opts).toMatchObject({ formId: 'F1', sessionId: 'S1', endpoint: '/api/v1/events/batch' });
    expect(opts.container.tagName).toBe('FORM');
    expect(t.start).toHaveBeenCalledTimes(1);
    expect(t.stop).not.toHaveBeenCalled();

    typeInto(/Full name/, 'Asha');
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await screen.findByRole('heading', { name: 'Thank you' }); // form removed after submit
    expect(t.stop).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('puts data-field-id on every input so the tracker can tell fields apart', async () => {
    trackerStub();
    open();
    await screen.findByRole('heading', { name: 'Job application' });
    const ids = [...document.querySelectorAll('input, select')].map((el) => el.dataset.fieldId);
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('opening the form (FR-2.1, NFR-7.1)', () => {
  it('shows title, a visible label for every field, "(required)" in words, and the privacy notice', async () => {
    open();
    expect(await screen.findByRole('heading', { name: 'Job application' })).toBeTruthy();
    expect(screen.getByLabelText(/Full name/)).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('City')).toBeTruthy();
    expect(screen.getByLabelText('Resume')).toBeTruthy();
    expect(screen.getByText('(required)')).toBeTruthy();
    expect(screen.getByLabelText('Privacy notice').textContent).toMatch(/records how you use it/);
    expect(formsApi.createSession).toHaveBeenCalledWith('F1'); // one visit = one session
  });

  it('shows a clear "not available" page for an unpublished or unknown link', async () => {
    formsApi.getPublicForm.mockRejectedValue({ response: { status: 404 } });
    render(<MemoryRouter initialEntries={['/f/gone']}><Routes><Route path="/f/:shareLink" element={<FormFill />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'This form is not available' })).toBeTruthy();
    expect(formsApi.createSession).not.toHaveBeenCalled();
  });
});

describe('inline validation (FR-2.2, NFR-4.2)', () => {
  it('shows an error as text linked to the input, and clears it as soon as it is fixed', async () => {
    open();
    await screen.findByRole('heading', { name: 'Job application' });
    typeInto('Email', 'not-an-email');
    fireEvent.blur(screen.getByLabelText('Email'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Error: Enter a valid email/);
    const input = screen.getByLabelText('Email');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(alert.id);

    typeInto('Email', 'a@b.co'); // typing a fix updates the message live
    expect(screen.queryByRole('alert')).toBeNull();
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });

  it('does not send anything when required fields are empty, and focuses the first problem', async () => {
    open();
    await screen.findByRole('heading', { name: 'Job application' });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/required/);
    expect(formsApi.submitForm).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByLabelText(/Full name/));
  });

  it('rejects a file that is over the size limit before uploading', async () => {
    open();
    await screen.findByRole('heading', { name: 'Job application' });
    const big = new File([new Uint8Array(2 * 1024 * 1024)], 'cv.pdf');
    fireEvent.change(screen.getByLabelText('Resume'), { target: { files: [big] } });
    expect((await screen.findByRole('alert')).textContent).toMatch(/too large/);
  });
});

describe('submitting (FR-2.3)', () => {
  it('uploads the file, sends the answers with the session id, and shows a thank-you page', async () => {
    formsApi.uploadFile.mockResolvedValue({ data: { file_ref: 'a-ref' } });
    formsApi.submitForm.mockResolvedValue({ data: { submission_id: 'SUB' } });
    open();
    await screen.findByRole('heading', { name: 'Job application' });
    typeInto(/Full name/, 'Asha');
    typeInto('City', 'Tezpur');
    fireEvent.change(screen.getByLabelText('Resume'), { target: { files: [new File(['x'], 'cv.pdf')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(await screen.findByRole('heading', { name: 'Thank you' })).toBeTruthy();
    expect(formsApi.uploadFile).toHaveBeenCalledWith('F1', 'd', expect.any(File));
    expect(formsApi.submitForm).toHaveBeenCalledWith('F1', {
      session_id: 'S1',
      responses: [
        { field_id: 'a', value: 'Asha' },
        { field_id: 'b', value: '' },
        { field_id: 'c', value: 'Tezpur' },
        { field_id: 'd', value: 'a-ref' },
      ],
    });
  });

  it('shows the server\'s per-field messages if it disagrees with the browser', async () => {
    formsApi.submitForm.mockRejectedValue({ response: { status: 400, data: { error: 'Please correct the highlighted fields', fieldErrors: { a: 'This field is required' } } } });
    open();
    await screen.findByRole('heading', { name: 'Job application' });
    typeInto(/Full name/, 'Asha');
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBe(2)); // form-level + field-level
    expect(screen.getByLabelText(/Full name/).getAttribute('aria-invalid')).toBe('true');
  });

  it('says so plainly if the form was already submitted (409)', async () => {
    formsApi.submitForm.mockRejectedValue({ response: { status: 409, data: { error: 'x' } } });
    open();
    await screen.findByRole('heading', { name: 'Job application' });
    typeInto(/Full name/, 'Asha');
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/already submitted/);
  });
});

describe('keyboard-only use (NFR-4.2)', () => {
  it('uses native controls only: every control is labelled and none is removed from the tab order', async () => {
    open();
    await screen.findByRole('heading', { name: 'Job application' });
    const controls = document.querySelectorAll('input, select, button');
    expect(controls.length).toBe(5); // 4 fields + Submit
    for (const c of controls) expect(c.getAttribute('tabindex')).toBeNull(); // default order = top to bottom
    expect(document.querySelector('form').getAttribute('onclick')).toBeNull();
    // the form is a real <form> with a submit button, so Enter / Space on the button submits it
    expect(screen.getByRole('button', { name: 'Submit' }).getAttribute('type')).toBe('submit');
  });
});

describe('admin preview (View form)', () => {
  function openPreview() {
    formsApi.getForm.mockResolvedValue({ data: { ...publicForm, status: 'draft' } });
    return render(
      <MemoryRouter initialEntries={['/admin/forms/F1/view']}>
        <Routes><Route path="/admin/forms/:id/view" element={<FormFill preview />} /></Routes>
      </MemoryRouter>
    );
  }

  it('shows the respondent page with an Edit button, and records nothing', async () => {
    openPreview();
    await screen.findByRole('heading', { name: 'Job application' });
    expect(screen.getByRole('link', { name: 'Edit form' }).getAttribute('href')).toBe('/admin/forms/F1/edit');
    expect(screen.getByLabelText(/Full name/)).toBeTruthy();
    expect(formsApi.createSession).not.toHaveBeenCalled();
    expect(createTracker).not.toHaveBeenCalled();
  });

  it('never submits: a valid form only says it is a preview', async () => {
    openPreview();
    await screen.findByRole('heading', { name: 'Job application' });
    typeInto(/Full name/, 'Asha');
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText(/Preview only/)).toBeTruthy();
    expect(formsApi.submitForm).not.toHaveBeenCalled();
  });
});
