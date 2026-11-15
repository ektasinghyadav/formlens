// routes/forms.js - admin form management. Requirements: FR-1.1-1.4, FR-8.2.
// (Public respondent endpoints on /forms/:shareLink/public etc. arrive in Sprint 3.)
import { Router } from 'express';
import { randomUUID, randomBytes } from 'node:crypto';
import pool from '../db/connection.js';
import requireAuth from '../middleware/auth.js';
import requireOwnership from '../middleware/ownership.js';

const router = Router();

// Rules (D-17)
const FIELD_TYPES = ['text', 'email', 'number', 'dropdown', 'file'];
const MAX_FIELDS = 50;
const DEFAULT_FILE_MB = 5;
const MAX_FILE_MB = 25;

const owner = [requireAuth, requireOwnership]; // every :formId route uses both, in this order

// ---------- validation ----------

// Returns { error } or { value } where value is a clean copy containing only what we allow.
function cleanField(raw, index) {
  const where = `Field ${index + 1}`;
  if (!raw || typeof raw !== 'object') return { error: `${where} is invalid` };
  if (!FIELD_TYPES.includes(raw.field_type)) return { error: `${where}: type must be one of ${FIELD_TYPES.join(', ')}` };
  const label = typeof raw.label === 'string' ? raw.label.trim() : '';
  if (!label || label.length > 255) return { error: `${where}: label is required (max 255 characters)` };

  const v = raw.validations && typeof raw.validations === 'object' ? raw.validations : {};
  let validations = null;

  if (raw.field_type === 'text' && v.format !== undefined && v.format !== null && v.format !== '') {
    if (!['email', 'number'].includes(v.format)) return { error: `${where}: format must be email or number` };
    validations = { format: v.format };
  }
  if (raw.field_type === 'dropdown') {
    const options = Array.isArray(v.options) ? v.options.map((o) => (typeof o === 'string' ? o.trim() : '')) : [];
    if (options.length < 2 || options.length > 50 || options.some((o) => !o || o.length > 255)) {
      return { error: `${where}: a dropdown needs 2-50 non-empty options` };
    }
    if (new Set(options).size !== options.length) return { error: `${where}: dropdown options must be different` };
    validations = { options };
  }
  if (raw.field_type === 'file') {
    const mb = v.maxFileSizeMB === undefined ? DEFAULT_FILE_MB : Number(v.maxFileSizeMB);
    if (!(mb > 0) || mb > MAX_FILE_MB) return { error: `${where}: max file size must be between 0 and ${MAX_FILE_MB} MB` };
    validations = { maxFileSizeMB: mb };
  }

  return {
    value: {
      field_id: typeof raw.field_id === 'string' ? raw.field_id : null,
      field_type: raw.field_type,
      label,
      is_required: raw.is_required === true,
      validations,
    },
  };
}

function cleanFormInput(body) {
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > 255) return { error: 'Title is required (max 255 characters)' };
  const rawFields = body.fields === undefined ? [] : body.fields;
  if (!Array.isArray(rawFields) || rawFields.length > MAX_FIELDS) {
    return { error: `Fields must be a list of at most ${MAX_FIELDS}` };
  }
  const fields = [];
  for (let i = 0; i < rawFields.length; i++) {
    const r = cleanField(rawFields[i], i);
    if (r.error) return { error: r.error };
    fields.push(r.value);
  }
  return { title, fields };
}

// ---------- shaping what we send back ----------

const shareUrl = (link) => (link ? `${process.env.CLIENT_ORIGIN}/f/${link}` : null);

function formSummary(f) {
  return {
    form_id: f.form_id,
    title: f.title,
    status: f.status,
    share_link: f.share_link,
    share_url: shareUrl(f.share_link),
    created_at: f.created_at,
    published_at: f.published_at,
  };
}

async function loadFields(db, formId) {
  const [rows] = await db.query(
    'SELECT field_id, field_type, label, is_required, position, validations FROM fields WHERE form_id = ? ORDER BY position',
    [formId]
  );
  return rows.map((r) => ({ ...r, is_required: Boolean(r.is_required) })); // MySQL gives 0/1
}

async function fullForm(db, form) {
  return { ...formSummary(form), fields: await loadFields(db, form.form_id) };
}

// ---------- endpoints ----------

// GET /forms - this admin's forms only (the WHERE admin_id = ? is the isolation, FR-8.2)
router.get('/', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM forms WHERE admin_id = ? ORDER BY created_at DESC', [req.adminId]);
  res.json(rows.map(formSummary));
});

// POST /forms - create a draft form with its fields (one transaction: all or nothing)
router.post('/', requireAuth, async (req, res) => {
  const input = cleanFormInput(req.body);
  if (input.error) return res.status(400).json({ error: input.error });

  const formId = randomUUID();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('INSERT INTO forms (form_id, admin_id, title) VALUES (?, ?, ?)', [formId, req.adminId, input.title]);
    for (let i = 0; i < input.fields.length; i++) {
      await insertField(conn, formId, input.fields[i], i);
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  res.status(201).json({ form_id: formId });
});

function insertField(conn, formId, f, position) {
  return conn.query(
    'INSERT INTO fields (field_id, form_id, field_type, label, is_required, position, validations) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [randomUUID(), formId, f.field_type, f.label, f.is_required, position, f.validations && JSON.stringify(f.validations)]
  );
}

// GET /forms/:formId
router.get('/:formId', ...owner, async (req, res) => {
  res.json(await fullForm(pool, req.form));
});

// PUT /forms/:formId - update title and replace the field list (D-17a)
router.put('/:formId', ...owner, async (req, res) => {
  const input = cleanFormInput(req.body);
  if (input.error) return res.status(400).json({ error: input.error });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query('SELECT field_id FROM fields WHERE form_id = ?', [req.form.form_id]);
    const existingIds = new Set(existing.map((r) => r.field_id));

    // a field_id sent back must belong to THIS form and appear only once
    const sentIds = input.fields.map((f) => f.field_id).filter(Boolean);
    if (sentIds.some((id) => !existingIds.has(id)) || new Set(sentIds).size !== sentIds.length) {
      await conn.rollback();
      return res.status(400).json({ error: 'A field does not belong to this form' });
    }

    await conn.query('UPDATE forms SET title = ? WHERE form_id = ?', [input.title, req.form.form_id]);

    const removed = [...existingIds].filter((id) => !sentIds.includes(id));
    if (removed.length) {
      try {
        await conn.query('DELETE FROM fields WHERE field_id IN (?)', [removed]);
      } catch (err) {
        if (err.code === 'ER_ROW_IS_REFERENCED_2') {
          await conn.rollback();
          return res.status(409).json({ error: 'A field with recorded responses or events cannot be deleted' });
        }
        throw err;
      }
    }

    for (let i = 0; i < input.fields.length; i++) {
      const f = input.fields[i];
      if (f.field_id) {
        await conn.query(
          'UPDATE fields SET field_type = ?, label = ?, is_required = ?, position = ?, validations = ? WHERE field_id = ?',
          [f.field_type, f.label, f.is_required, i, f.validations && JSON.stringify(f.validations), f.field_id]
        );
      } else {
        await insertField(conn, req.form.form_id, f, i);
      }
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const [rows] = await pool.query('SELECT * FROM forms WHERE form_id = ?', [req.form.form_id]);
  res.json(await fullForm(pool, rows[0]));
});

// PATCH /forms/:formId/publish - make the form public; create the link the first time (FR-1.3)
router.patch('/:formId/publish', ...owner, async (req, res) => {
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM fields WHERE form_id = ?', [req.form.form_id]);
  if (n === 0) return res.status(409).json({ error: 'Add at least one field before publishing' });

  // 12 random bytes -> 16 URL-safe characters: 96 bits, not guessable
  const link = req.form.share_link || randomBytes(12).toString('base64url');
  await pool.query(
    "UPDATE forms SET status = 'published', share_link = ?, published_at = COALESCE(published_at, NOW()) WHERE form_id = ?",
    [link, req.form.form_id]
  );
  const [rows] = await pool.query('SELECT * FROM forms WHERE form_id = ?', [req.form.form_id]);
  res.json(formSummary(rows[0]));
});

// PATCH /forms/:formId/unpublish - the link stops working (status check in Sprint 3)
router.patch('/:formId/unpublish', ...owner, async (req, res) => {
  if (req.form.status !== 'published') return res.status(409).json({ error: 'Form is not published' });
  await pool.query("UPDATE forms SET status = 'unpublished' WHERE form_id = ?", [req.form.form_id]);
  const [rows] = await pool.query('SELECT * FROM forms WHERE form_id = ?', [req.form.form_id]);
  res.json(formSummary(rows[0]));
});

export default router;
