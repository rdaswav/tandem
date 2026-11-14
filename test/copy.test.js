import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'check-copy.mjs');
const EM_DASH = '—';

function runOn(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-copy-'));
  try {
    for (const [name, text] of Object.entries(files)) {
      const full = path.join(root, name);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, text);
    }
    return spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('clean copy passes', () => {
  const res = runOn({
    'src/views/a.js': 'const x = "You are done. This opens when you have both finished.";\n',
    'prompts/prompts.json': '{"fixed":[{"id":"x","text":"Something I appreciated"}]}\n',
  });
  assert.equal(res.status, 0, res.stderr);
});

test('an em dash in a view fails and names the file and line', () => {
  const res = runOn({ 'src/views/a.js': `line one\nbad ${EM_DASH} here\n` });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /src\/views\/a\.js:2: em dash/);
});

test('each banned word fails, case insensitive and whole word only', () => {
  for (const word of ['streak', 'score', 'overdue', 'late', 'failed', 'missed', 'reminder', 'should', 'must']) {
    const res = runOn({ 'src/views/a.js': `text: "You ${word.toUpperCase()} do it"\n` });
    assert.equal(res.status, 1, `${word} was not caught`);
    assert.match(res.stderr, new RegExp(`banned word "${word}"`, 'i'));
  }
  const fine = runOn({ 'src/views/a.js': 'translate chocolate scored relate mustard\n' });
  assert.equal(fine.status, 0, fine.stderr);
});

test('banned words in prompts fail too', () => {
  const res = runOn({ 'prompts/prompts.json': '{"text":"Your streak this week"}\n' });
  assert.equal(res.status, 1);
});

test('files outside src/views and prompts are not scanned', () => {
  const res = runOn({ 'src/core/a.js': 'must should late\n', 'test/a.js': 'must\n' });
  assert.equal(res.status, 0, res.stderr);
});

test('the real views and prompts are clean', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const res = spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
});
