import { openDb } from '../src/db.js';
import { buildApp } from '../src/server.js';
import { fakeClock } from '../src/core/clock.js';
import { completeSetup, createUsers, signIn } from '../src/core/auth.js';
import { COOKIE_NAME } from '../src/routes/auth.js';

export { fakeClock };

export const PASSPHRASES = { a: 'ada has a long passphrase', b: 'bo likes another phrase' };

export function makeApp(overrides = {}) {
  const db = openDb(':memory:');
  const clock = overrides.clock ?? fakeClock();
  const config = {
    port: 0,
    dataDir: ':memory:',
    tz: 'Australia/Melbourne',
    checkinStartDay: 0,
    log: false,
    ...overrides.config,
  };
  const app = buildApp({ db, clock, config });
  return { app, db, clock, config };
}

// An app with the two users (Ada, slot a, and Bo, slot b) already set up.
// login(slot) makes a fresh session and returns what a request needs.
export function makeAppWithUsers(overrides = {}) {
  const ctx = makeApp(overrides);
  const names = overrides.names ?? ['Ada', 'Bo'];
  const [a, b] = createUsers(ctx.db, ctx.clock, names[0], names[1]);
  completeSetup(ctx.db, ctx.clock, a.setupToken, PASSPHRASES.a);
  completeSetup(ctx.db, ctx.clock, b.setupToken, PASSPHRASES.b);
  const users = { a, b };

  function login(slot) {
    const result = signIn(ctx.db, ctx.clock, users[slot].id, PASSPHRASES[slot]);
    if (!result.ok) throw new Error(`test sign in failed: ${result.error}`);
    const { cookieValue, csrf } = result.session;
    return {
      cookieValue,
      csrf,
      cookie: `${COOKIE_NAME}=${cookieValue}`,
      headers: { cookie: `${COOKIE_NAME}=${cookieValue}` },
      user: users[slot],
    };
  }

  return { ...ctx, users, login };
}

// Options for app.inject that send an urlencoded form body.
export function form(fields, headers = {}) {
  return {
    payload: new URLSearchParams(fields).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
  };
}
