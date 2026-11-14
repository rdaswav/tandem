// Accounts, setup links, sessions and CSRF tokens. No HTTP in here.
// Only hashes of secrets are stored: setup tokens and session cookies as
// SHA-256, passphrases as scrypt with a per-user salt.

import crypto from 'node:crypto';

export const SESSION_DAYS = 90;
export const MAX_FAILED_ATTEMPTS = 5;
export const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
export const MIN_PASSPHRASE_LENGTH = 8;
export const MAX_NAME_LENGTH = 40;

const DAY_MS = 86_400_000;

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
const stamp = (clock) => clock.now().toISOString();

function derive(passphrase, salt) {
  return crypto.scryptSync(passphrase.normalize('NFKC'), salt, 64);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
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

function publicUser(row) {
  return {
    id: row.id,
    slot: row.slot,
    displayName: row.display_name,
    welcomedAt: row.welcomed_at,
  };
}

// ---- users ----------------------------------------------------------------

// Makes the two users. Refuses if any user already exists. Returns the two
// single-use setup tokens (slot a first). The tokens are shown once and only
// their hashes are stored.
export function createUsers(db, clock, nameA, nameB) {
  const names = [nameA, nameB].map((n) => (typeof n === 'string' ? n.trim() : ''));
  for (const name of names) {
    if (!name) throw new RangeError('each name must be non-empty');
    if ([...name].length > MAX_NAME_LENGTH) {
      throw new RangeError(`each name must be at most ${MAX_NAME_LENGTH} characters`);
    }
  }
  if (names[0].toLowerCase() === names[1].toLowerCase()) {
    throw new RangeError('the two names must differ');
  }

  return inTransaction(db, () => {
    const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get();
    if (count > 0) throw new Error('users already exist');
    const insert = db.prepare(
      'INSERT INTO users (slot, display_name, setup_token_hash, created_at) VALUES (?, ?, ?, ?)',
    );
    return ['a', 'b'].map((slot, i) => {
      const setupToken = newToken();
      const info = insert.run(slot, names[i], sha256(setupToken), stamp(clock));
      return { id: Number(info.lastInsertRowid), slot, displayName: names[i], setupToken };
    });
  });
}

export function listUsers(db) {
  return db
    .prepare('SELECT id, slot, display_name, welcomed_at, pass_hash FROM users ORDER BY slot')
    .all()
    .map((row) => ({ ...publicUser(row), ready: Boolean(row.pass_hash) }));
}

export function userById(db, id) {
  const row = db.prepare('SELECT id, slot, display_name, welcomed_at FROM users WHERE id = ?').get(id);
  return row ? publicUser(row) : null;
}

export function markWelcomed(db, clock, userId) {
  db.prepare('UPDATE users SET welcomed_at = ? WHERE id = ? AND welcomed_at IS NULL').run(stamp(clock), userId);
}

// Sets a passphrase through a single-use setup token. A passphrase that is
// too short is refused without using up the token.
export function completeSetup(db, clock, token, passphrase) {
  if (typeof token !== 'string' || !token) return { ok: false, error: 'invalid_token' };
  return inTransaction(db, () => {
    const user = db.prepare('SELECT id FROM users WHERE setup_token_hash = ?').get(sha256(token));
    if (!user) return { ok: false, error: 'invalid_token' };
    if (typeof passphrase !== 'string' || [...passphrase].length < MIN_PASSPHRASE_LENGTH) {
      return { ok: false, error: 'passphrase_too_short' };
    }
    const salt = crypto.randomBytes(16);
    db.prepare('UPDATE users SET pass_hash = ?, pass_salt = ?, setup_token_hash = NULL WHERE id = ?').run(
      derive(passphrase, salt).toString('base64'),
      salt.toString('base64'),
      user.id,
    );
    return { ok: true, user: userById(db, user.id) };
  });
}

// For a forgotten passphrase or a lost phone, run by whoever looks after the
// server. In one step: the person's passphrase is cleared, every session of
// theirs is deleted (so every phone is signed out), their failed attempts are
// cleared and a new single-use setup token is stored as a hash. The raw token
// is returned once. The other person is not touched.
export function issueResetLink(db, clock, name) {
  const wanted = typeof name === 'string' ? name.trim().toLowerCase() : '';
  if (!wanted) return { ok: false, error: 'not_found' };
  return inTransaction(db, () => {
    const matches = db
      .prepare('SELECT id, display_name FROM users')
      .all()
      .filter((row) => row.display_name.trim().toLowerCase() === wanted);
    if (matches.length === 0) return { ok: false, error: 'not_found' };
    if (matches.length > 1) return { ok: false, error: 'ambiguous' };
    const user = matches[0];
    const setupToken = newToken();
    db.prepare('UPDATE users SET pass_hash = NULL, pass_salt = NULL, setup_token_hash = ? WHERE id = ?').run(
      sha256(setupToken),
      user.id,
    );
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM signin_attempts WHERE user_id = ?').run(user.id);
    return { ok: true, displayName: user.display_name, setupToken };
  });
}

// ---- sign in --------------------------------------------------------------

// At most MAX_FAILED_ATTEMPTS wrong passphrases per user in any sliding
// window of ATTEMPT_WINDOW_MS. While the limit is reached the passphrase is
// not even checked, so a right guess is refused too. Only failures are
// recorded, so being locked out does not extend the lock.
export function signIn(db, clock, userId, passphrase) {
  const now = clock.now();
  db.prepare('DELETE FROM signin_attempts WHERE at <= ?').run(
    new Date(now.getTime() - ATTEMPT_WINDOW_MS).toISOString(),
  );

  const user = db
    .prepare('SELECT id, slot, display_name, welcomed_at, pass_hash, pass_salt FROM users WHERE id = ?')
    .get(userId);
  if (!user) return { ok: false, error: 'invalid' };

  const { failures } = db
    .prepare('SELECT COUNT(*) AS failures FROM signin_attempts WHERE user_id = ?')
    .get(user.id);
  if (failures >= MAX_FAILED_ATTEMPTS) return { ok: false, error: 'locked' };

  let matches = false;
  if (typeof passphrase === 'string') {
    const salt = user.pass_salt ? Buffer.from(user.pass_salt, 'base64') : Buffer.alloc(16);
    const candidate = derive(passphrase, salt).toString('base64');
    // Always derive, so an unfinished account costs the same time as a real one.
    matches = Boolean(user.pass_hash) && safeEqual(candidate, user.pass_hash);
  }

  if (!matches) {
    db.prepare('INSERT INTO signin_attempts (user_id, at) VALUES (?, ?)').run(user.id, stamp(clock));
    return { ok: false, error: 'invalid' };
  }

  db.prepare('DELETE FROM signin_attempts WHERE user_id = ?').run(user.id);
  return { ok: true, user: publicUser(user), session: createSession(db, clock, user.id) };
}

// ---- sessions -------------------------------------------------------------

// Returns the raw cookie value (never stored), the CSRF token and the expiry.
export function createSession(db, clock, userId) {
  const cookieValue = newToken();
  const csrf = newToken();
  const now = clock.now();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * DAY_MS).toISOString();
  db.prepare(
    'INSERT INTO sessions (id_hash, user_id, csrf, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).run(sha256(cookieValue), userId, csrf, now.toISOString(), expiresAt);
  return { cookieValue, csrf, expiresAt };
}

export function sessionFromCookie(db, clock, cookieValue) {
  if (typeof cookieValue !== 'string' || cookieValue.length === 0 || cookieValue.length > 200) {
    return null;
  }
  const idHash = sha256(cookieValue);
  const row = db
    .prepare(
      `SELECT s.csrf, s.expires_at, u.id, u.slot, u.display_name, u.welcomed_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id_hash = ?`,
    )
    .get(idHash);
  if (!row) return null;
  if (row.expires_at <= stamp(clock)) {
    db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(idHash);
    return null;
  }
  return { user: publicUser(row), csrf: row.csrf, expiresAt: row.expires_at };
}

export function signOut(db, cookieValue) {
  if (typeof cookieValue !== 'string' || !cookieValue) return;
  db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(sha256(cookieValue));
}

// Constant-time check of a submitted CSRF token against the session's.
export function csrfValid(session, submitted) {
  if (!session || typeof submitted !== 'string' || !submitted) return false;
  return safeEqual(session.csrf, submitted);
}
