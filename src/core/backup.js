// Consistent copies of the database, for the NAS backup. VACUUM INTO writes a
// complete copy that is consistent even while the app is writing, so the
// backup never has to copy the live file and its write-ahead log by hand.
// No HTTP in here, and the logger is passed in.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const BACKUP_DIR = 'backup';
export const SNAPSHOT_NAME = 'tandem-snapshot.sqlite';
export const SNAPSHOT_EVERY_MS = 24 * 60 * 60 * 1000;

const TEMP_PREFIX = '.writing-';

// Writes one snapshot into <dataDir>/backup/. The copy is written under a
// temporary name and then renamed over the last snapshot, so a reader sees
// either the old file or the new one, never a part-written file. Only one
// snapshot is kept, and any temporary file left by an earlier crash is removed.
export function writeSnapshot(db, dataDir, clock) {
  const dir = path.join(dataDir, BACKUP_DIR);
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith(TEMP_PREFIX)) fs.rmSync(path.join(dir, name), { force: true });
  }

  const temp = path.join(dir, `${TEMP_PREFIX}${crypto.randomBytes(8).toString('hex')}.tmp`);
  const target = path.join(dir, SNAPSHOT_NAME);
  try {
    db.prepare('VACUUM INTO ?').run(temp);
    fs.renameSync(temp, target);
  } catch (err) {
    fs.rmSync(temp, { force: true });
    throw err;
  }
  return { file: target, takenAt: clock.now().toISOString() };
}

// Takes a snapshot now, then one every `every` milliseconds. The timer does
// not keep the process alive. A failed snapshot is logged as a word only, so
// no path, no content and no error text reaches the log.
export function scheduleSnapshots({ db, dataDir, clock, every = SNAPSHOT_EVERY_MS, log = () => {} }) {
  const take = () => {
    try {
      writeSnapshot(db, dataDir, clock);
      log('snapshot');
    } catch {
      log('snapshot failed');
    }
  };
  take();
  const timer = setInterval(take, every);
  timer.unref();
  return timer;
}
