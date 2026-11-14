// Agreements: things the two of you have agreed. They belong to both people.
// Either person can mark one done or drop it; once closed it never changes.
// The text cannot be edited: drop it and make a new one.
//
// Every function takes ctx first: an object with db, clock and config.

export const MAX_AGREEMENT_LENGTH = 300;

const OWNERS = new Set(['a', 'b', 'both']);
const SOURCES = new Set(['checkin', 'talk', 'direct']);

const SELECT = `SELECT g.id, g.body, g.owner, g.source, g.source_id, g.state, g.created_by, g.created_at,
    g.closed_at, o.display_name AS owner_name
  FROM agreements g LEFT JOIN users o ON o.slot = g.owner`;

function toAgreement(row) {
  return {
    id: row.id,
    body: row.body,
    owner: row.owner,
    ownerLabel: row.owner === 'both' ? 'Both' : row.owner_name,
    source: row.source,
    sourceId: row.source_id,
    state: row.state,
    createdBy: row.created_by,
    createdAt: row.created_at,
    closedAt: row.closed_at,
  };
}

function userExists(ctx, userId) {
  return Boolean(ctx.db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId));
}

// owner is 'a', 'b' (a person's slot) or 'both'. source is where it came from:
// 'direct', or 'checkin' / 'talk' with the id of that round or talk.
export function addAgreement(ctx, userId, input) {
  const { body, owner, source = 'direct', sourceId = null } = input ?? {};
  if (typeof body !== 'string' || body.trim() === '') return { ok: false, error: 'blank' };
  const text = body.trim();
  if ([...text].length > MAX_AGREEMENT_LENGTH) return { ok: false, error: 'too_long' };
  if (!OWNERS.has(owner)) return { ok: false, error: 'bad_owner' };
  if (!SOURCES.has(source)) return { ok: false, error: 'bad_source' };
  if (sourceId !== null && !Number.isInteger(sourceId)) return { ok: false, error: 'bad_source' };
  if (source === 'direct' && sourceId !== null) return { ok: false, error: 'bad_source' };
  if (!userExists(ctx, userId)) return { ok: false, error: 'unknown_user' };

  const info = ctx.db
    .prepare(
      `INSERT INTO agreements (body, owner, source, source_id, state, created_by, created_at)
       VALUES (?, ?, ?, ?, 'open', ?, ?)`,
    )
    .run(text, owner, source, sourceId, userId, ctx.clock.now().toISOString());
  return { ok: true, id: Number(info.lastInsertRowid) };
}

export function getAgreement(ctx, id) {
  const row = ctx.db.prepare(`${SELECT} WHERE g.id = ?`).get(id);
  return row ? toAgreement(row) : null;
}

// Open agreements, oldest first. Shared: there is no per-person view.
export function listOpen(ctx) {
  return ctx.db
    .prepare(`${SELECT} WHERE g.state = 'open' ORDER BY g.created_at ASC, g.id ASC`)
    .all()
    .map(toAgreement);
}

// Done and dropped agreements, most recently closed first.
export function listEarlier(ctx) {
  return ctx.db
    .prepare(`${SELECT} WHERE g.state != 'open' ORDER BY g.closed_at DESC, g.id DESC`)
    .all()
    .map(toAgreement);
}

function close(ctx, userId, id, state) {
  if (!userExists(ctx, userId)) return { ok: false, error: 'unknown_user' };
  const found = ctx.db.prepare('SELECT state FROM agreements WHERE id = ?').get(id);
  if (!found) return { ok: false, error: 'not_found' };
  if (found.state !== 'open') return { ok: false, error: 'not_open' };
  ctx.db
    .prepare("UPDATE agreements SET state = ?, closed_at = ? WHERE id = ? AND state = 'open'")
    .run(state, ctx.clock.now().toISOString(), id);
  return { ok: true };
}

// Either person can do either of these, whoever the agreement belongs to.
export function markAgreementDone(ctx, userId, id) {
  return close(ctx, userId, id, 'done');
}

export function dropAgreement(ctx, userId, id) {
  return close(ctx, userId, id, 'dropped');
}
