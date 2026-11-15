// routes/forms.js - admin form management. Requirements: FR-1.1-1.4, FR-8.2.
// Also holds the public respondent endpoints (no login): public form, upload, submit (FR-2.1-2.3, FR-4.1).
import { Router } from 'express';
import { randomUUID, randomBytes } from 'node:crypto';
import { access } from 'node:fs/promises';
import pool from '../db/connection.js';
import { makeUpload, UPLOAD_DIR } from '../middleware/upload.js';
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

// =====================================================================
// PUBLIC respondent endpoints - no login. Only PUBLISHED forms are reachable.
// =====================================================================

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NUMBER_PATTERN = /^-?\d+(\.\d+)?$/;
const MAX_ANSWER_LENGTH = 5000; // D-18c
const FILE_REF_PATTERN = /^[0-9a-f-]{36}-[0-9a-f-]{36}$/; // "<field_id>-<uuid>"

// Checks ONE answer against the field's rules. Returns { value } (null if left empty)
// or { error }. The server never trusts the browser's own checks (FR-2.2, FR-2.3).
async function checkAnswer(field, raw) {
  if (raw !== undefined && raw !== null && typeof raw !== 'string') return { error: 'Invalid answer' };
  const value = (raw ?? '').trim();
  if (value === '') {
    return field.is_required ? { error: 'This field is required' } : { value: null };
  }
  if (value.length > MAX_ANSWER_LENGTH) return { error: `Answer is too long (max ${MAX_ANSWER_LENGTH} characters)` };

  const rules = field.validations || {};
  const format = field.field_type === 'text' ? rules.format : field.field_type;
  if (format === 'email' && !EMAIL_PATTERN.test(value)) return { error: 'Enter a valid email address, like name@example.com' };
  if (format === 'number' && !NUMBER_PATTERN.test(value)) return { error: 'Enter a number, like 42' };
  if (field.field_type === 'dropdown' && !rules.options.includes(value)) return { error: 'Choose one of the listed options' };
  if (field.field_type === 'file') {
    // the value must be a reference we issued for THIS field, and the file must exist
    const ok = FILE_REF_PATTERN.test(value) && value.startsWith(`${field.field_id}-`);
    if (!ok) return { error: 'Upload the file again' };
    try {
      await access(`${UPLOAD_DIR}${value}`);
    } catch {
      return { error: 'Upload the file again' };
    }
  }
  return { value };
}

// GET /forms/:shareLink/public - what the respondent sees. No owner data (admin_id etc.).
router.get('/:shareLink/public', async (req, res) => {
  const [rows] = await pool.query("SELECT form_id, title FROM forms WHERE share_link = ? AND status = 'published'", [
    req.params.shareLink,
  ]);
  if (!rows[0]) return res.status(404).json({ error: 'This form is not available' });
  res.json({ form_id: rows[0].form_id, title: rows[0].title, fields: await loadFields(pool, rows[0].form_id) });
});

// POST /forms/:formId/upload?field_id=... - store one file for a file field (D-1, D-18a)
router.post('/:formId/upload', async (req, res, next) => {
  const [rows] = await pool.query(
    `SELECT f.field_id, f.validations FROM fields f JOIN forms fo ON fo.form_id = f.form_id
     WHERE f.field_id = ? AND f.form_id = ? AND f.field_type = 'file' AND fo.status = 'published'`,
    [String(req.query.field_id || ''), req.params.formId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'This form is not available' });

  req.uploadPrefix = `${rows[0].field_id}-`;
  // the size limit comes from the field's own setting; too big -> 400 (handled inside makeUpload)
  makeUpload(rows[0].validations?.maxFileSizeMB ?? DEFAULT_FILE_MB)(req, res, (err) => {
    if (err) return next(err);
    if (!req.file) return res.status(400).json({ error: 'No file received' });
    res.status(201).json({ file_ref: req.file.filename });
  });
});

// POST /forms/:formId/submit - re-check every rule, then save everything in one transaction.
router.post('/:formId/submit', async (req, res) => {
  const { session_id: sessionId, responses } = req.body || {};
  if (typeof sessionId !== 'string' || !Array.isArray(responses)) {
    return res.status(400).json({ error: 'session_id and responses are required' });
  }
  const [forms] = await pool.query("SELECT form_id FROM forms WHERE form_id = ? AND status = 'published'", [req.params.formId]);
  if (!forms[0]) return res.status(404).json({ error: 'This form is not available' });
  const formId = forms[0].form_id;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // FOR UPDATE locks the session row, so two quick clicks cannot both succeed
    const [sessions] = await conn.query('SELECT status FROM sessions WHERE session_id = ? AND form_id = ? FOR UPDATE', [sessionId, formId]);
    if (!sessions[0]) { await conn.rollback(); return res.status(404).json({ error: 'Session not found' }); }
    // 'abandoned' is allowed: a tab-hide can mark a visit abandoned, and the person may come back and finish
    if (sessions[0].status === 'submitted') { await conn.rollback(); return res.status(409).json({ error: 'This form was already submitted' }); }

    const fields = await loadFields(conn, formId);
    const byId = new Map(fields.map((f) => [f.field_id, f]));
    const answers = new Map();
    for (const r of responses) {
      if (!r || !byId.has(r.field_id) || answers.has(r.field_id)) {
        await conn.rollback();
        return res.status(400).json({ error: 'Unknown or repeated field in responses' });
      }
      answers.set(r.field_id, r.value);
    }

    const fieldErrors = {};
    const clean = [];
    for (const f of fields) {
      const result = await checkAnswer(f, answers.get(f.field_id));
      if (result.error) fieldErrors[f.field_id] = result.error;
      else if (result.value !== null) clean.push({ field_id: f.field_id, value: result.value });
    }
    if (Object.keys(fieldErrors).length) {
      await conn.rollback();
      return res.status(400).json({ error: 'Please correct the highlighted fields', fieldErrors });
    }

    const submissionId = randomUUID();
    await conn.query('INSERT INTO submissions (submission_id, session_id, form_id) VALUES (?, ?, ?)', [submissionId, sessionId, formId]);
    for (const a of clean) {
      await conn.query('INSERT INTO field_responses (response_id, submission_id, field_id, value) VALUES (?, ?, ?, ?)', [
        randomUUID(), submissionId, a.field_id, a.value,
      ]);
    }
    await conn.query("UPDATE sessions SET status = 'submitted', ended_at = NOW() WHERE session_id = ?", [sessionId]);
    // D-4: the server writes form_submitted, in the same transaction, so it can never be duplicated
    await conn.query(
      "INSERT INTO events (event_id, session_id, field_id, form_id, event_type, timestamp) VALUES (?, ?, NULL, ?, 'form_submitted', NOW(3))",
      [randomUUID(), sessionId, formId]
    );
    await conn.commit();
    res.status(201).json({ submission_id: submissionId });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

export default router;
