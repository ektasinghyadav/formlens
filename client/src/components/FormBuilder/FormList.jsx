// FormList.jsx - the admin's list of forms. Requirements: FR-1.3, FR-1.4, FR-8.2 (only own forms).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listForms, publishForm, unpublishForm } from '../../api/forms.js';

const STATUS_TEXT = { draft: 'Draft', published: 'Published', unpublished: 'Unpublished' };

export default function FormList() {
  const [forms, setForms] = useState(null); // null = still loading
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function refresh() {
    try {
      const { data } = await listForms();
      setForms(data);
    } catch {
      setError('Could not load your forms.');
      setForms([]);
    }
  }
  useEffect(() => { refresh(); }, []);

  async function change(action, formId) {
    setError('');
    setNotice('');
    try {
      await action(formId);
      await refresh();
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Please try again.');
    }
  }

  async function copy(url) {
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Link copied.');
    } catch {
      setNotice(`Copy this link: ${url}`);
    }
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="kicker">Your workspace</p>
          <h1>Your forms</h1>
        </div>
        <Link to="/admin/forms/new/edit" className="btn">New form</Link>
      </div>

      {error && <p role="alert" className="error" style={{ marginBottom: 12 }}>Error: {error}</p>}
      {notice && <p role="status" className="notice" style={{ marginBottom: 12 }}>{notice}</p>}
      {forms === null && <p className="hint">Loading…</p>}
      {forms && forms.length === 0 && !error && <p className="lede">You have no forms yet. Click "New form" to make one.</p>}

      {forms && forms.length > 0 && (
        <ul className="rows">
          {forms.map((f) => (
            <li key={f.form_id} className="row">
              <div>
                <h2 className="row-title">{f.title}</h2>
                <div className="row-meta">
                  <span className={`status status-${f.status}`}>{STATUS_TEXT[f.status]}</span>
                  <span>Created {new Date(f.created_at).toLocaleDateString()}</span>
                </div>
              </div>
              <div className="row-actions">
                <Link to={`/admin/forms/${f.form_id}/edit`} className="link">Edit</Link>
                {f.status !== 'published' && (
                  <button type="button" onClick={() => change(publishForm, f.form_id)} className="link">Publish</button>
                )}
                {f.status === 'published' && (
                  <>
                    <button type="button" onClick={() => copy(f.share_url)} className="link">Copy link</button>
                    <button type="button" onClick={() => change(unpublishForm, f.form_id)} className="link link-danger">Unpublish</button>
                  </>
                )}
                <Link to={`/admin/forms/${f.form_id}/dashboard`} className="btn btn-quiet btn-small">Dashboard</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
