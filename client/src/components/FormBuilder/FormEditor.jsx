// FormEditor.jsx - the form builder page. Requirements: FR-1.1, FR-1.2, FR-1.3, FR-1.4, NFR-4.1.
// Route /admin/forms/new/edit builds a new form; /admin/forms/:id/edit edits an existing one.
// NFR-4.1: sensible defaults, plain words, and "Publish" is ONE click after the last field
// (it saves, then publishes, then shows the link to copy).
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { createForm, getForm, publishForm, unpublishForm, updateForm } from '../../api/forms.js';
import FieldEditor from './FieldEditor.jsx';
import { FIELD_TYPES, fromApiField, moveItem, newField, toApiForm } from './formModel.js';

export default function FormEditor() {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();

  const [title, setTitle] = useState('');
  const [fields, setFields] = useState([]);
  const [status, setStatus] = useState('draft');
  const [shareUrl, setShareUrl] = useState(null);
  const [loading, setLoading] = useState(!isNew);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dragIndex, setDragIndex] = useState(null);

  function apply(form) {
    setTitle(form.title);
    setFields(form.fields.map(fromApiField));
    setStatus(form.status);
    setShareUrl(form.share_url);
  }

  // Load the form whenever the id in the address changes.
  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    getForm(id)
      .then((res) => { if (!cancelled) { apply(res.data); setLoading(false); } })
      .catch(() => { if (!cancelled) { setError('Could not load this form.'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [id, isNew]);

  const changeField = (key, patch) => setFields((fs) => fs.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  const drag = {
    start: (i) => setDragIndex(i),
    drop: (to) => { if (dragIndex !== null) setFields((fs) => moveItem(fs, dragIndex, to)); setDragIndex(null); },
  };

  // Saves, and returns the form id (creating the form first if it is new).
  async function save() {
    const body = toApiForm(title, fields);
    if (isNew) {
      const { data } = await createForm(body);
      return data.form_id;
    }
    const { data } = await updateForm(id, body);
    apply(data);
    return id;
  }

  async function run(action, doneMessage) {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const formId = await action();
      setNotice(doneMessage);
      if (isNew) navigate(`/admin/forms/${formId}/edit`, { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const saveDraft = () => run(save, status === 'published' ? 'Changes saved.' : 'Draft saved.');
  const publish = () => run(async () => {
    const formId = await save();
    const { data } = await publishForm(formId);
    setStatus(data.status);
    setShareUrl(data.share_url);
    return formId;
  }, 'Published! Copy the link below and share it.');
  const unpublish = () => run(async () => {
    const { data } = await unpublishForm(id);
    setStatus(data.status);
    return id;
  }, 'Unpublished. The link no longer works.');

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setNotice('Link copied.');
    } catch {
      setNotice('Could not copy automatically. Select the link and copy it.');
    }
  }

  if (loading) return <p className="p-6">Loading…</p>;

  return (
    <main className="page-narrow">
      <Link to="/admin/forms" className="link link-quiet" style={{ fontSize: '0.875rem' }}>← Back to your forms</Link>
      <h1 style={{ margin: '12px 0 28px' }}>{isNew ? 'New form' : 'Edit form'}</h1>

      <label htmlFor="form-title" className="label">Form title</label>
      <input id="form-title" value={title} onChange={(e) => setTitle(e.target.value)}
        className="input" style={{ marginBottom: 36 }} />

      <h2 style={{ fontSize: '1.25rem', marginBottom: 14 }}>Fields</h2>
      {fields.length === 0 && <p className="hint" style={{ marginBottom: 12 }}>No fields yet. Add one below.</p>}
      <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: '0 0 20px' }}>
        {fields.map((f, i) => (
          <FieldEditor key={f.key} field={f} index={i} total={fields.length} drag={drag}
            onChange={(patch) => changeField(f.key, patch)}
            onMove={(delta) => setFields((fs) => moveItem(fs, i, i + delta))}
            onDelete={() => setFields((fs) => fs.filter((x) => x.key !== f.key))} />
        ))}
      </ul>

      <div className="add-row">
        <span className="label" style={{ margin: 0, marginRight: 4 }}>Add a field:</span>
        {FIELD_TYPES.map((t) => (
          <button key={t.type} type="button" onClick={() => setFields((fs) => [...fs, newField(t.type)])}
            className="btn btn-quiet btn-small">+ {t.name}</button>
        ))}
      </div>

      {error && <p role="alert" className="error" style={{ marginTop: 20 }}>Error: {error}</p>}
      {notice && <p role="status" className="notice" style={{ marginTop: 20 }}>{notice}</p>}

      <div className="actions">
        <button type="button" onClick={saveDraft} disabled={busy} className="btn btn-quiet">
          {status === 'published' ? 'Save changes' : 'Save draft'}
        </button>
        {status !== 'published' && (
          <button type="button" onClick={publish} disabled={busy} className="btn">
            Publish
          </button>
        )}
        {status === 'published' && (
          <button type="button" onClick={unpublish} disabled={busy} className="btn btn-danger">
            Unpublish
          </button>
        )}
      </div>

      {status === 'published' && shareUrl && (
        <section className="share">
          <label htmlFor="share-url" className="label">Share this link with respondents</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input id="share-url" readOnly value={shareUrl} className="input" />
            <button type="button" onClick={copyLink} className="btn btn-quiet" style={{ whiteSpace: 'nowrap' }}>Copy link</button>
          </div>
        </section>
      )}
    </main>
  );
}
