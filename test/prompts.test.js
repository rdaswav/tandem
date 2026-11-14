import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPrompts, promptText, rotatingFor, validatePack } from '../src/core/prompts.js';
import { addDays } from '../src/core/week.js';

function validPack() {
  return {
    version: 1,
    fixed: [{ id: 'one', text: 'First' }],
    rotating: Array.from({ length: 12 }, (_, i) => ({ id: `q${i}`, text: `Question ${i}` })),
  };
}

function problems(mutate) {
  const pack = validPack();
  mutate(pack);
  return validatePack(pack);
}

test('a valid pack has no problems', () => {
  assert.deepEqual(validatePack(validPack()), []);
});

// One failing case per rule.
const failing = [
  ['not an object', () => validatePack(null), /must be an object/],
  ['an array instead of an object', () => validatePack([]), /must be an object/],
  ['missing version', () => problems((p) => delete p.version), /version/],
  ['version zero', () => problems((p) => (p.version = 0)), /version/],
  ['fixed is not a list', () => problems((p) => (p.fixed = 'x')), /fixed must be a list/],
  ['fixed is empty', () => problems((p) => (p.fixed = [])), /fixed must have 1 to 6/],
  ['fixed has seven entries', () => problems((p) => (p.fixed = Array.from({ length: 7 }, (_, i) => ({ id: `f${i}`, text: 'x' })))), /fixed must have 1 to 6/],
  ['rotating is not a list', () => problems((p) => (p.rotating = {})), /rotating must be a list/],
  ['rotating has eleven entries', () => problems((p) => p.rotating.pop()), /at least 12/],
  ['an upper case id', () => problems((p) => (p.fixed[0].id = 'Upper')), /id must be lower case/],
  ['an id with a space', () => problems((p) => (p.fixed[0].id = 'a b')), /id must be lower case/],
  ['an id with a dash', () => problems((p) => (p.fixed[0].id = 'a-b')), /id must be lower case/],
  ['an empty id', () => problems((p) => (p.fixed[0].id = '')), /id must be lower case/],
  ['a missing id', () => problems((p) => delete p.fixed[0].id), /id must be lower case/],
  ['a duplicate id inside rotating', () => problems((p) => (p.rotating[1].id = p.rotating[0].id)), /duplicate id/],
  ['an id shared by fixed and rotating', () => problems((p) => (p.rotating[0].id = 'one')), /duplicate id "one"/],
  ['empty text', () => problems((p) => (p.fixed[0].text = '')), /text must not be empty/],
  ['whitespace-only text', () => problems((p) => (p.rotating[0].text = '   ')), /text must not be empty/],
  ['text that is not a string', () => problems((p) => (p.rotating[0].text = 5)), /text must not be empty/],
  ['text of 141 characters', () => problems((p) => (p.rotating[0].text = 'x'.repeat(141))), /longer than 140/],
  ['an entry that is not an object', () => problems((p) => (p.rotating[0] = 'text')), /must be an object/],
];

for (const [label, run, expected] of failing) {
  test(`validator rejects: ${label}`, () => {
    const errors = run();
    assert.ok(errors.length > 0, 'expected at least one problem');
    assert.match(errors.join('\n'), expected);
  });
}

test('text of exactly 140 characters is accepted', () => {
  assert.deepEqual(problems((p) => (p.rotating[0].text = 'x'.repeat(140))), []);
});

test('the length limit counts characters, not bytes', () => {
  assert.deepEqual(problems((p) => (p.rotating[0].text = 'é'.repeat(140))), []);
  assert.ok(problems((p) => (p.rotating[0].text = 'é'.repeat(141))).length > 0);
});

test('a bad pack reports every problem, not just the first', () => {
  const errors = problems((p) => {
    p.fixed[0].id = 'Bad';
    p.rotating[0].text = '';
  });
  assert.equal(errors.length, 2);
});

// ---- the shipped pack -----------------------------------------------------

test('the shipped pack is valid and has the four fixed prompts in order', () => {
  const pack = loadPrompts();
  assert.deepEqual(validatePack(pack), []);
  assert.deepEqual(pack.fixed.map((p) => p.id), ['appreciated', 'hard', 'need', 'next']);
  assert.equal(pack.rotating.length, 16);
});

test('no shipped prompt asks one person to rate or grade the other', () => {
  const pack = loadPrompts();
  for (const p of [...pack.fixed, ...pack.rotating]) {
    assert.doesNotMatch(p.text, /\b(rate|rating|grade|rank|score|judge)\b/i, p.id);
  }
});

test('loadPrompts throws a readable error for an invalid file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-prompts-'));
  try {
    const file = path.join(dir, 'bad.json');
    fs.writeFileSync(file, JSON.stringify({ version: 1, fixed: [], rotating: [] }));
    assert.throws(() => loadPrompts(file), /invalid prompt pack: .*fixed must have 1 to 6/);
    fs.writeFileSync(file, '{ not json');
    assert.throws(() => loadPrompts(file), SyntaxError);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- rotation -------------------------------------------------------------

test('rotatingFor starts at the first question on the epoch and moves one a week', () => {
  assert.equal(rotatingFor('2026-01-04').id, 'r01');
  assert.equal(rotatingFor('2026-01-11').id, 'r02');
  assert.equal(rotatingFor('2026-01-18').id, 'r03');
});

test('rotatingFor wraps after the pack length (16 weeks)', () => {
  assert.equal(rotatingFor('2026-04-26').id, 'r01');
  assert.equal(rotatingFor('2026-05-03').id, 'r02');
});

test('rotatingFor for a known recent week', () => {
  // 315 days after the epoch is 45 weeks; 45 mod 16 is 13, the fourteenth question.
  assert.equal(rotatingFor('2026-11-15').id, 'r14');
});

test('rotatingFor works before the epoch', () => {
  assert.equal(rotatingFor('2025-12-28').id, 'r16');
  assert.equal(rotatingFor('2025-12-21').id, 'r15');
});

test('rotatingFor is stable across a week for any start day and moves on the next', () => {
  // Start days 0, 1 and 6: a week start is the date the week begins on, and
  // the same date always gives the same question; the next week gives the next.
  for (const first of ['2026-11-15', '2026-11-16', '2026-11-14']) {
    const now = rotatingFor(first);
    assert.equal(rotatingFor(first).id, now.id);
    const next = rotatingFor(addDays(first, 7));
    assert.notEqual(next.id, now.id);
  }
  // Seven consecutive weeks give seven different questions.
  const ids = new Set(Array.from({ length: 7 }, (_, i) => rotatingFor(addDays('2026-11-16', i * 7)).id));
  assert.equal(ids.size, 7);
});

test('rotatingFor uses the pack it is given', () => {
  const pack = validPack();
  assert.equal(rotatingFor('2026-01-04', pack).id, 'q0');
  assert.equal(rotatingFor('2026-01-11', pack).id, 'q1');
  assert.equal(rotatingFor('2026-03-29', pack).id, 'q0'); // 12 weeks later
});

test('promptText finds fixed and rotating prompts and falls back to the id', () => {
  assert.equal(promptText('appreciated'), 'Something I appreciated about you this week');
  assert.equal(promptText('r01'), 'A small thing that made me laugh this week');
  assert.equal(promptText('removed_long_ago'), 'removed_long_ago');
});
