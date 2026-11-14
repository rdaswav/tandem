import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as agreements from '../src/core/agreements.js';
import {
  MAX_AGREEMENT_LENGTH,
  addAgreement,
  dropAgreement,
  getAgreement,
  listEarlier,
  listOpen,
  markAgreementDone,
} from '../src/core/agreements.js';
import { makeAppWithUsers } from './helpers.js';

function world() {
  const ctx = makeAppWithUsers();
  ctx.clock.set('2026-11-18T01:00:00Z');
  ctx.a = ctx.users.a.id;
  ctx.b = ctx.users.b.id;
  return ctx;
}

const ids = (list) => list.map((g) => g.id);

// ---- creating -------------------------------------------------------------

test('every owner and every source can be used', () => {
  const ctx = world();
  const ownerLabels = { a: 'Ada', b: 'Bo', both: 'Both' };
  for (const owner of ['a', 'b', 'both']) {
    for (const [source, sourceId] of [['direct', null], ['checkin', 7], ['talk', 3]]) {
      const added = addAgreement(ctx, ctx.a, { body: `${owner} ${source}`, owner, source, sourceId });
      assert.equal(added.ok, true, `${owner} ${source}`);
      const g = getAgreement(ctx, added.id);
      assert.equal(g.owner, owner);
      assert.equal(g.ownerLabel, ownerLabels[owner]);
      assert.equal(g.source, source);
      assert.equal(g.sourceId, sourceId);
      assert.equal(g.state, 'open');
      assert.equal(g.closedAt, null);
    }
  }
  assert.equal(listOpen(ctx).length, 9);
});

test('source defaults to direct, and a check-in or talk agreement may leave the id out', () => {
  const ctx = world();
  const direct = addAgreement(ctx, ctx.b, { body: 'Phones away at dinner', owner: 'both' });
  assert.equal(getAgreement(ctx, direct.id).source, 'direct');
  const fromCheckin = addAgreement(ctx, ctx.b, { body: 'Book the dentist', owner: 'b', source: 'checkin' });
  assert.equal(fromCheckin.ok, true);
  assert.equal(getAgreement(ctx, fromCheckin.id).sourceId, null);
});

test('who created it is recorded, and the text is trimmed', () => {
  const ctx = world();
  const { id } = addAgreement(ctx, ctx.b, { body: '  Walk on Sundays \n', owner: 'both' });
  const g = getAgreement(ctx, id);
  assert.equal(g.body, 'Walk on Sundays');
  assert.equal(g.createdBy, ctx.b);
  assert.equal(g.createdAt, '2026-11-18T01:00:00.000Z');
});

test('blank text is refused and the limit is 300 characters', () => {
  const ctx = world();
  for (const bad of ['', '   \n\t', undefined, null, 5]) {
    assert.equal(addAgreement(ctx, ctx.a, { body: bad, owner: 'both' }).error, 'blank');
  }
  assert.equal(addAgreement(ctx, ctx.a, undefined).error, 'blank');
  assert.equal(MAX_AGREEMENT_LENGTH, 300);
  assert.equal(addAgreement(ctx, ctx.a, { body: 'x'.repeat(300), owner: 'both' }).ok, true);
  assert.equal(addAgreement(ctx, ctx.a, { body: 'x'.repeat(301), owner: 'both' }).error, 'too_long');
  assert.equal(addAgreement(ctx, ctx.a, { body: 'é'.repeat(300), owner: 'both' }).ok, true, 'counts characters, not bytes');
  assert.equal(listOpen(ctx).length, 2);
});

test('a bad owner, source or source id is refused', () => {
  const ctx = world();
  for (const owner of ['c', 'A', 'Both', '', undefined, null, 1]) {
    assert.equal(addAgreement(ctx, ctx.a, { body: 'x', owner }).error, 'bad_owner', String(owner));
  }
  for (const source of ['other', 'Direct', '', 5]) {
    assert.equal(addAgreement(ctx, ctx.a, { body: 'x', owner: 'a', source }).error, 'bad_source', String(source));
  }
  for (const sourceId of ['7', 1.5, NaN, {}]) {
    assert.equal(
      addAgreement(ctx, ctx.a, { body: 'x', owner: 'a', source: 'checkin', sourceId }).error,
      'bad_source',
      String(sourceId),
    );
  }
  assert.equal(
    addAgreement(ctx, ctx.a, { body: 'x', owner: 'a', source: 'direct', sourceId: 4 }).error,
    'bad_source',
    'a direct agreement has no source id',
  );
  assert.equal(listOpen(ctx).length, 0);
});

test('an unknown user cannot add or close anything', () => {
  const ctx = world();
  assert.equal(addAgreement(ctx, 999, { body: 'x', owner: 'both' }).error, 'unknown_user');
  const { id } = addAgreement(ctx, ctx.a, { body: 'real one', owner: 'both' });
  assert.equal(markAgreementDone(ctx, 999, id).error, 'unknown_user');
  assert.equal(dropAgreement(ctx, 999, id).error, 'unknown_user');
  assert.equal(getAgreement(ctx, id).state, 'open');
});

// ---- closing --------------------------------------------------------------

test('either person can mark an agreement done, whoever owns or wrote it', () => {
  const ctx = world();
  const adas = addAgreement(ctx, ctx.a, { body: 'ada owns', owner: 'a' }).id;
  const bos = addAgreement(ctx, ctx.a, { body: 'bo owns', owner: 'b' }).id;
  const shared = addAgreement(ctx, ctx.b, { body: 'both own', owner: 'both' }).id;

  ctx.clock.set('2026-11-19T03:00:00Z');
  assert.equal(markAgreementDone(ctx, ctx.b, adas).ok, true); // Bo closes Ada's
  assert.equal(markAgreementDone(ctx, ctx.a, bos).ok, true); // Ada closes Bo's
  assert.equal(markAgreementDone(ctx, ctx.a, shared).ok, true);

  for (const id of [adas, bos, shared]) {
    const g = getAgreement(ctx, id);
    assert.equal(g.state, 'done');
    assert.equal(g.closedAt, '2026-11-19T03:00:00.000Z');
  }
  assert.deepEqual(listOpen(ctx), []);
});

test('either person can drop an agreement', () => {
  const ctx = world();
  const one = addAgreement(ctx, ctx.a, { body: 'one', owner: 'both' }).id;
  const two = addAgreement(ctx, ctx.b, { body: 'two', owner: 'both' }).id;
  assert.equal(dropAgreement(ctx, ctx.b, one).ok, true);
  assert.equal(dropAgreement(ctx, ctx.a, two).ok, true);
  assert.equal(getAgreement(ctx, one).state, 'dropped');
  assert.equal(getAgreement(ctx, two).state, 'dropped');
  assert.deepEqual(listOpen(ctx), []);
});

test('once closed an agreement never changes: not done again, not dropped, not reopened', () => {
  const ctx = world();
  const finished = addAgreement(ctx, ctx.a, { body: 'finished', owner: 'both' }).id;
  const abandoned = addAgreement(ctx, ctx.a, { body: 'abandoned', owner: 'both' }).id;

  ctx.clock.set('2026-11-19T03:00:00Z');
  markAgreementDone(ctx, ctx.a, finished);
  dropAgreement(ctx, ctx.a, abandoned);

  ctx.clock.set('2026-12-25T03:00:00Z');
  assert.deepEqual(markAgreementDone(ctx, ctx.b, finished), { ok: false, error: 'not_open' });
  assert.deepEqual(dropAgreement(ctx, ctx.b, finished), { ok: false, error: 'not_open' });
  assert.deepEqual(markAgreementDone(ctx, ctx.b, abandoned), { ok: false, error: 'not_open' });
  assert.deepEqual(dropAgreement(ctx, ctx.b, abandoned), { ok: false, error: 'not_open' });

  const after = [getAgreement(ctx, finished), getAgreement(ctx, abandoned)];
  assert.deepEqual(after.map((g) => g.state), ['done', 'dropped']);
  assert.deepEqual(after.map((g) => g.closedAt), ['2026-11-19T03:00:00.000Z', '2026-11-19T03:00:00.000Z']);
});

test('an unknown agreement cannot be closed', () => {
  const ctx = world();
  assert.deepEqual(markAgreementDone(ctx, ctx.a, 999), { ok: false, error: 'not_found' });
  assert.deepEqual(dropAgreement(ctx, ctx.a, 999), { ok: false, error: 'not_found' });
  assert.equal(getAgreement(ctx, 999), null);
});

test('the text cannot be edited: there is no way to change it', () => {
  const ctx = world();
  assert.deepEqual(
    Object.keys(agreements).filter((name) => /edit|update|change|reopen/i.test(name)),
    [],
  );
  const { id } = addAgreement(ctx, ctx.a, { body: 'as written', owner: 'both' });
  markAgreementDone(ctx, ctx.b, id);
  assert.equal(getAgreement(ctx, id).body, 'as written');
});

// ---- lists ----------------------------------------------------------------

test('open agreements are listed oldest first and closed ones leave the list', () => {
  const ctx = world();
  ctx.clock.set('2026-11-10T01:00:00Z');
  const first = addAgreement(ctx, ctx.b, { body: 'first', owner: 'both' }).id;
  ctx.clock.set('2026-11-12T01:00:00Z');
  const second = addAgreement(ctx, ctx.a, { body: 'second', owner: 'a' }).id;
  ctx.clock.set('2026-11-15T01:00:00Z');
  const third = addAgreement(ctx, ctx.a, { body: 'third', owner: 'b' }).id;
  assert.deepEqual(ids(listOpen(ctx)), [first, second, third]);

  markAgreementDone(ctx, ctx.a, first);
  assert.deepEqual(ids(listOpen(ctx)), [second, third]);
});

test('agreements made in the same instant keep the order they were made in', () => {
  const ctx = world();
  const one = addAgreement(ctx, ctx.a, { body: 'one', owner: 'both' }).id;
  const two = addAgreement(ctx, ctx.a, { body: 'two', owner: 'both' }).id;
  const three = addAgreement(ctx, ctx.a, { body: 'three', owner: 'both' }).id;
  assert.deepEqual(ids(listOpen(ctx)), [one, two, three]);
});

test('earlier lists done and dropped agreements, most recently closed first, with their state', () => {
  const ctx = world();
  const a1 = addAgreement(ctx, ctx.a, { body: 'closed first', owner: 'both' }).id;
  const a2 = addAgreement(ctx, ctx.a, { body: 'closed second', owner: 'both' }).id;
  const a3 = addAgreement(ctx, ctx.a, { body: 'still open', owner: 'both' }).id;

  ctx.clock.set('2026-11-19T01:00:00Z');
  markAgreementDone(ctx, ctx.a, a1);
  ctx.clock.set('2026-11-20T01:00:00Z');
  dropAgreement(ctx, ctx.b, a2);

  const earlier = listEarlier(ctx);
  assert.deepEqual(ids(earlier), [a2, a1]);
  assert.deepEqual(earlier.map((g) => g.state), ['dropped', 'done']);
  assert.deepEqual(ids(listOpen(ctx)), [a3]);
});

test('both people see the same lists: the lists take no user', () => {
  const ctx = world();
  addAgreement(ctx, ctx.a, { body: 'shared', owner: 'a' });
  assert.equal(listOpen.length, 1, 'listOpen takes only ctx');
  assert.equal(listEarlier.length, 1, 'listEarlier takes only ctx');
  assert.equal(listOpen(ctx).length, 1);
});
