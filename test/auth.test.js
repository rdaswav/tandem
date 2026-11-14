import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  completeSetup,
  createSession,
  createUsers,
  csrfValid,
  listUsers,
  markWelcomed,
  sessionFromCookie,
  signIn,
  signOut,
} from '../src/core/auth.js';
import { makeApp } from './helpers.js';

const PASS_A = 'ada has a long passphrase';
const PASS_B = 'bo likes another phrase';

// Two users, both finished setting up. Returns everything a test needs.
function twoUsers() {
  const { db, clock } = makeApp();
  const [a, b] = createUsers(db, clock, 'Ada', 'Bo');
  assert.equal(completeSetup(db, clock, a.setupToken, PASS_A).ok, true);
  assert.equal(completeSetup(db, clock, b.setupToken, PASS_B).ok, true);
  return { db, clock, a, b };
}

test('createUsers makes exactly two users, slot a then slot b', () => {
  const { db, clock } = makeApp();
  const users = createUsers(db, clock, '  Ada ', 'Bo');
  assert.deepEqual(users.map((u) => [u.slot, u.displayName]), [['a', 'Ada'], ['b', 'Bo']]);
  assert.equal(listUsers(db).length, 2);
  assert.deepEqual(listUsers(db).map((u) => u.ready), [false, false]);
});

test('a third user is impossible', () => {
  const { db, clock } = makeApp();
  createUsers(db, clock, 'Ada', 'Bo');
  assert.throws(() => createUsers(db, clock, 'Cy', 'Di'), /already exist/);
  assert.throws(
    () => db.prepare("INSERT INTO users (slot, display_name, created_at) VALUES ('c', 'Cy', 'x')").run(),
  );
  assert.throws(
    () => db.prepare("INSERT INTO users (slot, display_name, created_at) VALUES ('a', 'Cy', 'x')").run(),
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 2);
});

test('createUsers rejects empty, overlong and identical names and creates nothing', () => {
  const { db, clock } = makeApp();
  assert.throws(() => createUsers(db, clock, '', 'Bo'), RangeError);
  assert.throws(() => createUsers(db, clock, 'Ada', '   '), RangeError);
  assert.throws(() => createUsers(db, clock, 'x'.repeat(41), 'Bo'), RangeError);
  assert.throws(() => createUsers(db, clock, 'Ada', 'ada'), RangeError);
  assert.throws(() => createUsers(db, clock, undefined, 'Bo'), RangeError);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
});

test('a setup token works once and only once', () => {
  const { db, clock } = makeApp();
  const [a] = createUsers(db, clock, 'Ada', 'Bo');
  const first = completeSetup(db, clock, a.setupToken, PASS_A);
  assert.equal(first.ok, true);
  assert.equal(first.user.displayName, 'Ada');
  const second = completeSetup(db, clock, a.setupToken, 'a different passphrase');
  assert.deepEqual(second, { ok: false, error: 'invalid_token' });
  // The first passphrase still works, the second never replaced it.
  assert.equal(signIn(db, clock, a.id, PASS_A).ok, true);
  assert.equal(signIn(db, clock, a.id, 'a different passphrase').ok, false);
});

test('an unknown or empty setup token is refused', () => {
  const { db, clock } = makeApp();
  createUsers(db, clock, 'Ada', 'Bo');
  for (const token of ['nope', '', undefined, null, 42]) {
    assert.deepEqual(completeSetup(db, clock, token, PASS_A), { ok: false, error: 'invalid_token' });
  }
});

test('a passphrase under 8 characters is refused and does not use up the token', () => {
  const { db, clock } = makeApp();
  const [a] = createUsers(db, clock, 'Ada', 'Bo');
  assert.deepEqual(completeSetup(db, clock, a.setupToken, '1234567'), {
    ok: false,
    error: 'passphrase_too_short',
  });
  assert.deepEqual(completeSetup(db, clock, a.setupToken, undefined), {
    ok: false,
    error: 'passphrase_too_short',
  });
  assert.equal(completeSetup(db, clock, a.setupToken, '12345678').ok, true);
});

test('sign in: right passphrase succeeds, wrong one fails, other user cannot use it', () => {
  const { db, clock, a, b } = twoUsers();
  const good = signIn(db, clock, a.id, PASS_A);
  assert.equal(good.ok, true);
  assert.equal(good.user.slot, 'a');
  assert.ok(good.session.cookieValue.length >= 40);
  assert.deepEqual(signIn(db, clock, a.id, 'wrong passphrase'), { ok: false, error: 'invalid' });
  assert.deepEqual(signIn(db, clock, a.id, PASS_B), { ok: false, error: 'invalid' });
  assert.deepEqual(signIn(db, clock, b.id, PASS_A), { ok: false, error: 'invalid' });
  assert.equal(signIn(db, clock, b.id, PASS_B).ok, true);
});

test('sign in is refused for an unknown user, a missing passphrase and an unfinished account', () => {
  const { db, clock } = makeApp();
  const [a] = createUsers(db, clock, 'Ada', 'Bo');
  assert.equal(signIn(db, clock, 999, PASS_A).ok, false);
  assert.equal(signIn(db, clock, a.id, undefined).ok, false);
  assert.equal(signIn(db, clock, a.id, '').ok, false);
  assert.equal(signIn(db, clock, a.id, PASS_A).ok, false);
});

test('the sixth attempt inside 10 minutes is refused even with the right passphrase', () => {
  const { db, clock, a, b } = twoUsers();
  clock.set('2026-11-15T01:00:00Z');
  for (let i = 0; i < 5; i += 1) {
    assert.deepEqual(signIn(db, clock, a.id, `wrong guess ${i}`), { ok: false, error: 'invalid' });
  }
  assert.deepEqual(signIn(db, clock, a.id, PASS_A), { ok: false, error: 'locked' });

  clock.set('2026-11-15T01:09:59Z');
  assert.deepEqual(signIn(db, clock, a.id, PASS_A), { ok: false, error: 'locked' });

  // The other person is not affected.
  assert.equal(signIn(db, clock, b.id, PASS_B).ok, true);

  clock.set('2026-11-15T01:10:00Z');
  assert.equal(signIn(db, clock, a.id, PASS_A).ok, true);
});

test('being locked out does not extend the lock', () => {
  const { db, clock, a } = twoUsers();
  clock.set('2026-11-15T01:00:00Z');
  for (let i = 0; i < 5; i += 1) signIn(db, clock, a.id, 'wrong guess');
  clock.set('2026-11-15T01:05:00Z');
  for (let i = 0; i < 20; i += 1) {
    assert.equal(signIn(db, clock, a.id, 'wrong guess').error, 'locked');
  }
  clock.set('2026-11-15T01:10:00Z');
  assert.equal(signIn(db, clock, a.id, PASS_A).ok, true);
});

test('a successful sign in clears that user\'s earlier failures', () => {
  const { db, clock, a } = twoUsers();
  for (let i = 0; i < 4; i += 1) signIn(db, clock, a.id, 'wrong guess');
  assert.equal(signIn(db, clock, a.id, PASS_A).ok, true);
  for (let i = 0; i < 4; i += 1) signIn(db, clock, a.id, 'wrong guess');
  assert.equal(signIn(db, clock, a.id, PASS_A).ok, true);
});

test('a session is found by its cookie, expires after 90 days and is then deleted', () => {
  const { db, clock, a } = twoUsers();
  clock.set('2026-11-15T01:00:00Z');
  const { session } = signIn(db, clock, a.id, PASS_A);

  const found = sessionFromCookie(db, clock, session.cookieValue);
  assert.equal(found.user.id, a.id);
  assert.equal(found.user.displayName, 'Ada');
  assert.equal(found.csrf, session.csrf);

  clock.set('2027-02-12T00:59:59Z'); // 89 days 23:59:59 later
  assert.ok(sessionFromCookie(db, clock, session.cookieValue));

  clock.set('2027-02-13T01:00:00Z'); // exactly 90 days later
  assert.equal(sessionFromCookie(db, clock, session.cookieValue), null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
});

test('garbage cookies find no session', () => {
  const { db, clock } = twoUsers();
  for (const value of [undefined, null, '', 'nope', 42, 'x'.repeat(500)]) {
    assert.equal(sessionFromCookie(db, clock, value), null);
  }
});

test('sign out removes only that session', () => {
  const { db, clock, a, b } = twoUsers();
  const first = signIn(db, clock, a.id, PASS_A).session;
  const other = signIn(db, clock, b.id, PASS_B).session;
  signOut(db, first.cookieValue);
  assert.equal(sessionFromCookie(db, clock, first.cookieValue), null);
  assert.ok(sessionFromCookie(db, clock, other.cookieValue));
  assert.doesNotThrow(() => signOut(db, undefined));
});

test('each session has its own CSRF token and csrfValid compares exactly', () => {
  const { db, clock, a, b } = twoUsers();
  const s1 = createSession(db, clock, a.id);
  const s2 = createSession(db, clock, b.id);
  assert.notEqual(s1.csrf, s2.csrf);
  const session = sessionFromCookie(db, clock, s1.cookieValue);
  assert.equal(csrfValid(session, s1.csrf), true);
  assert.equal(csrfValid(session, s2.csrf), false);
  assert.equal(csrfValid(session, s1.csrf + 'x'), false);
  assert.equal(csrfValid(session, ''), false);
  assert.equal(csrfValid(session, undefined), false);
  assert.equal(csrfValid(null, s1.csrf), false);
});

test('markWelcomed sets the time once', () => {
  const { db, clock, a } = twoUsers();
  clock.set('2026-11-15T01:00:00Z');
  markWelcomed(db, clock, a.id);
  clock.set('2026-11-20T01:00:00Z');
  markWelcomed(db, clock, a.id);
  const user = listUsers(db).find((u) => u.id === a.id);
  assert.equal(user.welcomedAt, '2026-11-15T01:00:00.000Z');
});

test('only hashes are stored: no raw token, passphrase or cookie appears in any table', () => {
  const { db, clock, a, b } = twoUsers();
  const fresh = createUsers(makeApp().db, clock, 'Cy', 'Di'); // a separate database, tokens unused
  const signedIn = signIn(db, clock, a.id, PASS_A);
  signIn(db, clock, b.id, 'a wrong guess that was recorded');

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r) => r.name);
  const everything = tables
    .map((t) => JSON.stringify(db.prepare(`SELECT * FROM ${t}`).all()))
    .join('\n');

  for (const secret of [
    a.setupToken,
    b.setupToken,
    PASS_A,
    PASS_B,
    'a wrong guess that was recorded',
    signedIn.session.cookieValue,
  ]) {
    assert.equal(everything.includes(secret), false, `a raw secret was stored: ${secret.slice(0, 6)}...`);
  }
  assert.ok(fresh.length === 2);

  const sessionRow = db.prepare('SELECT id_hash FROM sessions').get();
  assert.match(sessionRow.id_hash, /^[0-9a-f]{64}$/);
  assert.notEqual(sessionRow.id_hash, signedIn.session.cookieValue);

  const userRow = db.prepare('SELECT pass_hash, pass_salt, setup_token_hash FROM users WHERE id = ?').get(a.id);
  assert.equal(userRow.setup_token_hash, null);
  assert.ok(userRow.pass_hash.length > 40);
  assert.ok(userRow.pass_salt.length > 10);
});

test('two users with the same passphrase get different hashes and salts', () => {
  const { db, clock } = makeApp();
  const [a, b] = createUsers(db, clock, 'Ada', 'Bo');
  completeSetup(db, clock, a.setupToken, 'the very same phrase');
  completeSetup(db, clock, b.setupToken, 'the very same phrase');
  const rows = db.prepare('SELECT pass_hash, pass_salt FROM users ORDER BY slot').all();
  assert.notEqual(rows[0].pass_hash, rows[1].pass_hash);
  assert.notEqual(rows[0].pass_salt, rows[1].pass_salt);
});

test('scripts/create-users.mjs prints exactly two setup paths and refuses a second run', () => {
  const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'create-users.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-test-'));
  try {
    const run = () =>
      spawnSync(process.execPath, [script, 'Ada', 'Bo'], {
        env: { ...process.env, DATA_DIR: dir },
        encoding: 'utf8',
      });
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    const lines = first.stdout.trim().split('\n');
    assert.equal(lines.length, 2);
    for (const line of lines) assert.match(line, /^\/setup\/[A-Za-z0-9_-]{43}$/);
    assert.notEqual(lines[0], lines[1]);

    const second = run();
    assert.notEqual(second.status, 0);
    assert.equal(second.stdout, '');
    assert.match(second.stderr, /already exist/);

    const usage = spawnSync(process.execPath, [script, 'Ada'], {
      env: { ...process.env, DATA_DIR: dir },
      encoding: 'utf8',
    });
    assert.notEqual(usage.status, 0);
    assert.equal(usage.stdout, '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
