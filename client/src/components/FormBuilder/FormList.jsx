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
    <main className="mx-auto max-w-4xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Your forms</h1>
        <Link to="/admin/forms/new/edit" className="rounded bg-blue-700 px-4 py-2 font-medium text-white">New form</Link>
      </div>

      {error && <p role="alert" className="mb-3 font-medium text-red-700">Error: {error}</p>}
      {notice && <p role="status" className="mb-3 font-medium text-green-800">{notice}</p>}
      {forms === null && <p>Loading…</p>}
      {forms && forms.length === 0 && !error && <p className="text-gray-600">You have no forms yet. Click "New form" to make one.</p>}

      {forms && forms.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2">Title</th><th>Status</th><th>Created</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {forms.map((f) => (
              <tr key={f.form_id} className="border-b align-top">
                <td className="py-2 font-medium">{f.title}</td>
                <td>{STATUS_TEXT[f.status]}</td>
                <td>{new Date(f.created_at).toLocaleDateString()}</td>
                <td className="flex flex-wrap gap-2 py-2">
                  <Link to={`/admin/forms/${f.form_id}/edit`} className="text-blue-800 underline">Edit</Link>
                  {f.status !== 'published' && (
                    <button type="button" onClick={() => change(publishForm, f.form_id)} className="text-blue-800 underline">Publish</button>
                  )}
                  {f.status === 'published' && (
                    <>
                      <button type="button" onClick={() => change(unpublishForm, f.form_id)} className="text-blue-800 underline">Unpublish</button>
                      <button type="button" onClick={() => copy(f.share_url)} className="text-blue-800 underline">Copy link</button>
                    </>
                  )}
                  <Link to={`/admin/forms/${f.form_id}/dashboard`} className="text-blue-800 underline">Dashboard</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
