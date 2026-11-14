import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ANSWER_LENGTH,
  answersVisibleTo,
  currentRound,
  pastRounds,
  promptsFor,
  roundByWeek,
  saveDraft,
  stateFor,
  submit,
} from '../src/core/rounds.js';
import { makeAppWithUsers } from './helpers.js';

const ADA_SECRET = 'Ada private answer 7731';
const BO_SECRET = 'Bo private answer 4402';

// Wednesday 18 November 2026, noon in Melbourne. The week started Sunday the 15th.
function world(overrides) {
  const ctx = makeAppWithUsers(overrides);
  ctx.clock.set('2026-11-18T01:00:00Z');
  ctx.a = ctx.users.a.id;
  ctx.b = ctx.users.b.id;
  return ctx;
}

function bodies(rows) {
  return rows.map((r) => r.body);
}

// ---- creating and finding rounds ------------------------------------------

test('currentRound creates the round for this week once, with its rotating prompt', () => {
  const ctx = world();
  const round = currentRound(ctx);
  assert.equal(round.weekStart, '2026-11-15');
  assert.equal(round.rotatingPromptId, 'r14');
  assert.equal(round.revealedAt, null);
  assert.equal(currentRound(ctx).id, round.id);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM rounds').get().n, 1);
});

test('a new week gets a new round, and a different start day moves the week start', () => {
  const ctx = world();
  const first = currentRound(ctx);
  ctx.clock.set('2026-11-22T00:00:00Z'); // Sunday 22nd, 11am in Melbourne
  const next = currentRound(ctx);
  assert.notEqual(next.id, first.id);
  assert.equal(next.weekStart, '2026-11-22');
  assert.equal(next.rotatingPromptId, 'r15');

  const monday = world({ config: { checkinStartDay: 1 } });
  assert.equal(currentRound(monday).weekStart, '2026-11-16');
});

test('the week is worked out in the configured time zone', () => {
  const ctx = world();
  ctx.clock.set('2026-11-14T13:30:00Z'); // Saturday in UTC, already Sunday in Melbourne
  assert.equal(currentRound(ctx).weekStart, '2026-11-15');
});

test('roundByWeek finds a round or returns null', () => {
  const ctx = world();
  const round = currentRound(ctx);
  assert.equal(roundByWeek(ctx, '2026-11-15').id, round.id);
  assert.equal(roundByWeek(ctx, '2026-11-08'), null);
});

test('promptsFor lists the four fixed prompts then the rotating one, with text', () => {
  const ctx = world();
  const prompts = promptsFor(currentRound(ctx));
  assert.deepEqual(prompts.map((p) => p.id), ['appreciated', 'hard', 'need', 'next', 'r14']);
  assert.deepEqual(prompts.map((p) => p.rotating), [false, false, false, false, true]);
  assert.equal(prompts[4].text, 'Something I would like to say thank you for');
});

// ---- the visibility rule --------------------------------------------------

test('before reveal each person sees only their own answers, in both directions', () => {
  const ctx = world();
  const round = currentRound(ctx);
  assert.equal(saveDraft(ctx, round.id, ctx.a, { appreciated: ADA_SECRET }).ok, true);
  assert.equal(saveDraft(ctx, round.id, ctx.b, { appreciated: BO_SECRET }).ok, true);

  assert.deepEqual(bodies(answersVisibleTo(ctx, round.id, ctx.a)), [ADA_SECRET]);
  assert.deepEqual(bodies(answersVisibleTo(ctx, round.id, ctx.b)), [BO_SECRET]);

  submit(ctx, round.id, ctx.a); // only one has submitted: still hidden
  assert.deepEqual(bodies(answersVisibleTo(ctx, round.id, ctx.b)), [BO_SECRET]);
  assert.deepEqual(bodies(answersVisibleTo(ctx, round.id, ctx.a)), [ADA_SECRET]);
});

test('after reveal both see both sets, slot a first', () => {
  const ctx = world();
  const round = currentRound(ctx);
  saveDraft(ctx, round.id, ctx.b, { appreciated: BO_SECRET, hard: 'Bo hard' });
  saveDraft(ctx, round.id, ctx.a, { appreciated: ADA_SECRET });
  submit(ctx, round.id, ctx.b);
  const second = submit(ctx, round.id, ctx.a);
  assert.deepEqual(second, { ok: true, revealed: true });

  for (const viewer of [ctx.a, ctx.b]) {
    const rows = answersVisibleTo(ctx, round.id, viewer);
    assert.deepEqual(rows.map((r) => [r.slot, r.promptId, r.body]), [
      ['a', 'appreciated', ADA_SECRET],
      ['b', 'appreciated', BO_SECRET],
      ['b', 'hard', 'Bo hard'],
    ]);
  }
});

test('a person always sees their own drafts and submitted answers', () => {
  const ctx = world();
  const round = currentRound(ctx);
  saveDraft(ctx, round.id, ctx.a, { appreciated: ADA_SECRET });
  assert.deepEqual(bodies(answersVisibleTo(ctx, round.id, ctx.a)), [ADA_SECRET]);
  submit(ctx, round.id, ctx.a);
  assert.deepEqual(bodies(answersVisibleTo(ctx, round.id, ctx.a)), [ADA_SECRET]);
});

test('answersVisibleTo is empty for an unknown round or user', () => {
  const ctx = world();
  const round = currentRound(ctx);
  saveDraft(ctx, round.id, ctx.a, { appreciated: ADA_SECRET });
  assert.deepEqual(answersVisibleTo(ctx, 999, ctx.a), []);
  assert.deepEqual(answersVisibleTo(ctx, round.id, 999), []);
});

test('answers of different rounds do not mix', () => {
  const ctx = world();
  const first = currentRound(ctx);
  saveDraft(ctx, first.id, ctx.a, { appreciated: 'week one' });
  ctx.clock.set('2026-11-25T01:00:00Z');
  const second = currentRound(ctx);
  saveDraft(ctx, second.id, ctx.a, { appreciated: 'week two' });
  assert.deepEqual(bodies(answersVisibleTo(ctx, first.id, ctx.a)), ['week one']);
  assert.deepEqual(bodies(answersVisibleTo(ctx, second.id, ctx.a)), ['week two']);
});

// ---- drafts ---------------------------------------------------------------

test('a draft can be changed freely until submit, and then cannot', () => {
  const ctx = world();
  const round = currentRound(ctx);
  saveDraft(ctx, round.id, ctx.a, { appreciated: 'first version' });
  saveDraft(ctx, round.id, ctx.a, { appreciated: 'second version', hard: 'a hard thing' });
  // Ordered by prompt id: appreciated, then hard.
  assert.deepEqual(bodies(answersVisibleTo(ctx, round.id, ctx.a)), ['second version', 'a hard thing']);

  assert.equal(submit(ctx, round.id, ctx.a).ok, true);
  assert.deepEqual(saveDraft(ctx, round.id, ctx.a, { appreciated: 'sneaky change' }), {
    ok: false,
    error: 'already_submitted',
  });
  assert.deepEqual(bodies(answersVisibleTo(ctx, round.id, ctx.a)), ['second version', 'a hard thing']);
});

test('the other person can still edit their draft after one person submits', () => {
  const ctx = world();
  const round = currentRound(ctx);
  saveDraft(ctx, round.id, ctx.a, { appreciated: ADA_SECRET });
  submit(ctx, round.id, ctx.a);
  assert.equal(saveDraft(ctx, round.id, ctx.b, { appreciated: BO_SECRET }).ok, true);
});

test('a blank answer clears that prompt, and whitespace-only is never stored', () => {
  const ctx = world();
  const round = currentRound(ctx);
  saveDraft(ctx, round.id, ctx.a, { appreciated: 'something', hard: 'something else' });
  saveDraft(ctx, round.id, ctx.a, { appreciated: '', hard: '   \n\t ' });
  assert.deepEqual(answersVisibleTo(ctx, round.id, ctx.a), []);
  assert.equal(stateFor(ctx, round, ctx.a), 'not_started');
});

test('answers are trimmed and keep their inner line breaks', () => {
  const ctx = world();
  const round = currentRound(ctx);
  saveDraft(ctx, round.id, ctx.a, { appreciated: '  line one\nline two  \n' });
  assert.equal(answersVisibleTo(ctx, round.id, ctx.a)[0].body, 'line one\nline two');
});

test('the length limit is 2000 characters, and a refused save saves nothing', () => {
  const ctx = world();
  const round = currentRound(ctx);
  assert.equal(MAX_ANSWER_LENGTH, 2000);
  assert.equal(saveDraft(ctx, round.id, ctx.a, { appreciated: 'x'.repeat(2000) }).ok, true);

  const refused = saveDraft(ctx, round.id, ctx.a, { hard: 'kept?', need: 'y'.repeat(2001) });
  assert.deepEqual(refused, { ok: false, error: 'too_long', promptId: 'need' });
  assert.deepEqual(answersVisibleTo(ctx, round.id, ctx.a).map((r) => r.promptId), ['appreciated']);
});

test('unknown prompts, other rounds\' rotating prompts and bad input are refused', () => {
  const ctx = world();
  const round = currentRound(ctx);
  assert.equal(saveDraft(ctx, round.id, ctx.a, { nonsense: 'x' }).error, 'unknown_prompt');
  assert.equal(saveDraft(ctx, round.id, ctx.a, { r01: 'x' }).error, 'unknown_prompt');
  assert.equal(saveDraft(ctx, round.id, ctx.a, { [round.rotatingPromptId]: 'fine' }).ok, true);
  assert.equal(saveDraft(ctx, round.id, ctx.a, { appreciated: 42 }).error, 'invalid_answers');
  assert.equal(saveDraft(ctx, round.id, ctx.a, null).error, 'invalid_answers');
  assert.equal(saveDraft(ctx, round.id, ctx.a, ['x']).error, 'invalid_answers');
  assert.equal(saveDraft(ctx, 999, ctx.a, { appreciated: 'x' }).error, 'no_round');
});

// ---- submit and reveal ----------------------------------------------------

test('submit needs at least one real answer', () => {
  const ctx = world();
  const round = currentRound(ctx);
  assert.equal(submit(ctx, round.id, ctx.a).error, 'no_answers');
  saveDraft(ctx, round.id, ctx.a, { appreciated: '   ' });
  assert.equal(submit(ctx, round.id, ctx.a).error, 'no_answers');
  saveDraft(ctx, round.id, ctx.a, { appreciated: 'one real answer' });
  assert.deepEqual(submit(ctx, round.id, ctx.a), { ok: true, revealed: false });
});

test('submitting twice is refused', () => {
  const ctx = world();
  const round = currentRound(ctx);
  saveDraft(ctx, round.id, ctx.a, { appreciated: 'x' });
  submit(ctx, round.id, ctx.a);
  assert.equal(submit(ctx, round.id, ctx.a).error, 'already_submitted');
  assert.equal(currentRound(ctx).revealedAt, null, 'one person cannot reveal by submitting twice');
});

test('the second submission sets revealed_at, the first does not', () => {
  const ctx = world();
  const round = currentRound(ctx);
  saveDraft(ctx, round.id, ctx.a, { appreciated: ADA_SECRET });
  saveDraft(ctx, round.id, ctx.b, { appreciated: BO_SECRET });

  ctx.clock.set('2026-11-18T02:00:00Z');
  assert.deepEqual(submit(ctx, round.id, ctx.a), { ok: true, revealed: false });
  assert.equal(currentRound(ctx).revealedAt, null);

  ctx.clock.set('2026-11-19T05:30:00Z');
  assert.deepEqual(submit(ctx, round.id, ctx.b), { ok: true, revealed: true });
  assert.equal(currentRound(ctx).revealedAt, '2026-11-19T05:30:00.000Z');
});

test('nothing else sets revealed_at: saving, reading and listing leave it null', () => {
  const ctx = world();
  const round = currentRound(ctx);
  saveDraft(ctx, round.id, ctx.a, { appreciated: ADA_SECRET });
  saveDraft(ctx, round.id, ctx.b, { appreciated: BO_SECRET });
  answersVisibleTo(ctx, round.id, ctx.a);
  pastRounds(ctx, ctx.a);
  stateFor(ctx, round, ctx.a);
  assert.equal(currentRound(ctx).revealedAt, null);
});

test('a failed submit leaves the round untouched', () => {
  const ctx = world();
  const round = currentRound(ctx);
  submit(ctx, round.id, ctx.a); // refused: no answers
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM submissions').get().n, 0);
});

// ---- state ----------------------------------------------------------------

test('stateFor follows a person through the round', () => {
  const ctx = world();
  const round = currentRound(ctx);
  assert.equal(stateFor(ctx, round, ctx.a), 'not_started');
  saveDraft(ctx, round.id, ctx.a, { appreciated: ADA_SECRET });
  assert.equal(stateFor(ctx, round, ctx.a), 'draft');
  submit(ctx, round.id, ctx.a);
  assert.equal(stateFor(ctx, round, ctx.a), 'waiting');

  saveDraft(ctx, round.id, ctx.b, { appreciated: BO_SECRET });
  submit(ctx, round.id, ctx.b);
  const revealed = currentRound(ctx);
  assert.equal(stateFor(ctx, revealed, ctx.a), 'revealed');
  assert.equal(stateFor(ctx, revealed, ctx.b), 'revealed');
});

test('what a person is told never depends on what the other person has done', () => {
  // Same moves for Bo in four worlds; Ada does nothing, drafts, or submits.
  const adaMoves = {
    nothing: () => {},
    drafts: (ctx, round) => saveDraft(ctx, round.id, ctx.a, { appreciated: ADA_SECRET }),
    submits: (ctx, round) => {
      saveDraft(ctx, round.id, ctx.a, { appreciated: ADA_SECRET });
      submit(ctx, round.id, ctx.a);
    },
    opens_only: () => {},
  };
  const seen = {};
  for (const [name, move] of Object.entries(adaMoves)) {
    const ctx = world();
    const round = currentRound(ctx);
    move(ctx, round);
    const beforeDraft = stateFor(ctx, round, ctx.b);
    const visibleBefore = answersVisibleTo(ctx, round.id, ctx.b);
    saveDraft(ctx, round.id, ctx.b, { appreciated: BO_SECRET });
    const afterDraft = stateFor(ctx, round, ctx.b);
    seen[name] = { beforeDraft, afterDraft, visibleBefore, visibleAfter: answersVisibleTo(ctx, round.id, ctx.b), past: pastRounds(ctx, ctx.b) };
  }
  const baseline = seen.nothing;
  assert.equal(baseline.beforeDraft, 'not_started');
  assert.equal(baseline.afterDraft, 'draft');
  for (const [name, result] of Object.entries(seen)) {
    assert.deepEqual(result, baseline, `Bo's view changed when Ada ${name}`);
  }
});

// ---- the week ending ------------------------------------------------------

test('a round with one submission passes at the end of the week and never reveals', () => {
  const ctx = world();
  const round = currentRound(ctx);
  saveDraft(ctx, round.id, ctx.a, { appreciated: ADA_SECRET });
  submit(ctx, round.id, ctx.a);
  saveDraft(ctx, round.id, ctx.b, { appreciated: BO_SECRET });

  ctx.clock.set('2026-11-21T12:59:00Z'); // 23:59 Saturday in Melbourne: still open
  assert.equal(stateFor(ctx, round, ctx.a), 'waiting');
  assert.equal(stateFor(ctx, round, ctx.b), 'draft');

  ctx.clock.set('2026-11-21T13:00:00Z'); // midnight: the week is over
  assert.equal(stateFor(ctx, round, ctx.a), 'passed');
  assert.equal(stateFor(ctx, round, ctx.b), 'passed');

  assert.deepEqual(bodies(answersVisibleTo(ctx, round.id, ctx.a)), [ADA_SECRET]);
  assert.deepEqual(bodies(answersVisibleTo(ctx, round.id, ctx.b)), [BO_SECRET], 'Bo still cannot see Ada\'s');
});

test('a late submit is refused, so a passed round cannot be revealed afterwards', () => {
  const ctx = world();
  const round = currentRound(ctx);
  saveDraft(ctx, round.id, ctx.a, { appreciated: ADA_SECRET });
  submit(ctx, round.id, ctx.a);
  saveDraft(ctx, round.id, ctx.b, { appreciated: BO_SECRET });

  ctx.clock.set('2026-12-02T01:00:00Z');
  assert.equal(submit(ctx, round.id, ctx.b).error, 'round_closed');
  assert.equal(saveDraft(ctx, round.id, ctx.b, { appreciated: 'too late' }).error, 'round_closed');
  const stored = roundByWeek(ctx, '2026-11-15');
  assert.equal(stored.revealedAt, null);
  assert.deepEqual(bodies(answersVisibleTo(ctx, round.id, ctx.b)), [BO_SECRET]);
});

test('a revealed round stays revealed after the week ends', () => {
  const ctx = world();
  const round = currentRound(ctx);
  saveDraft(ctx, round.id, ctx.a, { appreciated: ADA_SECRET });
  saveDraft(ctx, round.id, ctx.b, { appreciated: BO_SECRET });
  submit(ctx, round.id, ctx.a);
  submit(ctx, round.id, ctx.b);
  ctx.clock.set('2027-01-10T01:00:00Z');
  const stored = roundByWeek(ctx, '2026-11-15');
  assert.equal(stateFor(ctx, stored, ctx.a), 'revealed');
  assert.equal(answersVisibleTo(ctx, stored.id, ctx.b).length, 2);
});

// ---- the past list --------------------------------------------------------

test('pastRounds lists revealed rounds and rounds you wrote in, newest first', () => {
  const ctx = world();
  const w1 = currentRound(ctx); // 15 Nov: revealed
  saveDraft(ctx, w1.id, ctx.a, { appreciated: ADA_SECRET });
  saveDraft(ctx, w1.id, ctx.b, { appreciated: BO_SECRET });
  submit(ctx, w1.id, ctx.a);
  submit(ctx, w1.id, ctx.b);

  ctx.clock.set('2026-11-25T01:00:00Z');
  const w2 = currentRound(ctx); // 22 Nov: only Ada wrote
  saveDraft(ctx, w2.id, ctx.a, { appreciated: 'Ada only' });

  ctx.clock.set('2026-12-02T01:00:00Z');
  currentRound(ctx); // 29 Nov, the current week

  const adas = pastRounds(ctx, ctx.a);
  assert.deepEqual(adas.map((r) => [r.weekStart, r.state]), [['2026-11-22', 'passed'], ['2026-11-15', 'revealed']]);

  const bos = pastRounds(ctx, ctx.b);
  assert.deepEqual(bos.map((r) => [r.weekStart, r.state]), [['2026-11-15', 'revealed']]);
});

test('a past round only the other person opened is not listed', () => {
  const ctx = world();
  currentRound(ctx); // someone opened it, nobody wrote
  ctx.clock.set('2026-12-02T01:00:00Z');
  currentRound(ctx);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM rounds').get().n, 2);
  assert.deepEqual(pastRounds(ctx, ctx.a), []);
  assert.deepEqual(pastRounds(ctx, ctx.b), []);
});

test('the current round is not in the past list', () => {
  const ctx = world();
  const round = currentRound(ctx);
  saveDraft(ctx, round.id, ctx.a, { appreciated: 'x' });
  assert.deepEqual(pastRounds(ctx, ctx.a), []);
});
