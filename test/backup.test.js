import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../src/db.js';
import { createUsers } from '../src/core/auth.js';
import { fakeClock } from '../src/core/clock.js';
import { SNAPSHOT_NAME, scheduleSnapshots, writeSnapshot } from '../src/core/backup.js';

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-backup-test-'));
}

function countRows(file, table) {
  const db = new DatabaseSync(file);
  try {
    return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  } finally {
    db.close();
  }
}

// Every file under dir, as paths relative to dir, with its contents hashed.
function listing(dir, skip = null) {
  const out = {};
  const walk = (current) => {
    for (const name of fs.readdirSync(current)) {
      const full = path.join(current, name);
      if (skip && full === skip) continue;
      if (fs.statSync(full).isDirectory()) walk(full);
      else out[path.relative(dir, full)] = fs.readFileSync(full).toString('base64');
    }
  };
  walk(dir);
  return out;
}

test('a snapshot opens as a valid database that holds the rows written before it', () => {
  const dir = tempDataDir();
  try {
    const db = openDb(path.join(dir, 'tandem.sqlite'));
    createUsers(db, fakeClock(), 'Ada', 'Bo');
    const { file } = writeSnapshot(db, dir, fakeClock());

    assert.equal(countRows(file, 'users'), 2);
    const check = new DatabaseSync(file);
    try {
      assert.equal(check.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    } finally {
      check.close();
    }
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a snapshot holds rows that are still only in the write-ahead log, which a plain copy of the main file misses', () => {
  const dir = tempDataDir();
  try {
    const live = path.join(dir, 'tandem.sqlite');
    const db = openDb(live);
    createUsers(db, fakeClock(), 'Ada', 'Bo');
    // Nothing has been checkpointed yet, so the rows are in the -wal file.
    assert.ok(fs.statSync(`${live}-wal`).size > 0, 'the rows are in the write-ahead log');

    const plainCopy = path.join(dir, 'plain-copy.sqlite');
    fs.copyFileSync(live, plainCopy);
    let seenByPlainCopy;
    try {
      seenByPlainCopy = countRows(plainCopy, 'users');
    } catch {
      seenByPlainCopy = 'no users table';
    }
    assert.notEqual(seenByPlainCopy, 2, 'the plain copy of the main file does not have both people');

    const { file } = writeSnapshot(db, dir, fakeClock());
    assert.equal(countRows(file, 'users'), 2, 'the snapshot has both people');
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a snapshot taken while another connection has uncommitted writes holds only the committed rows', () => {
  const dir = tempDataDir();
  try {
    const live = path.join(dir, 'tandem.sqlite');
    const db = openDb(live);
    createUsers(db, fakeClock(), 'Ada', 'Bo');

    const writer = new DatabaseSync(live);
    writer.exec('PRAGMA foreign_keys = ON');
    writer.exec('BEGIN');
    writer.prepare('INSERT INTO rounds (week_start, rotating_prompt_id, created_at) VALUES (?, ?, ?)').run(
      '2026-11-08',
      'p-invented',
      '2026-11-08T00:00:00Z',
    );
    try {
      const { file } = writeSnapshot(db, dir, fakeClock());
      assert.equal(countRows(file, 'users'), 2);
      assert.equal(countRows(file, 'rounds'), 0, 'the uncommitted round is not in the snapshot');
    } finally {
      writer.exec('ROLLBACK');
      writer.close();
    }
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('each snapshot replaces the last one: only one file is kept', () => {
  const dir = tempDataDir();
  try {
    const db = openDb(path.join(dir, 'tandem.sqlite'));
    createUsers(db, fakeClock(), 'Ada', 'Bo');
    writeSnapshot(db, dir, fakeClock());
    writeSnapshot(db, dir, fakeClock());
    writeSnapshot(db, dir, fakeClock());
    assert.deepEqual(fs.readdirSync(path.join(dir, 'backup')), [SNAPSHOT_NAME]);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a failed snapshot leaves the previous snapshot intact and no partial file behind', () => {
  const dir = tempDataDir();
  try {
    const db = openDb(path.join(dir, 'tandem.sqlite'));
    createUsers(db, fakeClock(), 'Ada', 'Bo');
    const { file } = writeSnapshot(db, dir, fakeClock());
    const before = fs.readFileSync(file);

    // The fake writes a partial file under the name it is given, then fails.
    const broken = {
      prepare() {
        return {
          run(tempName) {
            fs.writeFileSync(tempName, 'partial copy');
            throw new Error('disk full (simulated)');
          },
        };
      },
    };
    assert.throws(() => writeSnapshot(broken, dir, fakeClock()), /disk full/);

    assert.deepEqual(fs.readFileSync(file), before, 'the old snapshot is unchanged');
    assert.deepEqual(fs.readdirSync(path.join(dir, 'backup')), [SNAPSHOT_NAME]);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a temporary file left by an earlier crash is removed on the next snapshot', () => {
  const dir = tempDataDir();
  try {
    const db = openDb(path.join(dir, 'tandem.sqlite'));
    createUsers(db, fakeClock(), 'Ada', 'Bo');
    fs.mkdirSync(path.join(dir, 'backup'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'backup', '.writing-leftover.tmp'), 'partial');
    writeSnapshot(db, dir, fakeClock());
    assert.deepEqual(fs.readdirSync(path.join(dir, 'backup')), [SNAPSHOT_NAME]);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a snapshot writes only inside the backup folder and changes nothing else', () => {
  const dir = tempDataDir();
  try {
    const live = path.join(dir, 'tandem.sqlite');
    const db = openDb(live);
    createUsers(db, fakeClock(), 'Ada', 'Bo');
    db.close();
    const backupDir = path.join(dir, 'backup');
    const before = listing(dir);

    const reopened = openDb(live);
    writeSnapshot(reopened, dir, fakeClock());
    reopened.close();

    const after = listing(dir, backupDir);
    assert.deepEqual(after, before, 'everything outside backup/ is byte-for-byte the same');
    assert.deepEqual(fs.readdirSync(backupDir), [SNAPSHOT_NAME]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the snapshot is taken at start and then on a timer that does not keep the process alive', async () => {
  const dir = tempDataDir();
  try {
    const db = openDb(path.join(dir, 'tandem.sqlite'));
    createUsers(db, fakeClock(), 'Ada', 'Bo');
    const logged = [];
    const timer = scheduleSnapshots({
      db,
      dataDir: dir,
      clock: fakeClock(),
      every: 20,
      log: (line) => logged.push(line),
    });
    try {
      assert.equal(timer.hasRef(), false, 'the timer is unref-ed');
      assert.ok(fs.existsSync(path.join(dir, 'backup', SNAPSHOT_NAME)), 'a snapshot exists straight away');
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.ok(logged.length >= 2, 'the timer took more than one snapshot');
      assert.deepEqual([...new Set(logged)], ['snapshot'], 'only the word snapshot is logged');
    } finally {
      clearInterval(timer);
    }
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a failed scheduled snapshot logs a word only, with no path, error text or content', () => {
  const dir = tempDataDir();
  try {
    const broken = {
      prepare() {
        return {
          run() {
            throw new Error(`secret path ${dir}`);
          },
        };
      },
    };
    const logged = [];
    const timer = scheduleSnapshots({
      db: broken,
      dataDir: dir,
      clock: fakeClock(),
      every: 60_000,
      log: (line) => logged.push(line),
    });
    clearInterval(timer);
    assert.deepEqual(logged, ['snapshot failed']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the backup code never names the answers table, so the privacy rule still holds', () => {
  const source = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'core', 'backup.js'), 'utf8');
  assert.doesNotMatch(source, /answers/);
  assert.equal(source.includes('—'), false, 'no em dash');
});
