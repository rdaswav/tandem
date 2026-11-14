// Good moments: a shared log both people can read. Either person can add; only
// the author can edit or remove their own. Removing is a soft delete.
//
// Every function takes ctx first: an object with db, clock and config.

import { addDays, daysBetween, localDate } from './week.js';

export const MAX_MOMENT_LENGTH = 2000;
export const LOG_MIN_AGE_DAYS = 14;
const MIN_YEAR = 2000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Today's date in the configured time zone.
export function todayFor(ctx) {
  return localDate(ctx.clock.now(), ctx.config.tz);
}

function toMoment(row) {
  return {
    id: row.id,
    authorId: row.author_id,
    authorName: row.display_name,
    authorSlot: row.slot,
    happenedOn: row.happened_on,
    body: row.body,
    createdAt: row.created_at,
  };
}

const SELECT = `SELECT m.id, m.author_id, u.display_name, u.slot, m.happened_on, m.body, m.created_at
  FROM moments m JOIN users u ON u.id = m.author_id`;

// Checks and cleans the input. A missing or empty date means today.
function clean(ctx, { happenedOn, body }) {
  if (typeof body !== 'string' || body.trim() === '') return { ok: false, error: 'blank' };
  const text = body.trim();
  if ([...text].length > MAX_MOMENT_LENGTH) return { ok: false, error: 'too_long' };

  const today = todayFor(ctx);
  let date = today;
  if (happenedOn !== undefined && happenedOn !== null && happenedOn !== '') {
    if (typeof happenedOn !== 'string' || !DATE_RE.test(happenedOn.trim())) return { ok: false, error: 'bad_date' };
    date = happenedOn.trim();
    try {
      addDays(date, 0); // throws for a day that does not exist, like 2026-02-30
    } catch {
      return { ok: false, error: 'bad_date' };
    }
    if (Number(date.slice(0, 4)) < MIN_YEAR) return { ok: false, error: 'bad_date' };
    if (date > today) return { ok: false, error: 'future_date' };
  }
  return { ok: true, date, text };
}

export function addMoment(ctx, authorId, input) {
  const cleaned = clean(ctx, input ?? {});
  if (!cleaned.ok) return cleaned;
  const info = ctx.db
    .prepare('INSERT INTO moments (author_id, happened_on, body, created_at) VALUES (?, ?, ?, ?)')
    .run(authorId, cleaned.date, cleaned.text, ctx.clock.now().toISOString());
  return { ok: true, id: Number(info.lastInsertRowid) };
}

// Every moment that has not been removed, newest first.
export function listMoments(ctx) {
  return ctx.db
    .prepare(`${SELECT} WHERE m.deleted_at IS NULL ORDER BY m.happened_on DESC, m.id DESC`)
    .all()
    .map(toMoment);
}

function findLive(ctx, id) {
  const row = ctx.db.prepare(`${SELECT} WHERE m.id = ? AND m.deleted_at IS NULL`).get(id);
  return row ? toMoment(row) : null;
}

export function editMoment(ctx, userId, id, input) {
  const moment = findLive(ctx, id);
  if (!moment) return { ok: false, error: 'not_found' };
  if (moment.authorId !== userId) return { ok: false, error: 'not_author' };
  const cleaned = clean(ctx, input ?? {});
  if (!cleaned.ok) return cleaned;
  ctx.db.prepare('UPDATE moments SET happened_on = ?, body = ? WHERE id = ?').run(cleaned.date, cleaned.text, id);
  return { ok: true };
}

export function removeMoment(ctx, userId, id) {
  const moment = findLive(ctx, id);
  if (!moment) return { ok: false, error: 'not_found' };
  if (moment.authorId !== userId) return { ok: false, error: 'not_author' };
  ctx.db.prepare('UPDATE moments SET deleted_at = ? WHERE id = ?').run(ctx.clock.now().toISOString(), id);
  return { ok: true };
}

// One earlier moment to bring back on Home: at least 14 days old, picked by
// the day number modulo how many qualify, in id order. It takes no user, so
// both people get the same one all day, and a different one the next day.
export function fromTheLog(ctx) {
  const today = todayFor(ctx);
  const rows = ctx.db
    .prepare(`${SELECT} WHERE m.deleted_at IS NULL AND m.happened_on <= ? ORDER BY m.id`)
    .all(addDays(today, -LOG_MIN_AGE_DAYS));
  if (rows.length === 0) return null;
  const dayNumber = daysBetween('1970-01-01', today);
  return toMoment(rows[dayNumber % rows.length]);
}
