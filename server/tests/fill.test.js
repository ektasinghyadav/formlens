// Respondent-side API tests. Requirements: FR-2.1-2.3, FR-4.1, FR-3.2 (form_submitted), NFR-3.2. (Sprint 3)
// Real dfua database, throwaway admin (test-fill-...), everything deleted afterwards.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import app from '../app.js';
import pool from '../db/connection.js';
import { UPLOAD_DIR } from '../middleware/upload.js';

const run = Date.now();
const email = `test-fill-${run}@example.test`;
const password = 'correct horse battery';
const api = (method, url) => request(app)[method](`/api/v1${url}`);
const uploaded = [];

let token, formId, shareLink, f; // f = fields by short name

const auth = (r) => r.set('Authorization', `Bearer ${token}`);
const newSession = async (id = formId) => (await api('post', '/sessions').send({ form_id: id })).body.session_id;
const answers = (over = {}) => {
  const base = { name: 'Asha', email: 'asha@example.com', age: '30', city: 'Tezpur' };
  return Object.entries({ ...base, ...over })
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ({ field_id: f[k].field_id, value: v }));
};
const submit = (sessionId, responses, id = formId) => api('post', `/forms/${id}/submit`).send({ session_id: sessionId, responses });
const count = async (sql, params) => (await pool.query(sql, params))[0][0].n;

beforeAll(async () => {
  await api('post', '/auth/register').send({ email, password });
  token = (await api('post', '/auth/login').send({ email, password })).body.token;
  formId = (await auth(api('post', '/forms')).send({
    title: 'Fill me',
    fields: [
      { field_type: 'text', label: 'Name', is_required: true },
      { field_type: 'email', label: 'Email' },
      { field_type: 'number', label: 'Age' },
      { field_type: 'dropdown', label: 'City', validations: { options: ['Tezpur', 'Guwahati'] } },
      { field_type: 'file', label: 'Resume', validations: { maxFileSizeMB: 1 } },
      { field_type: 'file', label: 'Photo', validations: { maxFileSizeMB: 1 } },
    ],
  })).body.form_id;
  const fields = (await auth(api('get', `/forms/${formId}`))).body.fields;
  f = { name: fields[0], email: fields[1], age: fields[2], city: fields[3], resume: fields[4], photo: fields[5] };
  shareLink = (await auth(api('patch', `/forms/${formId}/publish`))).body.share_link;
});

afterAll(async () => {
  // MySQL cannot DELETE from a table while selecting from it, so look the form ids up first
  const [rows] = await pool.query("SELECT form_id FROM forms WHERE admin_id IN (SELECT admin_id FROM admins WHERE email LIKE 'test-fill-%@example.test')");
  const ids = rows.map((r) => r.form_id);
  const forms = ids.length ? `(${ids.map((i) => `'${i}'`).join(',')})` : "('none')";
  await pool.query(`DELETE FROM field_responses WHERE submission_id IN (SELECT submission_id FROM submissions WHERE form_id IN ${forms})`);
  await pool.query(`DELETE FROM submissions WHERE form_id IN ${forms}`);
  await pool.query(`DELETE FROM events WHERE form_id IN ${forms}`);
  await pool.query(`DELETE FROM sessions WHERE form_id IN ${forms}`);
  await pool.query(`DELETE FROM fields WHERE form_id IN ${forms}`);
  await pool.query(`DELETE FROM forms WHERE form_id IN ${forms}`);
  await pool.query("DELETE FROM admins WHERE email LIKE 'test-fill-%@example.test'");
  for (const name of uploaded) await rm(`${UPLOAD_DIR}${name}`, { force: true });
  await pool.end();
});

describe('GET /forms/:shareLink/public (FR-2.1)', () => {
  it('shows a published form to anyone, without owner data', async () => {
    const res = await api('get', `/forms/${shareLink}/public`); // no Authorization header
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Fill me');
    expect(res.body.fields).toHaveLength(6);
    expect(Object.keys(res.body).sort()).toEqual(['fields', 'form_id', 'title']);
    expect(JSON.stringify(res.body)).not.toMatch(/admin_id|test-fill|share_link/);
  });

  it('answers 404 for an unknown link', async () => {
    expect((await api('get', '/forms/not-a-real-link/public')).status).toBe(404);
  });
});

describe('POST /sessions', () => {
  it('starts an active session and stores only a hash of the IP (D-11, NFR-3.2)', async () => {
    const res = await api('post', '/sessions').send({ form_id: formId });
    expect(res.status).toBe(201);
    const [[row]] = await pool.query('SELECT status, ip_hash, ended_at FROM sessions WHERE session_id = ?', [res.body.session_id]);
    expect(row.status).toBe('active');
    expect(row.ended_at).toBeNull();
    expect(row.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.ip_hash).not.toContain('127.0.0.1');
  });

  it('refuses a form that does not exist or is a draft', async () => {
    expect((await api('post', '/sessions').send({ form_id: randomUUID() })).status).toBe(404);
    expect((await api('post', '/sessions').send({})).status).toBe(404);
    const draft = (await auth(api('post', '/forms')).send({ title: 'Draft', fields: [{ field_type: 'text', label: 'x' }] })).body.form_id;
    expect((await api('post', '/sessions').send({ form_id: draft })).status).toBe(404);
  });
});

describe('POST /forms/:formId/submit (FR-2.3, FR-4.1)', () => {
  it('saves the submission, the answers, closes the session and writes form_submitted once', async () => {
    const sid = await newSession();
    const res = await submit(sid, answers({ email: '' })); // optional email left blank
    expect(res.status).toBe(201);

    expect(await count('SELECT COUNT(*) n FROM submissions WHERE session_id = ?', [sid])).toBe(1);
    const [vals] = await pool.query(
      'SELECT fr.value, fi.label FROM field_responses fr JOIN fields fi ON fi.field_id = fr.field_id WHERE fr.submission_id = ? ORDER BY fi.position',
      [res.body.submission_id]
    );
    expect(vals.map((v) => `${v.label}=${v.value}`)).toEqual(['Name=Asha', 'Age=30', 'City=Tezpur']); // blank email not stored
    const [[sess]] = await pool.query('SELECT status, ended_at FROM sessions WHERE session_id = ?', [sid]);
    expect(sess.status).toBe('submitted');
    expect(sess.ended_at).not.toBeNull();
    const [events] = await pool.query('SELECT event_type, field_id FROM events WHERE session_id = ?', [sid]);
    expect(events).toEqual([{ event_type: 'form_submitted', field_id: null }]);
  });

  it('blocks a second submit of the same session (409) and keeps one submission', async () => {
    const sid = await newSession();
    expect((await submit(sid, answers())).status).toBe(201);
    expect((await submit(sid, answers())).status).toBe(409);
    expect(await count('SELECT COUNT(*) n FROM submissions WHERE session_id = ?', [sid])).toBe(1);
  });

  it('lets exactly one of two simultaneous submits through', async () => {
    const sid = await newSession();
    const [a, b] = await Promise.all([submit(sid, answers()), submit(sid, answers())]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await count('SELECT COUNT(*) n FROM submissions WHERE session_id = ?', [sid])).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM events WHERE session_id = ? AND event_type = 'form_submitted'", [sid])).toBe(1);
  });

  it.each([
    ['a missing required field', { name: '' }, 'name'],
    ['a required field not sent at all', { name: undefined }, 'name'],
    ['an invalid email', { email: 'not-an-email' }, 'email'],
    ['a non-number', { age: 'abc' }, 'age'],
    ['a dropdown value that is not an option', { city: 'Mumbai' }, 'city'],
    ['an over-long answer', { name: 'x'.repeat(5001) }, 'name'],
  ])('rejects %s with 400, a message on that field, and saves nothing', async (label, over, key) => {
    const sid = await newSession();
    const res = await submit(sid, answers(over));
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors[f[key].field_id]).toBeTruthy();
    expect(await count('SELECT COUNT(*) n FROM submissions WHERE session_id = ?', [sid])).toBe(0);
    expect((await pool.query('SELECT status FROM sessions WHERE session_id = ?', [sid]))[0][0].status).toBe('active');
  });

  it('reports every bad field at once, and the respondent can then fix and resubmit', async () => {
    const sid = await newSession();
    const bad = await submit(sid, answers({ name: '', email: 'x', age: 'y' }));
    expect(Object.keys(bad.body.fieldErrors)).toHaveLength(3);
    expect((await submit(sid, answers())).status).toBe(201);
  });

  it('rejects unknown or repeated fields, unknown sessions, and sessions of another form', async () => {
    const sid = await newSession();
    expect((await submit(sid, [...answers(), { field_id: randomUUID(), value: 'x' }])).status).toBe(400);
    expect((await submit(sid, [...answers(), { field_id: f.name.field_id, value: 'again' }])).status).toBe(400);
    expect((await submit(randomUUID(), answers())).status).toBe(404);

    const other = (await auth(api('post', '/forms')).send({ title: 'Other', fields: [{ field_type: 'text', label: 'x' }] })).body.form_id;
    await auth(api('patch', `/forms/${other}/publish`));
    expect((await submit(sid, answers(), other)).status).toBe(404); // session belongs to a different form
  });

  it('refuses a submit once the form is unpublished (FR-1.4 link stops working)', async () => {
    const id = (await auth(api('post', '/forms')).send({ title: 'Soon gone', fields: [{ field_type: 'text', label: 'x' }] })).body.form_id;
    const link = (await auth(api('patch', `/forms/${id}/publish`))).body.share_link;
    const sid = await newSession(id);
    await auth(api('patch', `/forms/${id}/unpublish`));
    expect((await api('get', `/forms/${link}/public`)).status).toBe(404);
    expect((await api('post', '/sessions').send({ form_id: id })).status).toBe(404);
    const fieldId = (await auth(api('get', `/forms/${id}`))).body.fields[0].field_id;
    expect((await submit(sid, [{ field_id: fieldId, value: 'hi' }], id)).status).toBe(404);
  });
});

describe('file upload (D-1, FR-1.2)', () => {
  const upload = (fieldId, size = 100) =>
    api('post', `/forms/${formId}/upload`).query({ field_id: fieldId }).attach('file', Buffer.alloc(size, 'a'), 'cv.pdf');

  it('stores a file under "<field_id>-<uuid>" and accepts that reference on submit', async () => {
    const up = await upload(f.resume.field_id);
    expect(up.status).toBe(201);
    uploaded.push(up.body.file_ref);
    expect(up.body.file_ref.startsWith(`${f.resume.field_id}-`)).toBe(true);

    const sid = await newSession();
    const res = await submit(sid, [...answers(), { field_id: f.resume.field_id, value: up.body.file_ref }]);
    expect(res.status).toBe(201);
    const [[row]] = await pool.query('SELECT value FROM field_responses WHERE submission_id = ? AND field_id = ?', [res.body.submission_id, f.resume.field_id]);
    expect(row.value).toBe(up.body.file_ref);
  });

  it('rejects a file larger than the field limit with 400', async () => {
    const res = await upload(f.resume.field_id, 2 * 1024 * 1024);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('too large');
  });

  it('refuses uploads for non-file fields and unknown fields', async () => {
    expect((await upload(f.name.field_id)).status).toBe(404);
    expect((await upload(randomUUID())).status).toBe(404);
  });

  it('refuses a made-up reference, a missing file, and a reference from a different field', async () => {
    const sid = await newSession();
    const fake = `${f.resume.field_id}-${randomUUID()}`; // right shape, file does not exist
    expect((await submit(sid, [...answers(), { field_id: f.resume.field_id, value: fake }])).status).toBe(400);
    expect((await submit(sid, [...answers(), { field_id: f.resume.field_id, value: '../../etc/passwd' }])).status).toBe(400);

    const photoUp = await upload(f.photo.field_id);
    uploaded.push(photoUp.body.file_ref);
    const swapped = await submit(sid, [...answers(), { field_id: f.resume.field_id, value: photoUp.body.file_ref }]);
    expect(swapped.status).toBe(400); // a Photo upload cannot be passed off as the Resume
  });
});

describe('phone and strict email formats', () => {
  it('the server enforces a 10-digit phone and a real-looking email even if the browser is bypassed', async () => {
    const id = (await auth(api('post', '/forms')).send({
      title: 'Phone form',
      fields: [{ field_type: 'text', label: 'Phone', validations: { format: 'phone' } }, { field_type: 'email', label: 'Mail' }],
    })).body.form_id;
    await auth(api('patch', `/forms/${id}/publish`));
    const [phone, mail] = (await auth(api('get', `/forms/${id}`))).body.fields;
    const answer = (p, m) => [{ field_id: phone.field_id, value: p }, { field_id: mail.field_id, value: m }];

    for (const [p, m] of [['98765', 'a@b.co'], ['98765 43210', 'a@b.co'], ['9876543210', 'a@b'], ['9876543210', 'a@b.c']]) {
      const res = await submit(await newSession(id), answer(p, m), id);
      expect(res.status, `${p} / ${m}`).toBe(400);
    }
    const bad = await submit(await newSession(id), answer('12345', 'a@b.co'), id);
    expect(bad.body.fieldErrors[phone.field_id]).toMatch(/10-digit/);
    expect((await submit(await newSession(id), answer('9876543210', 'asha@example.com'), id)).status).toBe(201);
  });

  it('refuses an unknown text format when the form is saved', async () => {
    const res = await auth(api('post', '/forms')).send({ title: 'x', fields: [{ field_type: 'text', label: 'P', validations: { format: 'pincode' } }] });
    expect(res.status).toBe(400);
  });
});
