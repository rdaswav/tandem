// Ideas: one-line things to do together. Either person can add one and either
// can mark it done; only the author can remove their own.
//
// Every function takes ctx first: an object with db, clock and config.

export const MAX_IDEA_LENGTH = 2000;

const SELECT = `SELECT i.id, i.author_id, u.display_name, u.slot, i.body, i.state, i.created_at, i.done_at
  FROM ideas i JOIN users u ON u.id = i.author_id`;

function toIdea(row) {
  return {
    id: row.id,
    authorId: row.author_id,
    authorName: row.display_name,
    authorSlot: row.slot,
    body: row.body,
    state: row.state,
    createdAt: row.created_at,
    doneAt: row.done_at,
  };
}

export function addIdea(ctx, authorId, input) {
  const body = input?.body;
  if (typeof body !== 'string' || body.trim() === '') return { ok: false, error: 'blank' };
  const text = body.trim();
  if ([...text].length > MAX_IDEA_LENGTH) return { ok: false, error: 'too_long' };
  const info = ctx.db
    .prepare("INSERT INTO ideas (author_id, body, state, created_at) VALUES (?, ?, 'open', ?)")
    .run(authorId, text, ctx.clock.now().toISOString());
  return { ok: true, id: Number(info.lastInsertRowid) };
}

// Open ideas newest first, done ideas most recently done first. Removed ones are never returned.
export function listIdeas(ctx) {
  const rows = (where, order) => ctx.db.prepare(`${SELECT} WHERE ${where} ORDER BY ${order}`).all().map(toIdea);
  return {
    open: rows("i.state = 'open'", 'i.id DESC'),
    done: rows("i.state = 'done'", 'i.done_at DESC, i.id DESC'),
  };
}

function findIdea(ctx, id) {
  const row = ctx.db.prepare(`${SELECT} WHERE i.id = ? AND i.state != 'removed'`).get(id);
  return row ? toIdea(row) : null;
}

// Either person can do this, whoever wrote the idea.
export function markDone(ctx, userId, id) {
  const idea = findIdea(ctx, id);
  if (!idea) return { ok: false, error: 'not_found' };
  if (idea.state !== 'open') return { ok: false, error: 'not_open' };
  ctx.db
    .prepare("UPDATE ideas SET state = 'done', done_at = ? WHERE id = ?")
    .run(ctx.clock.now().toISOString(), id);
  return { ok: true };
}

export function removeIdea(ctx, userId, id) {
  const idea = findIdea(ctx, id);
  if (!idea) return { ok: false, error: 'not_found' };
  if (idea.authorId !== userId) return { ok: false, error: 'not_author' };
  ctx.db.prepare("UPDATE ideas SET state = 'removed' WHERE id = ?").run(id);
  return { ok: true };
}
