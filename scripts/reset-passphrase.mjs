// Gives one person a new one-time setup path after a forgotten passphrase or a
// lost phone. Their old passphrase stops working and they are signed out on
// every phone. Prints only the path, on one line, to stdout.
// Usage: node scripts/reset-passphrase.mjs <name>

import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { systemClock } from '../src/core/clock.js';
import { issueResetLink } from '../src/core/auth.js';

const [name, ...extra] = process.argv.slice(2);
if (!name || extra.length > 0) {
  console.error('Usage: node scripts/reset-passphrase.mjs <name>');
  process.exit(1);
}

const config = loadConfig(process.env);
const db = openDb(path.join(config.dataDir, 'tandem.sqlite'));

const result = issueResetLink(db, systemClock, name);
if (!result.ok) {
  console.error(result.error === 'ambiguous' ? 'more than one person has that name' : 'no one has that name');
  process.exit(1);
}
console.log(`/setup/${result.setupToken}`);
