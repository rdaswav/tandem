import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUsers } from '../src/core/auth.js';
import { logPath } from '../src/server.js';
import { form, makeApp } from './helpers.js';

// Runs fn while catching every console.log line.
async function captureLog(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...parts) => lines.push(parts.join(' '));
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines;
}

test('the log never holds a setup token, used or not', async () => {
  const { app, db, clock } = makeApp({ config: { log: true } });
  const [a, b] = createUsers(db, clock, 'Ada', 'Bo');
  const lines = await captureLog(async () => {
    await app.inject({ method: 'GET', url: `/setup/${a.setupToken}` });
    await app.inject({ method: 'POST', url: `/setup/${a.setupToken}`, ...form({ passphrase: 'short', confirm: 'short' }) });
    await app.inject({ method: 'GET', url: `/setup/${b.setupToken}?x=1` });
    await app.inject({
      method: 'POST',
      url: `/setup/${b.setupToken}`,
      ...form({ passphrase: 'a fine long phrase', confirm: 'a fine long phrase' }),
    });
  });
  assert.equal(lines.length, 4);
  for (const line of lines) {
    assert.ok(!line.includes(a.setupToken) && !line.includes(b.setupToken), line);
    assert.match(line, /^(GET|POST) \/setup\/:token \d{3}$/);
  }
});

test('the log keeps method, path and status for other routes', async () => {
  const { app } = makeApp({ config: { log: true } });
  const lines = await captureLog(() => app.inject({ method: 'GET', url: '/signin?passphrase=nope' }));
  assert.deepEqual(lines, ['GET /signin 200']);
});

test('logPath hides only the setup token', () => {
  assert.equal(logPath('/setup/abc-DEF_123'), '/setup/:token');
  assert.equal(logPath('/setup/abc/extra?q=1'), '/setup/:token/extra');
  assert.equal(logPath('/moments/3/edit'), '/moments/3/edit');
  assert.equal(logPath('/checkin/2026-11-15?x=y'), '/checkin/2026-11-15');
});
