import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIONS,
  ACTIVE_STATES,
  TOTAL_STEPS,
  activeTalk,
  applyAction,
  getTalk,
  listTalks,
  next,
  proposeTalk,
} from '../src/core/talks.js';
import { makeAppWithUsers } from './helpers.js';

// A talk as the state machine sees it.
const talk = (state, step, proposerSlot, firstSpeaker = null) =>
  Object.freeze({ state, step, proposerSlot, firstSpeaker });

// ---- the state machine: one row per cell of the table in Architecture 6.6 --
// [state and step, proposer, action, who acts, expected]
// Expected is an error name, or the new { state, step, firstSpeaker }.
const NONE = null;
const rows = [
  // proposed: accept and not_now by the other person only, withdraw by the proposer only
  [talk('proposed', 0, 'a'), 'accept', 'b', { state: 'ready', step: 0, firstSpeaker: NONE }],
  [talk('proposed', 0, 'a'), 'accept', 'a', 'wrong_person'],
  [talk('proposed', 0, 'a'), 'not_now', 'b', { state: 'set_aside', step: 0, firstSpeaker: NONE }],
  [talk('proposed', 0, 'a'), 'not_now', 'a', 'wrong_person'],
  [talk('proposed', 0, 'a'), 'withdraw', 'a', { state: 'withdrawn', step: 0, firstSpeaker: NONE }],
  [talk('proposed', 0, 'a'), 'withdraw', 'b', 'wrong_person'],
  [talk('proposed', 0, 'b'), 'accept', 'a', { state: 'ready', step: 0, firstSpeaker: NONE }],
  [talk('proposed', 0, 'b'), 'accept', 'b', 'wrong_person'],
  [talk('proposed', 0, 'b'), 'not_now', 'a', { state: 'set_aside', step: 0, firstSpeaker: NONE }],
  [talk('proposed', 0, 'b'), 'withdraw', 'b', { state: 'withdrawn', step: 0, firstSpeaker: NONE }],
  [talk('proposed', 0, 'b'), 'withdraw', 'a', 'wrong_person'],

  // ready: start by either person, first speaker is the proposer, step 1
  [talk('ready', 0, 'a'), 'start', 'a', { state: 'in_progress', step: 1, firstSpeaker: 'a' }],
  [talk('ready', 0, 'a'), 'start', 'b', { state: 'in_progress', step: 1, firstSpeaker: 'a' }],
  [talk('ready', 0, 'b'), 'start', 'a', { state: 'in_progress', step: 1, firstSpeaker: 'b' }],
  [talk('ready', 0, 'b'), 'start', 'b', { state: 'in_progress', step: 1, firstSpeaker: 'b' }],

  // in_progress: advance to the next step, or to closing after the last; pause; end
  [talk('in_progress', 1, 'a', 'a'), 'advance', 'a', { state: 'in_progress', step: 2, firstSpeaker: 'a' }],
  [talk('in_progress', 3, 'a', 'a'), 'advance', 'b', { state: 'in_progress', step: 4, firstSpeaker: 'a' }],
  [talk('in_progress', 6, 'b', 'b'), 'advance', 'a', { state: 'in_progress', step: 7, firstSpeaker: 'b' }],
  [talk('in_progress', 7, 'a', 'a'), 'advance', 'a', { state: 'closing', step: 7, firstSpeaker: 'a' }],
  [talk('in_progress', 7, 'a', 'a'), 'advance', 'b', { state: 'closing', step: 7, firstSpeaker: 'a' }],
  [talk('in_progress', 4, 'a', 'a'), 'pause', 'a', { state: 'paused', step: 4, firstSpeaker: 'a' }],
  [talk('in_progress', 4, 'a', 'a'), 'pause', 'b', { state: 'paused', step: 4, firstSpeaker: 'a' }],
  [talk('in_progress', 2, 'b', 'b'), 'end', 'a', { state: 'closed', step: 2, firstSpeaker: 'b' }],
  [talk('in_progress', 2, 'b', 'b'), 'end', 'b', { state: 'closed', step: 2, firstSpeaker: 'b' }],

  // paused: resume at the same step, or end
  [talk('paused', 5, 'a', 'a'), 'resume', 'a', { state: 'in_progress', step: 5, firstSpeaker: 'a' }],
  [talk('paused', 5, 'a', 'a'), 'resume', 'b', { state: 'in_progress', step: 5, firstSpeaker: 'a' }],
  [talk('paused', 5, 'a', 'a'), 'end', 'a', { state: 'closed', step: 5, firstSpeaker: 'a' }],
  [talk('paused', 5, 'a', 'a'), 'end', 'b', { state: 'closed', step: 5, firstSpeaker: 'a' }],

  // closing: finish by either person
  [talk('closing', 7, 'a', 'a'), 'finish', 'a', { state: 'closed', step: 7, firstSpeaker: 'a' }],
  [talk('closing', 7, 'a', 'a'), 'finish', 'b', { state: 'closed', step: 7, firstSpeaker: 'a' }],
];

for (const [from, action, actor, expected] of rows) {
  test(`${from.state} (step ${from.step}, proposer ${from.proposerSlot}): ${action} by ${actor}`, () => {
    const result = next(from, action, actor);
    if (typeof expected === 'string') {
      assert.deepEqual(result, { ok: false, error: expected });
    } else {
      assert.equal(result.ok, true);
      assert.deepEqual(
        { state: result.talk.state, step: result.talk.step, firstSpeaker: result.talk.firstSpeaker },
        expected,
      );
      assert.equal(result.talk.proposerSlot, from.proposerSlot, 'the proposer never changes');
    }
  });
}

test('the action list is exactly the nine in the design', () => {
  assert.deepEqual(
    [...ACTIONS].sort(),
    ['accept', 'advance', 'end', 'finish', 'not_now', 'pause', 'resume', 'start', 'withdraw'],
  );
  assert.equal(TOTAL_STEPS, 7);
  assert.deepEqual([...ACTIVE_STATES].sort(), ['closing', 'in_progress', 'paused', 'proposed', 'ready']);
});

// What each state allows, written out again here on purpose rather than read from the code.
const LISTED = {
  proposed: ['accept', 'not_now', 'withdraw'],
  ready: ['start'],
  in_progress: ['advance', 'end', 'pause'],
  paused: ['end', 'resume'],
  closing: ['finish'],
  set_aside: [],
  withdrawn: [],
  closed: [],
};

test('every action not listed for a state is refused, for both people', () => {
  let refused = 0;
  for (const [state, listed] of Object.entries(LISTED)) {
    for (const action of ACTIONS) {
      if (listed.includes(action)) continue;
      for (const actor of ['a', 'b']) {
        const result = next(talk(state, state === 'in_progress' ? 3 : 0, 'a', 'a'), action, actor);
        assert.deepEqual(result, { ok: false, error: 'not_allowed' }, `${state} ${action} by ${actor}`);
        refused += 1;
      }
    }
  }
  // 8 states times 9 actions is 72; the design allows 10 of them (3 + 1 + 3 + 2 + 1), so 62 are refused for each person.
  assert.equal(refused, (8 * 9 - 10) * 2, 'every other combination was tried');
});

test('a finished talk allows nothing at all', () => {
  for (const state of ['set_aside', 'withdrawn', 'closed']) {
    for (const action of ACTIONS) {
      assert.equal(next(talk(state, 7, 'a', 'a'), action, 'a').ok, false, `${state} ${action}`);
    }
  }
});

test('an unknown action, a bad actor or an unknown state is refused', () => {
  const t = talk('in_progress', 2, 'a', 'a');
  assert.deepEqual(next(t, 'frobnicate', 'a'), { ok: false, error: 'unknown_action' });
  assert.deepEqual(next(t, 'constructor', 'a'), { ok: false, error: 'unknown_action' });
  assert.deepEqual(next(t, undefined, 'a'), { ok: false, error: 'unknown_action' });
  for (const actor of ['c', 'A', '', undefined, null, 1]) {
    assert.deepEqual(next(t, 'advance', actor), { ok: false, error: 'bad_actor' }, String(actor));
  }
  assert.deepEqual(next(talk('nonsense', 0, 'a'), 'advance', 'a'), { ok: false, error: 'not_allowed' });
  assert.deepEqual(next(talk('__proto__', 0, 'a'), 'advance', 'a'), { ok: false, error: 'not_allowed' });
});

test('the proposer cannot accept or set aside their own talk, whoever they are', () => {
  for (const proposer of ['a', 'b']) {
    const t = talk('proposed', 0, proposer);
    assert.equal(next(t, 'accept', proposer).error, 'wrong_person');
    assert.equal(next(t, 'not_now', proposer).error, 'wrong_person');
    const other = proposer === 'a' ? 'b' : 'a';
    assert.equal(next(t, 'withdraw', other).error, 'wrong_person', 'and the other person cannot withdraw it');
  }
});

test('pause and resume keep the step at every step, and the first speaker', () => {
  for (let step = 1; step <= TOTAL_STEPS; step += 1) {
    const running = talk('in_progress', step, 'b', 'b');
    const paused = next(running, 'pause', 'a').talk;
    assert.equal(paused.state, 'paused');
    assert.equal(paused.step, step);
    const resumed = next(paused, 'resume', 'b').talk;
    assert.deepEqual(
      { state: resumed.state, step: resumed.step, firstSpeaker: resumed.firstSpeaker },
      { state: 'in_progress', step, firstSpeaker: 'b' },
    );
  }
});

test('a whole talk walks through the seven steps, then closing, then closed', () => {
  let t = talk('proposed', 0, 'b');
  const trail = [];
  const take = (action, actor) => {
    const result = next(t, action, actor);
    assert.equal(result.ok, true, `${action} by ${actor}`);
    t = result.talk;
    trail.push(`${t.state}:${t.step}`);
  };
  take('accept', 'a');
  take('start', 'b');
  for (let i = 0; i < TOTAL_STEPS - 1; i += 1) take('advance', i % 2 === 0 ? 'a' : 'b');
  take('advance', 'a'); // from the last step to closing
  take('finish', 'b');
  assert.deepEqual(trail, [
    'ready:0',
    'in_progress:1',
    'in_progress:2',
    'in_progress:3',
    'in_progress:4',
    'in_progress:5',
    'in_progress:6',
    'in_progress:7',
    'closing:7',
    'closed:7',
  ]);
  assert.equal(t.firstSpeaker, 'b', 'the proposer spoke first');
  assert.equal(next(t, 'advance', 'a').ok, false, 'nothing more after closing');
});

test('the step never goes past the last one', () => {
  let t = talk('in_progress', 7, 'a', 'a');
  t = next(t, 'advance', 'a').talk;
  assert.equal(t.step, 7);
  assert.equal(next(t, 'advance', 'a').error, 'not_allowed');
});

// ---- the store ------------------------------------------------------------

function world() {
  const ctx = makeAppWithUsers();
  ctx.clock.set('2026-11-18T01:00:00Z');
  ctx.a = ctx.users.a.id;
  ctx.b = ctx.users.b.id;
  return ctx;
}

// Takes a fresh proposal from Ada through to the given state.
function driveTo(ctx, target) {
  const { id } = proposeTalk(ctx, ctx.a, { topic: 'Weekends' });
  const steps = {
    proposed: [],
    ready: [[ctx.b, 'accept']],
    in_progress: [[ctx.b, 'accept'], [ctx.a, 'start']],
    paused: [[ctx.b, 'accept'], [ctx.a, 'start'], [ctx.a, 'pause']],
    closing: [[ctx.b, 'accept'], [ctx.a, 'start'], ...Array(TOTAL_STEPS).fill([ctx.b, 'advance'])],
    closed: [[ctx.b, 'accept'], [ctx.a, 'start'], [ctx.b, 'end']],
    set_aside: [[ctx.b, 'not_now']],
    withdrawn: [[ctx.a, 'withdraw']],
  }[target];
  for (const [user, action] of steps) assert.equal(applyAction(ctx, user, id, action).ok, true, `${target}: ${action}`);
  assert.equal(getTalk(ctx, id).state, target);
  return id;
}

test('a talk is proposed with its topic and hope, trimmed, in the proposed state', () => {
  const ctx = world();
  const { id } = proposeTalk(ctx, ctx.a, { topic: '  Weekends  ', hope: '  A calmer Sunday ' });
  const t = getTalk(ctx, id);
  assert.equal(t.topic, 'Weekends');
  assert.equal(t.hope, 'A calmer Sunday');
  assert.equal(t.state, 'proposed');
  assert.equal(t.step, 0);
  assert.equal(t.firstSpeaker, null);
  assert.equal(t.proposedBy, ctx.a);
  assert.equal(t.proposerSlot, 'a');
  assert.equal(t.proposerName, 'Ada');
  assert.equal(t.closedAt, null);
});

test('the hope is optional: missing or blank is stored as nothing', () => {
  const ctx = world();
  for (const hope of [undefined, null, '', '   ']) {
    const { id } = proposeTalk(ctx, ctx.a, { topic: 'Money', hope });
    assert.equal(getTalk(ctx, id).hope, null, String(hope));
    applyAction(ctx, ctx.a, id, 'withdraw');
  }
});

test('the topic and hope limits are 140 and 300 characters, and blank is refused', () => {
  for (const [input, expected] of [
    [{ topic: '' }, 'blank'],
    [{ topic: '   ' }, 'blank'],
    [{ topic: undefined }, 'blank'],
    [{ topic: 5 }, 'blank'],
    [{ topic: 'x'.repeat(141) }, 'topic_too_long'],
    [{ topic: 'fine', hope: 'y'.repeat(301) }, 'hope_too_long'],
    [{ topic: 'fine', hope: 7 }, 'hope_too_long'],
  ]) {
    const ctx = world();
    assert.deepEqual(proposeTalk(ctx, ctx.a, input), { ok: false, error: expected }, JSON.stringify(input));
    assert.equal(listTalks(ctx).length, 0);
  }
  const ctx = world();
  assert.equal(proposeTalk(ctx, ctx.a, { topic: 'x'.repeat(140), hope: 'y'.repeat(300) }).ok, true);
  assert.equal(proposeTalk(world(), 999, { topic: 'fine' }).error, 'unknown_user');
  assert.equal(proposeTalk(world(), world().a, undefined).error, 'blank');
});

test('a second proposal is refused while any talk is still going', () => {
  for (const state of ACTIVE_STATES) {
    const ctx = world();
    driveTo(ctx, state);
    assert.deepEqual(proposeTalk(ctx, ctx.b, { topic: 'Another one' }), { ok: false, error: 'talk_active' }, state);
    assert.equal(listTalks(ctx).length, 1, state);
  }
});

test('a new proposal is allowed once the last talk is closed, set aside or withdrawn', () => {
  for (const state of ['closed', 'set_aside', 'withdrawn']) {
    const ctx = world();
    driveTo(ctx, state);
    assert.equal(activeTalk(ctx), null, state);
    assert.equal(proposeTalk(ctx, ctx.b, { topic: 'The next one' }).ok, true, state);
  }
});

test('the store applies the state machine: who may do what, and the fields that change', () => {
  const ctx = world();
  const { id } = proposeTalk(ctx, ctx.a, { topic: 'Weekends' });

  assert.deepEqual(applyAction(ctx, ctx.a, id, 'accept'), { ok: false, error: 'wrong_person' });
  assert.equal(getTalk(ctx, id).state, 'proposed');

  assert.equal(applyAction(ctx, ctx.b, id, 'accept').talk.state, 'ready');
  const started = applyAction(ctx, ctx.b, id, 'start').talk; // either person can start
  assert.deepEqual([started.state, started.step, started.firstSpeaker], ['in_progress', 1, 'a']);

  ctx.clock.set('2026-11-18T01:30:00Z');
  const advanced = applyAction(ctx, ctx.a, id, 'advance').talk;
  assert.equal(advanced.step, 2);
  assert.equal(advanced.updatedAt, '2026-11-18T01:30:00.000Z');
  assert.equal(advanced.createdAt, '2026-11-18T01:00:00.000Z');

  const paused = applyAction(ctx, ctx.b, id, 'pause').talk;
  assert.deepEqual([paused.state, paused.step], ['paused', 2]);
  const resumed = applyAction(ctx, ctx.a, id, 'resume').talk;
  assert.deepEqual([resumed.state, resumed.step], ['in_progress', 2]);
  assert.equal(resumed.closedAt, null);

  ctx.clock.set('2026-11-18T02:00:00Z');
  const ended = applyAction(ctx, ctx.b, id, 'end').talk;
  assert.equal(ended.state, 'closed');
  assert.equal(ended.closedAt, '2026-11-18T02:00:00.000Z');
});

test('a refused action changes nothing, not even the updated time', () => {
  const ctx = world();
  const id = driveTo(ctx, 'ready');
  const before = getTalk(ctx, id);
  ctx.clock.set('2026-12-01T00:00:00Z');
  assert.equal(applyAction(ctx, ctx.a, id, 'advance').error, 'not_allowed');
  assert.equal(applyAction(ctx, ctx.a, id, 'bogus').error, 'unknown_action');
  assert.deepEqual(getTalk(ctx, id), before);
});

test('set aside and withdrawn talks are finished and stamped', () => {
  for (const [state, who] of [['set_aside', 'b'], ['withdrawn', 'a']]) {
    const ctx = world();
    const id = driveTo(ctx, state);
    const t = getTalk(ctx, id);
    assert.equal(t.closedAt, '2026-11-18T01:00:00.000Z', who);
    assert.equal(applyAction(ctx, ctx.a, id, 'accept').error, 'not_allowed');
  }
});

test('unknown talks and unknown people are refused', () => {
  const ctx = world();
  const { id } = proposeTalk(ctx, ctx.a, { topic: 'Weekends' });
  assert.deepEqual(applyAction(ctx, ctx.b, 999, 'accept'), { ok: false, error: 'not_found' });
  assert.deepEqual(applyAction(ctx, 999, id, 'accept'), { ok: false, error: 'unknown_user' });
  assert.equal(getTalk(ctx, 999), null);
  assert.equal(getTalk(ctx, id).state, 'proposed');
});

test('activeTalk finds the talk that is going, and listTalks is newest first', () => {
  const ctx = world();
  assert.equal(activeTalk(ctx), null);
  const first = driveTo(ctx, 'closed');
  assert.equal(activeTalk(ctx), null);
  const second = proposeTalk(ctx, ctx.b, { topic: 'Second' }).id;
  assert.equal(activeTalk(ctx).id, second);
  assert.deepEqual(listTalks(ctx).map((t) => t.id), [second, first]);
});

test('the talks table has no column that could hold what was said', () => {
  const ctx = world();
  const columns = ctx.db.prepare('PRAGMA table_info(talks)').all().map((c) => c.name).sort();
  assert.deepEqual(columns, [
    'closed_at',
    'created_at',
    'first_speaker',
    'hope',
    'id',
    'proposed_by',
    'state',
    'step',
    'topic',
    'updated_at',
  ]);
});
