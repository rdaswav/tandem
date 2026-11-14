import { openDb } from '../src/db.js';
import { buildApp } from '../src/server.js';

export function fakeClock(iso = '2026-11-15T01:00:00Z') {
  let current = new Date(iso);
  return {
    now: () => new Date(current),
    set: (next) => {
      current = new Date(next);
    },
  };
}

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
