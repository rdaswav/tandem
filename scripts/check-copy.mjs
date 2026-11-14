// Checks the app's own copy: no em dash and none of the banned words in
// src/views or prompts. Usage: node scripts/check-copy.mjs [rootDir]
// Exits 0 when clean, otherwise prints each hit as file:line and exits 1.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

const EM_DASH = '—';
const BANNED = ['streak', 'score', 'overdue', 'late', 'failed', 'missed', 'reminder', 'should', 'must'];
const bannedRe = new RegExp(`\\b(${BANNED.join('|')})\\b`, 'i');

function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(full);
    return /\.(js|mjs|json|html|md)$/.test(entry.name) ? [full] : [];
  });
}

const hits = [];
for (const dir of ['src/views', 'prompts']) {
  for (const file of filesUnder(path.join(root, dir))) {
    fs.readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        const where = `${path.relative(root, file)}:${i + 1}`;
        if (line.includes(EM_DASH)) hits.push(`${where}: em dash`);
        const m = bannedRe.exec(line);
        if (m) hits.push(`${where}: banned word "${m[1]}"`);
      });
  }
}

if (hits.length > 0) {
  console.error(hits.join('\n'));
  process.exit(1);
}
console.log('copy ok');
