import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { completeSetup, issueResetLink, signIn, sessionFromCookie, MAX_FAILED_ATTEMPTS } from '../src/core/auth.js';
import { logPath } from '../src/server.js';
import { PASSPHRASES, makeAppWithUsers } from './helpers.js';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'reset-passphrase.mjs');
const NEW_PHRASE = 'a brand new phrase for ada';

test('after a reset the old passphrase and the old session no longer work', async () => {
  const { app, db, clock, users, login } = makeAppWithUsers();
  const before = login('a');
  assert.ok(sessionFromCookie(db, clock, before.cookieValue));

  const result = issueResetLink(db, clock, 'Ada');
  assert.equal(result.ok, true);

  assert.equal(signIn(db, clock, users.a.id, PASSPHRASES.a).ok, false);
  assert.equal(sessionFromCookie(db, clock, before.cookieValue), null);
  const res = await app.inject({ url: '/', headers: before.headers });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/signin');
});

test('every session of that person is signed out, on every phone', () => {
  const { db, clock, login } = makeAppWithUsers();
  const phones = [login('a'), login('a'), login('a')];
  issueResetLink(db, clock, 'ada');
  for (const phone of phones) assert.equal(sessionFromCookie(db, clock, phone.cookieValue), null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(phones[0].user.id).n, 0);
});

test('the other person keeps their passphrase and their sessions', () => {
  const { db, clock, users, login } = makeAppWithUsers();
  const bo = login('b');
  const boHashBefore = db.prepare('SELECT pass_hash, pass_salt, setup_token_hash FROM users WHERE id = ?').get(users.b.id);
  issueResetLink(db, clock, 'Ada');
  assert.ok(sessionFromCookie(db, clock, bo.cookieValue));
  assert.equal(signIn(db, clock, users.b.id, PASSPHRASES.b).ok, true);
  const boHashAfter = db.prepare('SELECT pass_hash, pass_salt, setup_token_hash FROM users WHERE id = ?').get(users.b.id);
  assert.deepEqual(boHashAfter, boHashBefore);
});

test('the new link works once, then fails, and the new passphrase signs in', () => {
  const { db, clock, users } = makeAppWithUsers();
  const { setupToken } = issueResetLink(db, clock, 'Ada');

  const first = completeSetup(db, clock, setupToken, NEW_PHRASE);
  assert.equal(first.ok, true);
  assert.equal(first.user.displayName, 'Ada');
  assert.equal(completeSetup(db, clock, setupToken, 'some other phrase').error, 'invalid_token');

  assert.equal(signIn(db, clock, users.a.id, NEW_PHRASE).ok, true);
  assert.equal(signIn(db, clock, users.a.id, PASSPHRASES.a).ok, false);
});

test('a passphrase that is too short does not use up the reset link', () => {
  const { db, clock } = makeAppWithUsers();
  const { setupToken } = issueResetLink(db, clock, 'Ada');
  assert.equal(completeSetup(db, clock, setupToken, 'short').error, 'passphrase_too_short');
  assert.equal(completeSetup(db, clock, setupToken, NEW_PHRASE).ok, true);
});

test('the setup page opens for a reset link and finishes the same way as the first time', async () => {
  const { app, db, clock } = makeAppWithUsers();
  const { setupToken } = issueResetLink(db, clock, 'Ada');
  const page = await app.inject({ url: `/setup/${setupToken}` });
  assert.equal(page.statusCode, 200);
  const done = await app.inject({
    method: 'POST',
    url: `/setup/${setupToken}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: `passphrase=${encodeURIComponent(NEW_PHRASE)}&confirm=${encodeURIComponent(NEW_PHRASE)}`,
  });
  assert.ok([200, 302, 303].includes(done.statusCode), `status ${done.statusCode}`);
  const again = await app.inject({
    method: 'POST',
    url: `/setup/${setupToken}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: `passphrase=${encodeURIComponent('yet another phrase')}&confirm=${encodeURIComponent('yet another phrase')}`,
  });
  assert.equal(again.statusCode, 400);
  assert.match(again.body, /already been used or is not valid/);
});

test('wrong guesses against the person are cleared, so a reset also ends a lockout', () => {
  const { db, clock, users } = makeAppWithUsers();
  for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) signIn(db, clock, users.a.id, 'not the phrase');
  assert.equal(signIn(db, clock, users.a.id, PASSPHRASES.a).error, 'locked');
  const { setupToken } = issueResetLink(db, clock, 'Ada');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM signin_attempts WHERE user_id = ?').get(users.a.id).n, 0);
  completeSetup(db, clock, setupToken, NEW_PHRASE);
  assert.equal(signIn(db, clock, users.a.id, NEW_PHRASE).ok, true);
});

test("the other person's failed attempts are left alone", () => {
  const { db, clock, users } = makeAppWithUsers();
  signIn(db, clock, users.b.id, 'wrong one');
  issueResetLink(db, clock, 'Ada');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM signin_attempts WHERE user_id = ?').get(users.b.id).n, 1);
});

test('an unknown name, an empty name and a non-string are refused and change nothing', () => {
  const { db, clock, users } = makeAppWithUsers();
  const snapshot = () => JSON.stringify(db.prepare('SELECT * FROM users ORDER BY id').all());
  const before = snapshot();
  for (const name of ['Cy', '', '   ', null, undefined, 7, {}, ['Ada']]) {
    const result = issueResetLink(db, clock, name);
    assert.deepEqual(result, { ok: false, error: 'not_found' });
  }
  assert.equal(snapshot(), before);
  assert.equal(signIn(db, clock, users.a.id, PASSPHRASES.a).ok, true);
});

test('two people with the same name are refused as ambiguous', () => {
  const { db, clock } = makeAppWithUsers();
  db.prepare("UPDATE users SET display_name = 'Ada' WHERE slot = 'b'").run();
  assert.deepEqual(issueResetLink(db, clock, 'ada'), { ok: false, error: 'ambiguous' });
});

test('the token is stored only as a hash, and a new one is made on every reset', () => {
  const { db, clock } = makeAppWithUsers();
  const one = issueResetLink(db, clock, 'Ada').setupToken;
  const two = issueResetLink(db, clock, 'Ada').setupToken;
  assert.notEqual(one, two);
  assert.match(one, /^[A-Za-z0-9_-]{43}$/);
  const dump = JSON.stringify(db.prepare('SELECT * FROM users').all());
  assert.equal(dump.includes(one), false);
  assert.equal(dump.includes(two), false);
  // The first link was replaced by the second.
  assert.equal(completeSetup(db, clock, one, NEW_PHRASE).error, 'invalid_token');
  assert.equal(completeSetup(db, clock, two, NEW_PHRASE).ok, true);
});

test('a reset link is kept out of the request log like any setup link', () => {
  const { db, clock } = makeAppWithUsers();
  const { setupToken } = issueResetLink(db, clock, 'Ada');
  assert.equal(logPath(`/setup/${setupToken}`), '/setup/:token');
});

test('a reset does not change anyone\'s check-in answers or other data', () => {
  const { db, clock } = makeAppWithUsers();
  const counts = () =>
    ['rounds', 'submissions', 'moments', 'ideas', 'agreements', 'talks']
      .map((t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n)
      .join(',');
  const before = counts();
  issueResetLink(db, clock, 'Ada');
  assert.equal(counts(), before);
});

test('scripts/reset-passphrase.mjs prints exactly one setup path, and nothing else', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-test-'));
  try {
    const run = (...args) =>
      spawnSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, DATA_DIR: dir }, encoding: 'utf8' });
    const make = spawnSync(
      process.execPath,
      [path.resolve(path.dirname(SCRIPT), 'create-users.mjs'), 'Ada', 'Bo'],
      { env: { ...process.env, DATA_DIR: dir }, encoding: 'utf8' },
    );
    assert.equal(make.status, 0, make.stderr);

    const ok = run('Ada');
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /^\/setup\/[A-Za-z0-9_-]{43}\n$/);
    assert.equal(ok.stderr, '');
    assert.notEqual(ok.stdout.trim(), make.stdout.trim().split('\n')[0], 'a new link, not the old one');

    const unknown = run('Cy');
    assert.notEqual(unknown.status, 0);
    assert.equal(unknown.stdout, '');

    const noName = run();
    assert.notEqual(noName.status, 0);
    assert.equal(noName.stdout, '');

    const tooMany = run('Ada', 'Bo');
    assert.notEqual(tooMany.status, 0);
    assert.equal(tooMany.stdout, '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the script never prints a passphrase or a hash', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.doesNotMatch(source, /pass_hash|pass_salt|console\.log\((?!`\/setup)/);
  assert.equal(source.includes('—'), false, 'no em dash');
});
