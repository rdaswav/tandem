import { openDb } from '../src/db.js';
import { buildApp } from '../src/server.js';
import { fakeClock } from '../src/core/clock.js';

export { fakeClock };

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
