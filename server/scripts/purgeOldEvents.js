// scripts/purgeOldEvents.js - deletes interaction events older than the retention period.
// Requirement: FR-4.2 (keep event data for a configurable period; decision D-6: the period is
// the EVENT_RETENTION_DAYS setting in .env, default 180).
// Usage:   npm run purge -- --dry-run         (only COUNT what would be deleted)
//          npm run purge                      (delete events older than EVENT_RETENTION_DAYS)
//          npm run purge -- --days 365        (override the setting for this run)
// Only the `events` table is touched. Sessions, submissions and answers are kept, so the
// totals (views, completions) stay correct; only the fine-grained timings expire.
import { fileURLToPath } from 'node:url';

const DAY = 24 * 60 * 60 * 1000;

// Deletes (or, with dryRun, only counts) events whose timestamp is before `now - days`.
// Deletes in batches so a big purge never holds a long lock on the table.
export async function purgeOldEvents(db, { days, dryRun = false, now = new Date(), batchSize = 5000 }) {
  if (!Number.isInteger(days) || days < 1) throw new Error('days must be a whole number of at least 1');
  const cutoff = new Date(now.getTime() - days * DAY);
  const [[{ n }]] = await db.query('SELECT COUNT(*) AS n FROM events WHERE timestamp < ?', [cutoff]);
  if (dryRun) return { days, cutoff, matched: n, deleted: 0, dryRun: true };

  let deleted = 0;
  for (;;) {
    const [result] = await db.query('DELETE FROM events WHERE timestamp < ? LIMIT ?', [cutoff, batchSize]);
    deleted += result.affectedRows;
    if (result.affectedRows < batchSize) break;
  }
  return { days, cutoff, matched: n, deleted, dryRun: false };
}

// Run from the command line: `npm run purge`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { default: pool } = await import('../db/connection.js');
  const daysArg = process.argv.indexOf('--days');
  const days = daysArg > -1 ? Number(process.argv[daysArg + 1]) : Number(process.env.EVENT_RETENTION_DAYS || 180);
  const dryRun = process.argv.includes('--dry-run');
  try {
    const r = await purgeOldEvents(pool, { days, dryRun });
    console.log(`${dryRun ? 'DRY RUN: would delete' : 'Deleted'} ${dryRun ? r.matched : r.deleted} events older than ${r.days} days (before ${r.cutoff.toISOString()}).`);
  } catch (err) {
    console.error(`Purge not run: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
