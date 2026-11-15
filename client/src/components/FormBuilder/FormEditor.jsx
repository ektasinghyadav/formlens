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
    <main className="mx-auto max-w-3xl p-6">
      <Link to="/admin/forms" className="text-sm text-blue-800 underline">← Back to your forms</Link>
      <h1 className="mb-4 mt-2 text-2xl font-bold">{isNew ? 'New form' : 'Edit form'}</h1>

      <label htmlFor="form-title" className="block text-sm font-medium">Form title</label>
      <input id="form-title" value={title} onChange={(e) => setTitle(e.target.value)}
        className="mb-6 mt-1 w-full rounded border border-gray-400 px-3 py-2" />

      <h2 className="mb-2 text-lg font-semibold">Fields</h2>
      {fields.length === 0 && <p className="mb-2 text-gray-600">No fields yet. Add one below.</p>}
      <ul className="mb-4 space-y-3">
        {fields.map((f, i) => (
          <FieldEditor key={f.key} field={f} index={i} total={fields.length} drag={drag}
            onChange={(patch) => changeField(f.key, patch)}
            onMove={(delta) => setFields((fs) => moveItem(fs, i, i + delta))}
            onDelete={() => setFields((fs) => fs.filter((x) => x.key !== f.key))} />
        ))}
      </ul>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Add a field:</span>
        {FIELD_TYPES.map((t) => (
          <button key={t.type} type="button" onClick={() => setFields((fs) => [...fs, newField(t.type)])}
            className="rounded border border-gray-400 px-3 py-1 text-sm">+ {t.name}</button>
        ))}
      </div>

      {error && <p role="alert" className="mb-3 font-medium text-red-700">Error: {error}</p>}
      {notice && <p role="status" className="mb-3 font-medium text-green-800">{notice}</p>}

      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={saveDraft} disabled={busy} className="rounded border border-gray-500 px-4 py-2 disabled:opacity-60">
          {status === 'published' ? 'Save changes' : 'Save draft'}
        </button>
        {status !== 'published' && (
          <button type="button" onClick={publish} disabled={busy} className="rounded bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-60">
            Publish
          </button>
        )}
        {status === 'published' && (
          <button type="button" onClick={unpublish} disabled={busy} className="rounded border border-red-700 px-4 py-2 text-red-800 disabled:opacity-60">
            Unpublish
          </button>
        )}
      </div>

      {status === 'published' && shareUrl && (
        <section className="mt-6 rounded border border-green-700 bg-green-50 p-4">
          <label htmlFor="share-url" className="block text-sm font-medium">Share this link with respondents</label>
          <div className="mt-1 flex gap-2">
            <input id="share-url" readOnly value={shareUrl} className="w-full rounded border border-gray-400 bg-white px-3 py-2" />
            <button type="button" onClick={copyLink} className="rounded border border-gray-500 px-3 py-2">Copy link</button>
          </div>
        </section>
      )}
    </main>
  );
}
