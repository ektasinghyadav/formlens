// FormFill.jsx - the public page a respondent sees at /f/:shareLink. No login.
// Requirements: FR-2.1 (renders from the link), FR-2.2 (live inline validation),
// FR-2.3 (submit), NFR-4.2 (accessible: visible labels, text errors), NFR-7.1 (privacy notice).
// Accessibility choices: every input has a visible <label>; errors are real text linked with
// aria-describedby (not only red colour); required fields say "(required)" in words.
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { createSession, getForm, getPublicForm, submitForm, uploadFile } from '../../api/forms.js';
import { createTracker } from '../../tracker/eventTracker.js';
import { validateAnswer } from './validate.js';

// preview = the admin's "View form" page (/admin/forms/:id/view): the same page a respondent sees,
// loaded by form id so drafts work too. It starts no session and no tracker (a preview must not
// add fake visits to the dashboard) and never submits. It adds an Edit button for the owner.
export default function FormFill({ preview = false }) {
  const { shareLink, id } = useParams();
  const [state, setState] = useState('loading'); // loading | ready | unavailable | error | done
  const [form, setForm] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [values, setValues] = useState({}); // field_id -> text
  const [files, setFiles] = useState({}); // field_id -> File
  const [errors, setErrors] = useState({}); // field_id -> message
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const formRef = useRef(null);

  // Load the form, then start a session (one visit = one session).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = preview ? await getForm(id) : await getPublicForm(shareLink);
        if (cancelled) return; // React dev mode runs effects twice; only the last run starts a session
        const session = preview ? null : await createSession(data.form_id);
        if (cancelled) return;
        setForm(preview ? { ...data, form_id: id } : data);
        setSessionId(session ? session.data.session_id : null);
        setState('ready');
      } catch (err) {
        if (!cancelled) setState(err.response?.status === 404 ? 'unavailable' : 'error');
      }
    })();
    return () => { cancelled = true; };
  }, [shareLink, id, preview]);

  // The ONLY place FormFill touches tracking (SPEC section 4): start it when the form is on
  // screen, stop it when the form goes away (e.g. after a successful submit). All the
  // listening happens inside eventTracker.js.
  useEffect(() => {
    if (state !== 'ready' || preview) return undefined;
    const tracker = createTracker({
      formId: form.form_id,
      sessionId,
      endpoint: '/api/v1/events/batch',
      container: formRef.current,
    });
    tracker.start();
    return () => tracker.stop();
  }, [state, form, sessionId, preview]);

  // Check one field now and show or clear its message (runs on blur, and while typing after that).
  function check(field, value, file) {
    setErrors((e) => ({ ...e, [field.field_id]: validateAnswer(field, value, file) }));
  }

  function onChange(field, value) {
    setValues((v) => ({ ...v, [field.field_id]: value }));
    // once a message is showing, update it live so the person sees it disappear when fixed
    if (errors[field.field_id]) check(field, value, files[field.field_id]);
  }

  function onFile(field, file) {
    setFiles((f) => ({ ...f, [field.field_id]: file }));
    check(field, '', file);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');
    const found = {};
    for (const f of form.fields) found[f.field_id] = validateAnswer(f, values[f.field_id], files[f.field_id]);
    setErrors(found);
    const firstBad = form.fields.find((f) => found[f.field_id]);
    if (firstBad) {
      formRef.current?.querySelector(`#field-${firstBad.field_id}`)?.focus(); // keyboard users land on the problem
      return;
    }
    if (preview) { setFormError('Preview only: nothing was submitted.'); return; }

    setBusy(true);
    try {
      const responses = [];
      for (const f of form.fields) {
        if (f.field_type === 'file') {
          const file = files[f.field_id];
          if (file) responses.push({ field_id: f.field_id, value: (await uploadFile(form.form_id, f.field_id, file)).data.file_ref });
        } else {
          responses.push({ field_id: f.field_id, value: values[f.field_id] ?? '' });
        }
      }
      await submitForm(form.form_id, { session_id: sessionId, responses });
      setState('done');
    } catch (err) {
      const data = err.response?.data;
      if (data?.fieldErrors) setErrors(data.fieldErrors);
      setFormError(
        err.response?.status === 409
          ? 'This form was already submitted.'
          : data?.error || 'Something went wrong. Please try again.'
      );
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') return <main className="fill"><p className="hint">Loading…</p></main>;
  if (state === 'unavailable') {
    return (
      <main className="fill">
        <h1>This form is not available</h1>
        <p className="lede">The link may be wrong, or the form is no longer open.</p>
      </main>
    );
  }
  if (state === 'error') {
    return <main className="fill"><p role="alert" className="error">Error: the form could not be loaded. Please try again later.</p></main>;
  }
  if (state === 'done') {
    return (
      <main className="fill">
        <h1>Thank you</h1>
        <p role="status" className="lede">Your response was submitted.</p>
      </main>
    );
  }

  return (
    <main className="fill">
      {preview && (
        <div className="preview-bar">
          <p className="hint">Viewing as a respondent would see it{form.status && form.status !== 'published' ? ` (${form.status}, not yet public)` : ''}.</p>
          <div className="row-actions">
            <Link to="/admin/forms" className="link">Back to forms</Link>
            <Link to={`/admin/forms/${id}/edit`} className="btn btn-small">Edit form</Link>
          </div>
        </div>
      )}
      <h1>{form.title}</h1>

      {/* NFR-7.1: the person is told, in plain words, that interactions are recorded. */}
      <section aria-label="Privacy notice" className="note">
        <strong>Privacy notice:</strong> this form records how you use it, such as which fields you click,
        how long you spend on each, and where you stop. It does not record what you type while you fill it in.
        Your answers are saved only when you press Submit.
      </section>

      <form ref={formRef} onSubmit={handleSubmit} noValidate className="stack">
        {form.fields.map((f) => {
          const id = `field-${f.field_id}`;
          const errId = `${id}-error`;
          const error = errors[f.field_id];
          const common = {
            id,
            'data-field-id': f.field_id, // how the tracker knows which field an event belongs to
            'aria-invalid': error ? 'true' : undefined,
            'aria-describedby': error ? errId : undefined,
            className: f.field_type === 'dropdown' ? 'select' : 'input',
          };
          return (
            <div key={f.field_id}>
              <label htmlFor={id} className="q-label">
                <span>{f.label}</span> {f.is_required && <span className="q-req">(required)</span>}
              </label>

              {f.field_type === 'dropdown' ? (
                <select {...common} value={values[f.field_id] ?? ''}
                  onChange={(e) => onChange(f, e.target.value)} onBlur={() => check(f, values[f.field_id], undefined)}>
                  <option value="">Choose…</option>
                  {f.validations.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : f.field_type === 'file' ? (
                <input {...common} type="file" onChange={(e) => onFile(f, e.target.files[0])} />
              ) : (
                <input {...common}
                  type={f.field_type === 'email' ? 'email' : 'text'}
                  inputMode={f.field_type === 'number' ? 'decimal' : undefined}
                  autoComplete={f.field_type === 'email' ? 'email' : 'off'}
                  value={values[f.field_id] ?? ''}
                  onChange={(e) => onChange(f, e.target.value)} onBlur={() => check(f, values[f.field_id], undefined)} />
              )}

              {error && <p id={errId} role="alert" className="error" style={{ marginTop: 6 }}>Error: {error}</p>}
            </div>
          );
        })}

        {formError && <p role="alert" className="error">{preview ? '' : 'Error: '}{formError}</p>}
        <button type="submit" disabled={busy} className="btn btn-block" style={{ minHeight: 48 }}>
          {busy ? 'Submitting…' : 'Submit'}
        </button>
      </form>
    </main>
  );
}
