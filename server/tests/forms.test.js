// Form API tests. Requirements: FR-1.1-1.4, FR-8.1, FR-8.2. (Sprint 2)
// Real dfua database, throwaway admins (test-forms-...), everything deleted afterwards.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import app from '../app.js';
import pool from '../db/connection.js';

const run = Date.now();
const password = 'correct horse battery';
const api = (method, url, token) => {
  const r = request(app)[method](`/api/v1${url}`);
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};

async function newAdmin(tag) {
  const email = `test-forms-${tag}-${run}@example.test`;
  await request(app).post('/api/v1/auth/register').send({ email, password });
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  return res.body.token;
}

const fiveFields = [
  { field_type: 'text', label: 'Full name', is_required: true },
  { field_type: 'email', label: 'Email' },
  { field_type: 'number', label: 'Age' },
  { field_type: 'dropdown', label: 'City', validations: { options: ['Tezpur', 'Guwahati'] } },
  { field_type: 'file', label: 'Resume' },
];

let tokenA, tokenB;

beforeAll(async () => {
  tokenA = await newAdmin('a');
  tokenB = await newAdmin('b');
});

afterAll(async () => {
  // delete children before parents (foreign keys)
  const where = "(SELECT admin_id FROM admins WHERE email LIKE 'test-forms-%@example.test')";
  const forms = `(SELECT form_id FROM forms WHERE admin_id IN ${where})`;
  await pool.query(`DELETE FROM events WHERE form_id IN ${forms}`);
  await pool.query(`DELETE FROM sessions WHERE form_id IN ${forms}`);
  await pool.query(`DELETE FROM fields WHERE form_id IN ${forms}`);
  await pool.query(`DELETE FROM forms WHERE admin_id IN ${where}`);
  await pool.query("DELETE FROM admins WHERE email LIKE 'test-forms-%@example.test'");
  await pool.end();
});

describe('authentication (FR-8.1)', () => {
  it('every form endpoint returns 401 without a token', async () => {
    const id = randomUUID();
    const calls = [
      api('get', '/forms'), api('post', '/forms'), api('get', `/forms/${id}`), api('put', `/forms/${id}`),
      api('patch', `/forms/${id}/publish`), api('patch', `/forms/${id}/unpublish`),
    ];
    for (const r of calls) expect((await r).status).toBe(401);
  });
});

describe('create and read (FR-1.1, FR-1.2)', () => {
  let formId;

  it('creates a form with all five field types, in order, with defaults filled in', async () => {
    const res = await api('post', '/forms', tokenA).send({ title: '  Job application  ', fields: fiveFields });
    expect(res.status).toBe(201);
    formId = res.body.form_id;

    const got = (await api('get', `/forms/${formId}`, tokenA)).body;
    expect(got.title).toBe('Job application'); // trimmed
    expect(got.status).toBe('draft');
    expect(got.share_link).toBeNull();
    expect(got.fields.map((f) => f.field_type)).toEqual(['text', 'email', 'number', 'dropdown', 'file']);
    expect(got.fields.map((f) => f.position)).toEqual([0, 1, 2, 3, 4]);
    expect(got.fields[0].is_required).toBe(true);
    expect(got.fields[1].is_required).toBe(false);
    expect(got.fields[3].validations).toEqual({ options: ['Tezpur', 'Guwahati'] });
    expect(got.fields[4].validations).toEqual({ maxFileSizeMB: 5 }); // default
  });

  it.each([
    ['empty title', { title: ' ', fields: [] }],
    ['unknown field type', { title: 'x', fields: [{ field_type: 'date', label: 'When' }] }],
    ['empty label', { title: 'x', fields: [{ field_type: 'text', label: '  ' }] }],
    ['dropdown with one option', { title: 'x', fields: [{ field_type: 'dropdown', label: 'd', validations: { options: ['a'] } }] }],
    ['dropdown with duplicate options', { title: 'x', fields: [{ field_type: 'dropdown', label: 'd', validations: { options: ['a', 'a'] } }] }],
    ['file size of 0', { title: 'x', fields: [{ field_type: 'file', label: 'f', validations: { maxFileSizeMB: 0 } }] }],
    ['file size too large', { title: 'x', fields: [{ field_type: 'file', label: 'f', validations: { maxFileSizeMB: 100 } }] }],
    ['bad text format', { title: 'x', fields: [{ field_type: 'text', label: 't', validations: { format: 'phone' } }] }],
    ['too many fields', { title: 'x', fields: Array.from({ length: 51 }, () => ({ field_type: 'text', label: 't' })) }],
  ])('rejects %s with 400 and saves nothing', async (name, body) => {
    const before = (await api('get', '/forms', tokenA)).body.length;
    expect((await api('post', '/forms', tokenA).send(body)).status).toBe(400);
    expect((await api('get', '/forms', tokenA)).body.length).toBe(before);
  });

  it('lists only the logged-in admin\'s forms', async () => {
    const a = (await api('get', '/forms', tokenA)).body;
    const b = (await api('get', '/forms', tokenB)).body;
    expect(a.some((f) => f.form_id === formId)).toBe(true);
    expect(b.some((f) => f.form_id === formId)).toBe(false);
  });
});

describe('edit (FR-1.4)', () => {
  it('keeps ids of kept fields, adds new ones, drops removed ones, and follows the new order', async () => {
    const { body: { form_id } } = await api('post', '/forms', tokenA).send({ title: 'Edit me', fields: fiveFields.slice(0, 3) });
    const before = (await api('get', `/forms/${form_id}`, tokenA)).body.fields;

    const res = await api('put', `/forms/${form_id}`, tokenA).send({
      title: 'Edited',
      fields: [
        { ...before[2], label: 'Age in years' },               // moved to first, renamed
        { field_type: 'text', label: 'Brand new field' },        // new
        { ...before[0] },                                        // kept, now last
      ],                                                         // before[1] (email) removed
    });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Edited');
    const after = res.body.fields;
    expect(after.map((f) => f.label)).toEqual(['Age in years', 'Brand new field', 'Full name']);
    expect(after.map((f) => f.position)).toEqual([0, 1, 2]);
    expect(after[0].field_id).toBe(before[2].field_id);
    expect(after[2].field_id).toBe(before[0].field_id);
    expect(after.some((f) => f.field_id === before[1].field_id)).toBe(false);
  });

  it('rejects a field id that belongs to another form', async () => {
    const f1 = (await api('post', '/forms', tokenA).send({ title: 'one', fields: [fiveFields[0]] })).body.form_id;
    const f2 = (await api('post', '/forms', tokenA).send({ title: 'two', fields: [fiveFields[1]] })).body.form_id;
    const foreign = (await api('get', `/forms/${f2}`, tokenA)).body.fields[0];
    const res = await api('put', `/forms/${f1}`, tokenA).send({ title: 'one', fields: [foreign] });
    expect(res.status).toBe(400);
  });

  it('archives a removed field that has recorded events instead of deleting it (D-25)', async () => {
    const { body: { form_id } } = await api('post', '/forms', tokenA).send({ title: 'Has data', fields: fiveFields.slice(0, 3) });
    const fields = (await api('get', `/forms/${form_id}`, tokenA)).body.fields;
    const sessionId = randomUUID();
    await pool.query('INSERT INTO sessions (session_id, form_id, ip_hash) VALUES (?, ?, ?)', [sessionId, form_id, 'x'.repeat(64)]);
    await pool.query(
      "INSERT INTO events (event_id, session_id, field_id, form_id, event_type, timestamp) VALUES (?, ?, ?, ?, 'focus', NOW(3))",
      [randomUUID(), sessionId, fields[1].field_id, form_id]
    );

    // remove field 1 (has data) and field 2 (no data)
    const res = await api('put', `/forms/${form_id}`, tokenA).send({ title: 'Renamed', fields: [fields[0]] });
    expect(res.status).toBe(200);
    const now = (await api('get', `/forms/${form_id}`, tokenA)).body;
    expect(now.title).toBe('Renamed');
    expect(now.fields.map((f) => f.field_id)).toEqual([fields[0].field_id]); // editor and respondents see one field
    const [rows] = await pool.query('SELECT field_id, archived_at FROM fields WHERE form_id = ?', [form_id]);
    expect(rows.map((r) => r.field_id)).toEqual(expect.arrayContaining([fields[0].field_id, fields[1].field_id]));
    expect(rows.find((r) => r.field_id === fields[1].field_id).archived_at).not.toBeNull(); // archived, history kept
    expect(rows.some((r) => r.field_id === fields[2].field_id)).toBe(false); // no data: really deleted
    const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM events WHERE field_id = ?', [fields[1].field_id]);
    expect(n).toBe(1);
    // an archived field cannot be sent back in
    expect((await api('put', `/forms/${form_id}`, tokenA).send({ title: 'x', fields: [fields[0], fields[1]] })).status).toBe(400);
  });
});

describe('publish and unpublish (FR-1.3, FR-1.4)', () => {
  it('cannot publish a form with no fields', async () => {
    const { body: { form_id } } = await api('post', '/forms', tokenA).send({ title: 'Empty' });
    expect((await api('patch', `/forms/${form_id}/publish`, tokenA)).status).toBe(409);
  });

  it('publishes with a long URL-safe link, unpublishes, and re-publishes with the same link', async () => {
    const { body: { form_id } } = await api('post', '/forms', tokenA).send({ title: 'Pub', fields: [fiveFields[0]] });

    const pub = await api('patch', `/forms/${form_id}/publish`, tokenA);
    expect(pub.status).toBe(200);
    expect(pub.body.status).toBe('published');
    expect(pub.body.share_link).toMatch(/^[A-Za-z0-9_-]{12,}$/);
    expect(pub.body.share_url).toBe(`${process.env.CLIENT_ORIGIN}/f/${pub.body.share_link}`);
    expect(pub.body.published_at).toBeTruthy();

    const unpub = await api('patch', `/forms/${form_id}/unpublish`, tokenA);
    expect(unpub.body.status).toBe('unpublished');
    expect((await api('get', '/forms', tokenA)).body.find((f) => f.form_id === form_id).status).toBe('unpublished');

    const again = await api('patch', `/forms/${form_id}/publish`, tokenA);
    expect(again.body.share_link).toBe(pub.body.share_link);
  });

  it('two forms never get the same link', async () => {
    const ids = [];
    for (const t of ['L1', 'L2']) {
      const id = (await api('post', '/forms', tokenA).send({ title: t, fields: [fiveFields[0]] })).body.form_id;
      ids.push((await api('patch', `/forms/${id}/publish`, tokenA)).body.share_link);
    }
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('cannot unpublish a draft', async () => {
    const { body: { form_id } } = await api('post', '/forms', tokenA).send({ title: 'Draft', fields: [fiveFields[0]] });
    expect((await api('patch', `/forms/${form_id}/unpublish`, tokenA)).status).toBe(409);
  });
});

describe('ownership (FR-8.2)', () => {
  it("admin B cannot read, edit, publish or unpublish admin A's form - all return 404", async () => {
    const { body: { form_id } } = await api('post', '/forms', tokenA).send({ title: 'A only', fields: [fiveFields[0]] });
    await api('patch', `/forms/${form_id}/publish`, tokenA);

    const attempts = [
      api('get', `/forms/${form_id}`, tokenB),
      api('put', `/forms/${form_id}`, tokenB).send({ title: 'hijacked', fields: [] }),
      api('patch', `/forms/${form_id}/publish`, tokenB),
      api('patch', `/forms/${form_id}/unpublish`, tokenB),
    ];
    for (const r of attempts) expect((await r).status).toBe(404);

    const mine = (await api('get', `/forms/${form_id}`, tokenA)).body;
    expect(mine.title).toBe('A only');       // not changed
    expect(mine.status).toBe('published');   // not unpublished
    expect(mine.fields).toHaveLength(1);
  });

  it('an unknown form id gives the same 404', async () => {
    expect((await api('get', `/forms/${randomUUID()}`, tokenA)).status).toBe(404);
  });
});
