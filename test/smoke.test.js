import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, migrate } from '../src/db.js';
import { makeApp } from './helpers.js';

test('GET /healthz returns 200 and ok', async () => {
  const { app } = makeApp();
  const res = await app.inject({ method: 'GET', url: '/healthz' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
});

test('migrations apply twice on the same database without error', () => {
  const db = openDb(':memory:');
  assert.doesNotThrow(() => migrate(db));
  const rows = db.prepare('SELECT name FROM schema_migrations').all();
  assert.deepEqual(rows.map((r) => r.name), ['001_init.sql']);
});

test('the initial migration creates every table in the design', () => {
  const db = openDb(':memory:');
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((r) => r.name);
  for (const table of [
    'users', 'sessions', 'signin_attempts', 'rounds', 'answers',
    'submissions', 'moments', 'ideas', 'agreements', 'talks',
  ]) {
    assert.ok(names.includes(table), `missing table ${table}`);
  }
});
