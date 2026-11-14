// Hard conversation helper: the state machine and its store.
//
// A talk stores who proposed it, the topic, an optional hope, its state and
// step, and times. It never stores what was said: there is nowhere to put it.
// Agreements made at the end are saved as agreements, not here.
//
// next() is a pure function; the store functions take ctx first (db, clock, config).

export const TOTAL_STEPS = 7;
export const MAX_TOPIC_LENGTH = 140;
export const MAX_HOPE_LENGTH = 300;

export const ACTIVE_STATES = ['proposed', 'ready', 'in_progress', 'paused', 'closing'];
const TERMINAL_STATES = new Set(['set_aside', 'withdrawn', 'closed']);
export const ACTIONS = ['accept', 'not_now', 'withdraw', 'start', 'advance', 'pause', 'resume', 'end', 'finish'];

// For each state, the actions allowed, who may do them, and what they do.
// who: 'either' person, only the 'proposer', or only the 'other' person.
const RULES = {
  proposed: {
    accept: { who: 'other', apply: (t) => ({ ...t, state: 'ready' }) },
    not_now: { who: 'other', apply: (t) => ({ ...t, state: 'set_aside' }) },
    withdraw: { who: 'proposer', apply: (t) => ({ ...t, state: 'withdrawn' }) },
  },
  ready: {
    start: {
      who: 'either',
      apply: (t) => ({ ...t, state: 'in_progress', step: 1, firstSpeaker: t.proposerSlot }),
    },
  },
  in_progress: {
    advance: {
      who: 'either',
      apply: (t) => (t.step >= TOTAL_STEPS ? { ...t, state: 'closing' } : { ...t, step: t.step + 1 }),
    },
    pause: { who: 'either', apply: (t) => ({ ...t, state: 'paused' }) },
    end: { who: 'either', apply: (t) => ({ ...t, state: 'closed' }) },
  },
  paused: {
    resume: { who: 'either', apply: (t) => ({ ...t, state: 'in_progress' }) },
    end: { who: 'either', apply: (t) => ({ ...t, state: 'closed' }) },
  },
  closing: {
    finish: { who: 'either', apply: (t) => ({ ...t, state: 'closed' }) },
  },
};

// talk: { state, step, proposerSlot, firstSpeaker }. actorSlot is 'a' or 'b'.
// Returns { ok: true, talk } with a new object, or { ok: false, error } where
// error is bad_actor, unknown_action, not_allowed (not in this state) or
// wrong_person (right action, wrong person). The input is never changed.
export function next(talk, action, actorSlot) {
  if (actorSlot !== 'a' && actorSlot !== 'b') return { ok: false, error: 'bad_actor' };
  if (!ACTIONS.includes(action)) return { ok: false, error: 'unknown_action' };
  const rules = Object.hasOwn(RULES, talk.state) ? RULES[talk.state] : {};
  if (!Object.hasOwn(rules, action)) return { ok: false, error: 'not_allowed' };
  const rule = rules[action];
  const isProposer = actorSlot === talk.proposerSlot;
  const allowed = rule.who === 'either' || (rule.who === 'proposer' ? isProposer : !isProposer);
  if (!allowed) return { ok: false, error: 'wrong_person' };
  return { ok: true, talk: rule.apply(talk) };
}

// ---- the store ------------------------------------------------------------

const SELECT = `SELECT t.id, t.proposed_by, t.topic, t.hope, t.state, t.step, t.first_speaker,
    t.created_at, t.updated_at, t.closed_at, u.slot AS proposer_slot, u.display_name AS proposer_name
  FROM talks t JOIN users u ON u.id = t.proposed_by`;

function toTalk(row) {
  return {
    id: row.id,
    proposedBy: row.proposed_by,
    proposerSlot: row.proposer_slot,
    proposerName: row.proposer_name,
    topic: row.topic,
    hope: row.hope,
    state: row.state,
    step: row.step,
    firstSpeaker: row.first_speaker,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
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

export function getTalk(ctx, id) {
  const row = ctx.db.prepare(`${SELECT} WHERE t.id = ?`).get(id);
  return row ? toTalk(row) : null;
}

// The one talk that is not finished, if there is one.
export function activeTalk(ctx) {
  const marks = ACTIVE_STATES.map(() => '?').join(', ');
  const row = ctx.db.prepare(`${SELECT} WHERE t.state IN (${marks}) ORDER BY t.id DESC LIMIT 1`).get(...ACTIVE_STATES);
  return row ? toTalk(row) : null;
}

// Every talk, newest first.
export function listTalks(ctx) {
  return ctx.db.prepare(`${SELECT} ORDER BY t.id DESC`).all().map(toTalk);
}

// Ask to talk about something. Only one talk can be going at a time.
export function proposeTalk(ctx, userId, input) {
  const { topic, hope } = input ?? {};
  if (typeof topic !== 'string' || topic.trim() === '') return { ok: false, error: 'blank' };
  const cleanTopic = topic.trim();
  if ([...cleanTopic].length > MAX_TOPIC_LENGTH) return { ok: false, error: 'topic_too_long' };
  let cleanHope = null;
  if (hope !== undefined && hope !== null) {
    if (typeof hope !== 'string') return { ok: false, error: 'hope_too_long' };
    cleanHope = hope.trim() === '' ? null : hope.trim();
    if (cleanHope && [...cleanHope].length > MAX_HOPE_LENGTH) return { ok: false, error: 'hope_too_long' };
  }

  return inTransaction(ctx.db, () => {
    if (!ctx.db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) return { ok: false, error: 'unknown_user' };
    if (activeTalk(ctx)) return { ok: false, error: 'talk_active' };
    const now = ctx.clock.now().toISOString();
    const info = ctx.db
      .prepare(
        `INSERT INTO talks (proposed_by, topic, hope, state, step, first_speaker, created_at, updated_at)
         VALUES (?, ?, ?, 'proposed', 0, NULL, ?, ?)`,
      )
      .run(userId, cleanTopic, cleanHope, now, now);
    return { ok: true, id: Number(info.lastInsertRowid) };
  });
}

// Does one action on a talk for a person, through the state machine.
export function applyAction(ctx, userId, talkId, action) {
  return inTransaction(ctx.db, () => {
    const user = ctx.db.prepare('SELECT slot FROM users WHERE id = ?').get(userId);
    if (!user) return { ok: false, error: 'unknown_user' };
    const talk = getTalk(ctx, talkId);
    if (!talk) return { ok: false, error: 'not_found' };

    const result = next(talk, action, user.slot);
    if (!result.ok) return result;

    const t = result.talk;
    const now = ctx.clock.now().toISOString();
    ctx.db
      .prepare('UPDATE talks SET state = ?, step = ?, first_speaker = ?, updated_at = ?, closed_at = ? WHERE id = ?')
      .run(t.state, t.step, t.firstSpeaker, now, TERMINAL_STATES.has(t.state) ? now : null, talkId);
    return { ok: true, talk: getTalk(ctx, talkId) };
  });
}
