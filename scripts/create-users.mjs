// Makes the two users and prints their one-time setup paths, in the order the
// names were given, one per line. Nothing else is written to stdout.
// Usage: node scripts/create-users.mjs <name for the first person> <name for the second person>

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { systemClock } from '../src/core/clock.js';
import { createUsers } from '../src/core/auth.js';

const [nameA, nameB, ...extra] = process.argv.slice(2);
if (!nameA || !nameB || extra.length > 0) {
  console.error('Usage: node scripts/create-users.mjs <first name> <second name>');
  process.exit(1);
}

const config = loadConfig(process.env);
fs.mkdirSync(config.dataDir, { recursive: true });
const db = openDb(path.join(config.dataDir, 'tandem.sqlite'));

try {
  for (const user of createUsers(db, systemClock, nameA, nameB)) {
    console.log(`/setup/${user.setupToken}`);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
