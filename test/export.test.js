import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addAgreement, dropAgreement, markAgreementDone } from '../src/core/agreements.js';
import { buildExport } from '../src/core/export.js';
import { addIdea, markDone, removeIdea } from '../src/core/ideas.js';
import { addMoment, removeMoment } from '../src/core/moments.js';
import { applyAction, proposeTalk } from '../src/core/talks.js';
import { form, makeAppWithUsers } from './helpers.js';

const ADA = 'Ada private answer 7731';
const BO = 'Bo private answer 4402';

// Wednesday 18 November 2026, noon in Melbourne.
function world() {
  const ctx = makeAppWithUsers();
  ctx.clock.set('2026-11-18T01:00:00Z');
  ctx.a = ctx.users.a.id;
  ctx.b = ctx.users.b.id;
  ctx.s = { a: ctx.login('a'), b: ctx.login('b') };
  return ctx;
}

const getExport = (ctx, who) => ctx.app.inject({ method: 'GET', url: '/export.json', headers: ctx.s[who].headers });
const post = (ctx, who, url, fields = {}) =>
  ctx.app.inject({ method: 'POST', url, ...form({ _csrf: ctx.s[who].csrf, ...fields }, ctx.s[who].headers) });
const finish = (ctx, who, text) => post(ctx, who, '/checkin/submit', { appreciated: text });

// ---- the download ---------------------------------------------------------

test('the export is a JSON download named with the local date, never cached', async () => {
  const ctx = world();
  const res = await getExport(ctx, 'a');
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(res.headers['content-disposition'], 'attachment; filename="tandem-export-2026-11-18.json"');
  assert.equal(res.headers['cache-control'], 'no-store');
  const data = JSON.parse(res.body);
  assert.equal(data.app, 'Tandem');
  assert.equal(data.version, 1);
  assert.equal(data.exportedAt, '2026-11-18T01:00:00.000Z');
  assert.equal(data.exportedBy, 'Ada');
  assert.deepEqual(data.people, ['Ada', 'Bo']);
  assert.ok(res.body.endsWith('}\n'));
});

test('the file name uses the local date, not UTC', async () => {
  const ctx = world();
  ctx.clock.set('2026-11-14T13:30:00Z'); // Saturday in UTC, Sunday the 15th in Melbourne
  const res = await getExport(ctx, 'b');
  assert.match(res.headers['content-disposition'], /tandem-export-2026-11-15\.json/);
  assert.equal(JSON.parse(res.body).exportedBy, 'Bo');
});

test('Home links to it in the quiet row, between How this works and Sign out', async () => {
  const ctx = world();
  const home = await ctx.app.inject({ method: 'GET', url: '/', headers: ctx.s.a.headers });
  assert.match(home.body, /<a href="\/export\.json" download>Export<\/a>/);
  const at = (s) => home.body.indexOf(s);
  assert.ok(at('How this works') < at('>Export<') && at('>Export<') < at('Sign out'));
});

test('the export needs a session', async () => {
  const ctx = world();
  const res = await ctx.app.inject({ method: 'GET', url: '/export.json' });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/signin');
  assert.equal(res.body.includes('"app"'), false);
});

// ---- the privacy rule -----------------------------------------------------

for (const [viewer, other, viewerText, otherText] of [['b', 'a', BO, ADA], ['a', 'b', ADA, BO]]) {
  test(`before reveal ${viewer}'s export holds ${viewer}'s own answers and none of ${other}'s`, async () => {
    const ctx = world();
    await post(ctx, 'a', '/checkin/save', { appreciated: ADA });
    await post(ctx, 'b', '/checkin/save', { appreciated: BO });
    await finish(ctx, other, otherText); // the other person is done; the viewer is only drafting

    const res = await getExport(ctx, viewer);
    assert.equal(res.body.includes(otherText), false, "the other person's words are not in the file");
    assert.ok(res.body.includes(viewerText), "the viewer's own draft is");
    const [round] = JSON.parse(res.body).checkins;
    assert.equal(round.state, 'draft');
    assert.ok(round.answers.every((a) => a.person === (viewer === 'a' ? 'Ada' : 'Bo')));
  });
}

test('the same moves by the other person never change what you get', async () => {
  const exportFor = async (move) => {
    const ctx = world();
    await post(ctx, 'b', '/checkin/save', { appreciated: BO });
    await move(ctx);
    const data = JSON.parse((await getExport(ctx, 'b')).body);
    return JSON.stringify(data.checkins);
  };
  const nothing = await exportFor(async () => {});
  const drafts = await exportFor((ctx) => post(ctx, 'a', '/checkin/save', { appreciated: 'a draft nobody should see 5513' }));
  const submits = await exportFor((ctx) => finish(ctx, 'a', 'a submitted answer nobody should see 8820'));
  assert.equal(drafts, nothing);
  assert.equal(submits, nothing);
  assert.equal(nothing.includes('nobody should see'), false);
});

test('after reveal both exports hold both sets, with the prompt text and Ada first', async () => {
  const ctx = world();
  await post(ctx, 'b', '/checkin/save', { hard: 'Bo says hard' });
  await finish(ctx, 'b', BO);
  await finish(ctx, 'a', ADA);

  for (const who of ['a', 'b']) {
    const { checkins } = JSON.parse((await getExport(ctx, who)).body);
    assert.equal(checkins.length, 1);
    assert.equal(checkins[0].state, 'revealed');
    assert.equal(checkins[0].weekStart, '2026-11-15');
    assert.deepEqual(
      checkins[0].answers.map((a) => [a.person, a.promptId, a.text]),
      [['Ada', 'appreciated', ADA], ['Bo', 'appreciated', BO], ['Bo', 'hard', 'Bo says hard']],
    );
    assert.equal(checkins[0].answers[0].prompt, 'Something I appreciated about you this week');
  }
});

test('a round that passed shows each person only their own answers', async () => {
  const ctx = world();
  await finish(ctx, 'a', ADA); // Ada is done; Bo only drafts
  await post(ctx, 'b', '/checkin/save', { appreciated: BO });
  ctx.clock.set('2026-11-25T01:00:00Z'); // the week is over

  const a = (await getExport(ctx, 'a')).body;
  const b = (await getExport(ctx, 'b')).body;
  assert.ok(a.includes(ADA) && !a.includes(BO));
  assert.ok(b.includes(BO) && !b.includes(ADA));
  assert.equal(JSON.parse(a).checkins[0].state, 'passed');
});

test('a round only the other person opened or wrote in is not in your export at all', async () => {
  const ctx = world();
  await post(ctx, 'a', '/checkin/save', { appreciated: ADA }); // only Ada wrote
  ctx.clock.set('2026-11-25T01:00:00Z');
  await ctx.app.inject({ method: 'GET', url: '/checkin', headers: ctx.s.a.headers }); // Ada opens the new week too
  const data = JSON.parse((await getExport(ctx, 'b')).body);
  assert.deepEqual(data.checkins, []);
  assert.equal(JSON.stringify(data).includes('2026-11-15'), false, 'not even the week is named');
});

test('building an export changes nothing: no round is created and nothing is marked', async () => {
  const ctx = world();
  const counts = () =>
    ['rounds', 'answers', 'submissions', 'moments', 'ideas', 'agreements', 'talks', 'sessions'].map(
      (t) => ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n,
    );
  const before = counts();
  await getExport(ctx, 'a');
  await getExport(ctx, 'b');
  assert.deepEqual(counts(), before);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM rounds').get().n, 0);
});

// ---- the shared things ------------------------------------------------------

test('moments are included with their date and writer, and removed ones are not', async () => {
  const ctx = world();
  addMoment(ctx, ctx.a, { happenedOn: '2026-11-10', body: 'We found the little cafe' });
  addMoment(ctx, ctx.b, { happenedOn: '2026-11-12', body: 'Rain all afternoon' });
  const gone = addMoment(ctx, ctx.a, { happenedOn: '2026-11-11', body: 'A removed moment' }).id;
  removeMoment(ctx, ctx.a, gone);

  for (const who of ['a', 'b']) {
    const res = await getExport(ctx, who);
    const { moments } = JSON.parse(res.body);
    assert.deepEqual(moments, [
      { date: '2026-11-12', person: 'Bo', text: 'Rain all afternoon' },
      { date: '2026-11-10', person: 'Ada', text: 'We found the little cafe' },
    ]);
    assert.equal(res.body.includes('A removed moment'), false);
  }
});

test('ideas are included open and done, and removed ones are not', async () => {
  const ctx = world();
  addIdea(ctx, ctx.a, { body: 'Try the new ramen place' });
  const done = addIdea(ctx, ctx.b, { body: 'Picnic by the river' }).id;
  markDone(ctx, ctx.a, done);
  const gone = addIdea(ctx, ctx.a, { body: 'A removed idea' }).id;
  removeIdea(ctx, ctx.a, gone);

  const res = await getExport(ctx, 'b');
  assert.deepEqual(JSON.parse(res.body).ideas, [
    { person: 'Ada', text: 'Try the new ramen place', state: 'open' },
    { person: 'Bo', text: 'Picnic by the river', state: 'done' },
  ]);
  assert.equal(res.body.includes('A removed idea'), false);
});

test('agreements are included with who they are for and their state', async () => {
  const ctx = world();
  addAgreement(ctx, ctx.a, { body: 'Phones away at dinner', owner: 'both' });
  const finished = addAgreement(ctx, ctx.b, { body: 'Book the dentist', owner: 'a' }).id;
  const abandoned = addAgreement(ctx, ctx.a, { body: 'Learn to surf', owner: 'b' }).id;
  markAgreementDone(ctx, ctx.b, finished);
  dropAgreement(ctx, ctx.a, abandoned);

  const { agreements } = JSON.parse((await getExport(ctx, 'a')).body);
  assert.deepEqual(agreements.map((g) => [g.text, g.forPerson, g.state]).sort(), [
    ['Book the dentist', 'Ada', 'done'],
    ['Learn to surf', 'Bo', 'dropped'],
    ['Phones away at dinner', 'Both', 'open'],
  ]);
});

test('talks are included as a topic, who asked and where it ended, and nothing said in them', async () => {
  const ctx = world();
  const id = proposeTalk(ctx, ctx.a, { topic: 'Weekends', hope: 'A calmer Sunday' }).id;
  applyAction(ctx, ctx.b, id, 'accept');
  applyAction(ctx, ctx.a, id, 'start');
  applyAction(ctx, ctx.b, id, 'end');
  proposeTalk(ctx, ctx.b, { topic: 'Holidays' });

  const { talks } = JSON.parse((await getExport(ctx, 'b')).body);
  assert.deepEqual(talks, [
    { topic: 'Holidays', hope: null, askedBy: 'Bo', state: 'proposed' },
    { topic: 'Weekends', hope: 'A calmer Sunday', askedBy: 'Ada', state: 'closed' },
  ]);
});

test('the export holds no secrets: no passphrase, token, session or CSRF value', async () => {
  const ctx = world();
  addMoment(ctx, ctx.a, { body: 'Something shared' });
  await finish(ctx, 'a', ADA);
  const res = await getExport(ctx, 'a');
  const secrets = [
    ctx.s.a.cookieValue,
    ctx.s.a.csrf,
    ctx.s.b.cookieValue,
    ctx.s.b.csrf,
    ctx.users.a.setupToken,
    ctx.users.b.setupToken,
    'ada has a long passphrase',
    'bo likes another phrase',
  ];
  for (const secret of secrets) assert.equal(res.body.includes(secret), false, secret.slice(0, 8));
  const keys = new Set();
  JSON.stringify(JSON.parse(res.body), (k, v) => (keys.add(k), v));
  for (const key of keys) assert.doesNotMatch(key, /pass|hash|salt|token|csrf|session|cookie|secret/i, key);
});

test('buildExport is a plain function of what the person may see', () => {
  const ctx = world();
  addMoment(ctx, ctx.a, { body: 'Only a moment' });
  const first = buildExport(ctx, ctx.a);
  const second = buildExport(ctx, ctx.a);
  assert.deepEqual(first, second);
  assert.equal(buildExport(ctx, 999).exportedBy, null, 'an unknown person is named as nobody');
});
