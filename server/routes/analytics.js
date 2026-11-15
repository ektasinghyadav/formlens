// routes/analytics.js - the dashboard's numbers over HTTP. Requirements: FR-5.1-5.3, FR-6.2
// (date range), FR-8.1 / FR-8.2 (login + own forms only), NFR-3.1.
// This file is only the "front desk": check who is asking, check the dates, call the engine.
// All the maths lives in modules/analyticsEngine.js (which knows nothing about HTTP).
// (Recommendations are added in Sprint 6.)
import { Router } from 'express';
import pool from '../db/connection.js';
import requireAuth from '../middleware/auth.js';
import requireOwnership from '../middleware/ownership.js';
import { getSummary, getFunnel, getFieldMetrics } from '../modules/analyticsEngine.js';

const router = Router();
const owner = [requireAuth, requireOwnership]; // login first, then "is this your form?" (FR-8.2)

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

// "2026-11-10" or a full ISO time. A date-only `to` means the END of that day, so that
// from=2026-11-10&to=2026-11-10 shows one whole day. Returns { date } or { error }.
function parseBound(value, name, endOfDay) {
  if (value === undefined || value === '') return { date: null };
  if (typeof value !== 'string') return { error: `${name} must be a date` };
  let date;
  if (DATE_ONLY.test(value)) date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  else if (DATE_TIME.test(value)) date = new Date(value);
  else return { error: `${name} must look like 2026-11-10 or 2026-11-10T09:30:00Z` };
  if (Number.isNaN(date.getTime()) || !isRealCalendarDay(value.slice(0, 10))) return { error: `${name} is not a real date` };
  return { date };
}

// JavaScript quietly turns 2026-02-31 into March 3, so check the day really exists.
function isRealCalendarDay(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d;
}

function readRange(req, res, next) {
  const from = parseBound(req.query.from, 'from', false);
  const to = parseBound(req.query.to, 'to', true);
  const error = from.error || to.error;
  if (error) return res.status(400).json({ error });
  if (from.date && to.date && from.date > to.date) return res.status(400).json({ error: 'from must not be after to' });
  req.range = { from: from.date, to: to.date };
  next();
}

// Passing `pool` is what makes the engine "pure": it never creates its own connection.
router.get('/:formId/summary', ...owner, readRange, async (req, res) => {
  res.json(await getSummary(pool, req.form.form_id, req.range));
});
router.get('/:formId/funnel', ...owner, readRange, async (req, res) => {
  res.json(await getFunnel(pool, req.form.form_id, req.range));
});
router.get('/:formId/fields', ...owner, readRange, async (req, res) => {
  res.json(await getFieldMetrics(pool, req.form.form_id, req.range));
});

export default router;
