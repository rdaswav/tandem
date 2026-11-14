// Weekly check-in rounds: drafts, submission, reveal and the visibility rule.
//
// The rule (Architecture 4.1): a person's answers are visible only to them
// until the round is revealed, and the round is revealed only inside the
// transaction of the second submission. All reads of answers for display or
// export go through answersVisibleTo, which enforces the rule in one query.
// This is the only file allowed to touch the answers table.
//
// Every function takes ctx first: an object with db, clock and config (the
// app instance itself works, and so does the test context).

import { addDays, localDate, weekStart as computeWeekStart } from './week.js';
import { loadPrompts, promptText, rotatingFor } from './prompts.js';

export const MAX_ANSWER_LENGTH = 2000;

function toRound(row) {
  if (!row) return null;
  return {
    id: row.id,
    weekStart: row.week_start,
    rotatingPromptId: row.rotating_prompt_id,
    revealedAt: row.revealed_at,
    createdAt: row.created_at,
  };
}

function inTransaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function roundById(db, id) {
  return toRound(db.prepare('SELECT * FROM rounds WHERE id = ?').get(id));
}

// A week is over when the local date has reached the day after its last day.
function isPassed(ctx, round) {
  return localDate(ctx.clock.now(), ctx.config.tz) >= addDays(round.weekStart, 7);
}

function nonBlankAnswerCount(db, roundId, userId) {
  return db
    .prepare('SELECT COUNT(*) AS n FROM answers WHERE round_id = ? AND user_id = ?')
    .get(roundId, userId).n;
}

function hasSubmitted(db, roundId, userId) {
  return Boolean(db.prepare('SELECT 1 FROM submissions WHERE round_id = ? AND user_id = ?').get(roundId, userId));
}

// ---- rounds ---------------------------------------------------------------

// The round for the current week, created the first time either person asks.
export function currentRound(ctx) {
  const { db, clock, config } = ctx;
  const start = computeWeekStart(clock.now(), config.tz, config.checkinStartDay);
  db.prepare('INSERT OR IGNORE INTO rounds (week_start, rotating_prompt_id, created_at) VALUES (?, ?, ?)').run(
    start,
    rotatingFor(start).id,
    clock.now().toISOString(),
  );
  return toRound(db.prepare('SELECT * FROM rounds WHERE week_start = ?').get(start));
}

export function roundByWeek(ctx, weekStart) {
  return toRound(ctx.db.prepare('SELECT * FROM rounds WHERE week_start = ?').get(weekStart));
}

// The prompts a round asks, in order: the fixed ones, then the rotating one.
export function promptsFor(round, pack = loadPrompts()) {
  return [
    ...pack.fixed.map((p) => ({ id: p.id, text: p.text, rotating: false })),
    { id: round.rotatingPromptId, text: promptText(round.rotatingPromptId, pack), rotating: true },
  ];
}

// One of: not_started, draft, waiting, revealed, passed. Nothing in here looks
// at what the other person has or has not done, except the shared reveal.
export function stateFor(ctx, round, userId) {
  if (round.revealedAt) return 'revealed';
  if (isPassed(ctx, round)) return 'passed';
  if (hasSubmitted(ctx.db, round.id, userId)) return 'waiting';
  if (nonBlankAnswerCount(ctx.db, round.id, userId) > 0) return 'draft';
  return 'not_started';
}

// Earlier rounds this person can look at: revealed ones, and ones they wrote
// in themselves. A round only the other person opened is not listed, so the
// list never shows what the other person did.
export function pastRounds(ctx, userId) {
  const current = currentRound(ctx);
  const rows = ctx.db
    .prepare(
      `SELECT * FROM rounds r
       WHERE r.week_start < ?
         AND (r.revealed_at IS NOT NULL
              OR EXISTS (SELECT 1 FROM answers a WHERE a.round_id = r.id AND a.user_id = ?)
              OR EXISTS (SELECT 1 FROM submissions s WHERE s.round_id = r.id AND s.user_id = ?))
       ORDER BY r.week_start DESC`,
    )
    .all(current.weekStart, userId, userId);
  return rows.map(toRound).map((round) => ({ ...round, state: stateFor(ctx, round, userId) }));
}

// ---- answers --------------------------------------------------------------

// Everything this person is allowed to see for a round: always their own
// answers, and the other person's only once the round is revealed. Ordered by
// slot (a first) then prompt id. This single query is the visibility rule.
export function answersVisibleTo(ctx, roundId, userId) {
  return ctx.db
    .prepare(
      `SELECT a.user_id, u.slot, a.prompt_id, a.body, a.updated_at
       FROM answers a
       JOIN users u ON u.id = a.user_id
       JOIN rounds r ON r.id = a.round_id
       WHERE a.round_id = ?
         AND (a.user_id = ? OR r.revealed_at IS NOT NULL)
       ORDER BY u.slot, a.prompt_id`,
    )
    .all(roundId, userId)
    .map((row) => ({
      userId: row.user_id,
      slot: row.slot,
      promptId: row.prompt_id,
      body: row.body,
      updatedAt: row.updated_at,
    }));
}

// Saves a person's draft. `answers` maps prompt id to text. A blank answer
// clears that prompt. Nothing is saved if any part is refused.
export function saveDraft(ctx, roundId, userId, answers, pack = loadPrompts()) {
  const { db, clock } = ctx;
  const round = roundById(db, roundId);
  if (!round) return { ok: false, error: 'no_round' };
  if (round.revealedAt || isPassed(ctx, round)) return { ok: false, error: 'round_closed' };
  if (hasSubmitted(db, roundId, userId)) return { ok: false, error: 'already_submitted' };
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return { ok: false, error: 'invalid_answers' };
  }

  const allowed = new Set([...pack.fixed.map((p) => p.id), round.rotatingPromptId]);
  const cleaned = [];
  for (const [promptId, value] of Object.entries(answers)) {
    if (!allowed.has(promptId)) return { ok: false, error: 'unknown_prompt', promptId };
    if (typeof value !== 'string') return { ok: false, error: 'invalid_answers', promptId };
    const text = value.trim();
    if ([...text].length > MAX_ANSWER_LENGTH) return { ok: false, error: 'too_long', promptId };
    cleaned.push([promptId, text]);
  }

  const now = clock.now().toISOString();
  inTransaction(db, () => {
    for (const [promptId, text] of cleaned) {
      if (text === '') {
        db.prepare('DELETE FROM answers WHERE round_id = ? AND user_id = ? AND prompt_id = ?').run(
          roundId,
          userId,
          promptId,
        );
      } else {
        db.prepare(
          `INSERT INTO answers (round_id, user_id, prompt_id, body, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (round_id, user_id, prompt_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
        ).run(roundId, userId, promptId, text, now);
      }
    }
  });
  return { ok: true };
}

// Locks a person's answers. Needs at least one answer. When this is the second
// submission the round is revealed in the same transaction.
export function submit(ctx, roundId, userId) {
  const { db, clock } = ctx;
  return inTransaction(db, () => {
    const round = roundById(db, roundId);
    if (!round) return { ok: false, error: 'no_round' };
    if (round.revealedAt || isPassed(ctx, round)) return { ok: false, error: 'round_closed' };
    if (hasSubmitted(db, roundId, userId)) return { ok: false, error: 'already_submitted' };
    if (nonBlankAnswerCount(db, roundId, userId) === 0) return { ok: false, error: 'no_answers' };

    const now = clock.now().toISOString();
    db.prepare('INSERT INTO submissions (round_id, user_id, submitted_at) VALUES (?, ?, ?)').run(roundId, userId, now);
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM submissions WHERE round_id = ?').get(roundId);
    const revealed = n >= 2;
    if (revealed) db.prepare('UPDATE rounds SET revealed_at = ? WHERE id = ? AND revealed_at IS NULL').run(now, roundId);
    return { ok: true, revealed };
  });
}
