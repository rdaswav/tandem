import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addAgreement, dropAgreement } from '../src/core/agreements.js';
import { addMoment, removeMoment } from '../src/core/moments.js';
import { applyAction, getTalk, proposeTalk } from '../src/core/talks.js';
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

const get = (ctx, who, url = '/') => ctx.app.inject({ method: 'GET', url, headers: ctx.s[who].headers });
const post = (ctx, who, url, fields = {}) =>
  ctx.app.inject({ method: 'POST', url, ...form({ _csrf: ctx.s[who].csrf, ...fields }, ctx.s[who].headers) });

const plain = (body) => body.replace(/name="_csrf" value="[^"]*"/g, 'name="_csrf" value="X"');
// The words a person sees: markup removed and the five escapes turned back into characters.
const words = (html) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

// The visible words from one h2 to the next heading or the foot of the page.
function block(body, heading) {
  const start = body.indexOf(`<h2>${heading}</h2>`);
  if (start === -1) return null;
  const rest = body.slice(start + heading.length + 9);
  const end = rest.search(/<h2>|<p class="foot">/);
  return words(end === -1 ? rest : rest.slice(0, end));
}

const finish = (ctx, who, text) => post(ctx, who, '/checkin/submit', { appreciated: text });

// ---- the empty Home -------------------------------------------------------

test('with nothing yet, Home has the check-in block and the quick links, and nothing else', async () => {
  const ctx = world();
  const res = await get(ctx, 'a');
  assert.equal(res.statusCode, 200);
  assert.equal((res.body.match(/<h1[ >]/g) ?? []).length, 1);
  assert.match(res.body, /<h1>Tandem<\/h1>/);
  assert.match(res.body, /Signed in as Ada\./);

  assert.equal(block(res.body, 'This week'), 'Check-in You have not started. Open check-in');
  assert.match(res.body, /<a class="btn btn-primary" href="\/checkin">Open check-in<\/a>/);

  for (const heading of ['Talk', 'Agreements', 'From the log']) {
    assert.equal(res.body.includes(`<h2>${heading}</h2>`), false, `${heading} is left out when empty`);
  }
  assert.match(res.body, /<a class="btn" href="\/moments#new-moment">Add a moment<\/a>/);
  assert.match(res.body, /<a class="btn" href="\/ideas">Add an idea<\/a>/);
  assert.ok(res.body.includes(`name="_csrf" value="${ctx.s.a.csrf}"`));
  assert.match(res.body, /action="\/signout"/);
});

test('looking at Home does not create the week\'s round', async () => {
  const ctx = world();
  await get(ctx, 'a');
  await get(ctx, 'b');
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM rounds').get().n, 0);
});

// ---- the check-in block ---------------------------------------------------

test('the check-in line follows the viewer through the four states', async () => {
  const ctx = world();
  const line = async (who) => block((await get(ctx, who)).body, 'This week');

  assert.equal(await line('a'), 'Check-in You have not started. Open check-in');

  await post(ctx, 'a', '/checkin/save', { appreciated: ADA });
  assert.equal(await line('a'), 'Check-in You have a draft. Open check-in');

  await finish(ctx, 'a', ADA);
  assert.equal(await line('a'), 'Check-in You are done. Waiting for both. Open check-in');

  await finish(ctx, 'b', BO);
  assert.equal(await line('a'), 'Check-in Ready to read together. Open check-in');
  assert.equal(await line('b'), 'Check-in Ready to read together. Open check-in');
});

test('a new week starts again at not started', async () => {
  const ctx = world();
  await finish(ctx, 'a', ADA);
  await finish(ctx, 'b', BO);
  ctx.clock.set('2026-11-25T01:00:00Z');
  assert.equal(block((await get(ctx, 'a')).body, 'This week'), 'Check-in You have not started. Open check-in');
});

for (const [viewer, other] of [['b', 'a'], ['a', 'b']]) {
  test(`${viewer}'s Home is identical whether ${other} does nothing, opens the page, drafts or submits`, async () => {
    const moves = {
      nothing: () => {},
      'opens the check-in': () => get(ctx, other, '/checkin'),
      'writes a draft': () => post(ctx, other, '/checkin/save', { appreciated: 'a draft nobody should see 5513' }),
      submits: () => finish(ctx, other, 'a submitted answer nobody should see 8820'),
    };
    let ctx;
    const seen = {};
    for (const [label, move] of Object.entries(moves)) {
      ctx = world();
      await move();
      const before = plain((await get(ctx, viewer)).body);
      await post(ctx, viewer, '/checkin/save', { appreciated: 'my own words 1199' });
      const after = plain((await get(ctx, viewer)).body);
      assert.equal(before.includes('nobody should see'), false, `${other} ${label}: leaked`);
      assert.equal(after.includes('nobody should see'), false, `${other} ${label}: leaked`);
      seen[label] = { before, after };
    }
    for (const [label, pages] of Object.entries(seen)) {
      assert.deepEqual(pages, seen.nothing, `${viewer}'s Home changed when ${other} ${label}`);
    }
  });
}

// ---- the talk block -------------------------------------------------------

test('a request is a card with Yes and Not now for the other person and Withdraw for the proposer', async () => {
  const ctx = world();
  const id = proposeTalk(ctx, ctx.a, { topic: 'Weekends' }).id;

  const theirs = await get(ctx, 'b');
  assert.equal(block(theirs.body, 'Talk'), "Ada would like to talk about: Weekends. Yes, let's Not now");
  assert.ok(theirs.body.includes(`action="/talks/${id}/accept"`));
  assert.ok(theirs.body.includes(`action="/talks/${id}/not_now"`));
  assert.equal(theirs.body.includes(`/talks/${id}/withdraw`), false);

  const mine = await get(ctx, 'a');
  assert.equal(block(mine.body, 'Talk'), 'You asked to talk about: Weekends. Waiting. Withdraw');
  assert.ok(mine.body.includes(`action="/talks/${id}/withdraw"`));
  assert.equal(mine.body.includes(`/talks/${id}/accept`), false);
  assert.equal(mine.body.includes(`/talks/${id}/not_now`), false);
});

test('the buttons on Home work: Yes starts the talk, Withdraw ends the request', async () => {
  const ctx = world();
  const id = proposeTalk(ctx, ctx.a, { topic: 'Weekends' }).id;
  const yes = await post(ctx, 'b', `/talks/${id}/accept`);
  assert.equal(yes.statusCode, 303);
  assert.equal(yes.headers.location, `/talks/${id}`);
  assert.equal(getTalk(ctx, id).state, 'ready');

  const other = world();
  const withdrawId = proposeTalk(other, other.a, { topic: 'Chores' }).id;
  await post(other, 'a', `/talks/${withdrawId}/withdraw`);
  assert.equal(getTalk(other, withdrawId).state, 'withdrawn');
  assert.equal((await get(other, 'a')).body.includes('<h2>Talk</h2>'), false);
});

test('once a talk is going Home shows a link to it, for both people', async () => {
  const ctx = world();
  const id = proposeTalk(ctx, ctx.a, { topic: 'Weekends' }).id;
  applyAction(ctx, ctx.b, id, 'accept');
  for (const who of ['a', 'b']) {
    const page = await get(ctx, who);
    assert.equal(block(page.body, 'Talk'), 'A talk about Weekends is going. Open it');
    assert.ok(page.body.includes(`<a href="/talks/${id}">Open it</a>`));
  }
  applyAction(ctx, ctx.a, id, 'start');
  assert.equal(block((await get(ctx, 'b')).body, 'Talk'), 'A talk about Weekends is going. Open it');
});

test('a finished, set aside or withdrawn talk is not on Home', async () => {
  for (const end of [
    (ctx, id) => { applyAction(ctx, ctx.b, id, 'accept'); applyAction(ctx, ctx.a, id, 'start'); applyAction(ctx, ctx.a, id, 'end'); },
    (ctx, id) => applyAction(ctx, ctx.b, id, 'not_now'),
    (ctx, id) => applyAction(ctx, ctx.a, id, 'withdraw'),
  ]) {
    const ctx = world();
    const id = proposeTalk(ctx, ctx.a, { topic: 'Weekends' }).id;
    end(ctx, id);
    assert.equal((await get(ctx, 'a')).body.includes('<h2>Talk</h2>'), false);
    assert.equal((await get(ctx, 'b')).body.includes('<h2>Talk</h2>'), false);
  }
});

// ---- the agreements block -------------------------------------------------

test('open agreements are listed oldest first with who they are for, with no dates or counts', async () => {
  const ctx = world();
  ctx.clock.set('2026-01-02T01:00:00Z');
  addAgreement(ctx, ctx.a, { body: 'Phones away at dinner', owner: 'both' });
  ctx.clock.set('2026-06-02T01:00:00Z');
  addAgreement(ctx, ctx.b, { body: 'Book the dentist', owner: 'a' });
  const closed = addAgreement(ctx, ctx.b, { body: 'Already finished', owner: 'b' }).id;
  dropAgreement(ctx, ctx.a, closed);
  ctx.clock.set('2026-11-18T01:00:00Z');
  addAgreement(ctx, ctx.a, { body: 'Plan the weekend away', owner: 'b' });

  for (const who of ['a', 'b']) {
    const page = await get(ctx, who);
    const text = block(page.body, 'Agreements');
    assert.equal(text, 'Phones away at dinner Both Book the dentist Ada Plan the weekend away Bo');
    assert.equal(/\d/.test(text), false, 'no digits in the block');
    assert.equal(text.includes('Already finished'), false);
  }
});

test('the agreements block is left out when none are open', async () => {
  const ctx = world();
  const id = addAgreement(ctx, ctx.a, { body: 'Only one', owner: 'both' }).id;
  assert.ok((await get(ctx, 'a')).body.includes('<h2>Agreements</h2>'));
  dropAgreement(ctx, ctx.b, id);
  assert.equal((await get(ctx, 'a')).body.includes('<h2>Agreements</h2>'), false);
});

// ---- from the log ---------------------------------------------------------

test('a moment 14 days old or more can come back; a newer one cannot', async () => {
  const ctx = world();
  addMoment(ctx, ctx.a, { happenedOn: '2026-11-05', body: 'Thirteen days old' });
  addMoment(ctx, ctx.b, { happenedOn: '2026-11-18', body: 'Made today' });
  assert.equal((await get(ctx, 'a')).body.includes('<h2>From the log</h2>'), false);

  addMoment(ctx, ctx.b, { happenedOn: '2026-11-04', body: 'Exactly fourteen days old' });
  for (const who of ['a', 'b']) {
    const text = block((await get(ctx, who)).body, 'From the log');
    assert.equal(text, '4 November 2026 · Bo Exactly fourteen days old');
  }
});

test('both people get the same moment on a day, and another one the next day', async () => {
  const ctx = world();
  addMoment(ctx, ctx.a, { happenedOn: '2026-08-01', body: 'Moment one' });
  addMoment(ctx, ctx.b, { happenedOn: '2026-09-01', body: 'Moment two' });

  const day = async () => {
    const [a, b] = [await get(ctx, 'a'), await get(ctx, 'b')];
    const [ta, tb] = [block(a.body, 'From the log'), block(b.body, 'From the log')];
    assert.equal(ta, tb, 'the same for both');
    return ta;
  };
  const first = await day();
  ctx.clock.set('2026-11-18T10:00:00Z'); // the same day, later
  assert.equal(await day(), first);
  ctx.clock.set('2026-11-19T01:00:00Z');
  const second = await day();
  assert.notEqual(second, first);
  assert.deepEqual(
    [first, second].map((t) => (t.includes('Moment one') ? 'one' : 'two')).sort(),
    ['one', 'two'],
  );
});

test('a long moment is cut short with a way to read the rest; a short one is shown whole', async () => {
  const ctx = world();
  const long = 'word '.repeat(60).trim();
  const id = addMoment(ctx, ctx.a, { happenedOn: '2026-08-01', body: long }).id;
  const page = await get(ctx, 'b');
  assert.ok(page.body.includes('…'));
  assert.equal(page.body.includes(long), false);
  assert.ok(page.body.includes(`<a href="/moments#m-${id}">Read the rest</a>`));
  const shown = block(page.body, 'From the log');
  assert.ok(shown.length < long.length);

  removeMoment(ctx, ctx.a, id);
  addMoment(ctx, ctx.a, { happenedOn: '2026-08-02', body: 'A short one' });
  const short = await get(ctx, 'b');
  assert.equal(block(short.body, 'From the log'), '2 August 2026 · Ada A short one');
  assert.equal(short.body.includes('Read the rest'), false);
});

test('a removed moment never comes back on Home', async () => {
  const ctx = world();
  const id = addMoment(ctx, ctx.a, { happenedOn: '2026-08-01', body: 'About to go' }).id;
  assert.ok((await get(ctx, 'a')).body.includes('About to go'));
  removeMoment(ctx, ctx.a, id);
  assert.equal((await get(ctx, 'a')).body.includes('<h2>From the log</h2>'), false);
});

// ---- order and escaping ---------------------------------------------------

test('the blocks come in the fixed order', async () => {
  const ctx = world();
  proposeTalk(ctx, ctx.a, { topic: 'Weekends' });
  addAgreement(ctx, ctx.a, { body: 'Phones away at dinner', owner: 'both' });
  addMoment(ctx, ctx.a, { happenedOn: '2026-08-01', body: 'A good day' });
  const { body } = await get(ctx, 'b');
  const at = (s) => body.indexOf(s);
  const order = ['<h2>This week</h2>', '<h2>Talk</h2>', '<h2>Agreements</h2>', '<h2>From the log</h2>', 'Add a moment', 'Sign out'];
  for (const s of order) assert.ok(at(s) > -1, s);
  for (let i = 1; i < order.length; i += 1) assert.ok(at(order[i - 1]) < at(order[i]), `${order[i - 1]} before ${order[i]}`);
});

test('text from talks, agreements and moments is escaped on Home', async () => {
  const ctx = world();
  proposeTalk(ctx, ctx.a, { topic: '<script>alert(1)</script> & "t"' });
  addAgreement(ctx, ctx.a, { body: '<img src=x onerror=alert(2)>', owner: 'both' });
  addMoment(ctx, ctx.a, { happenedOn: '2026-08-01', body: '<b>bold</b>\nsecond line' });
  const { body } = await get(ctx, 'b');
  assert.equal(body.includes('<script>alert'), false);
  assert.equal(body.includes('<img src=x'), false);
  assert.equal(body.includes('<b>bold'), false);
  assert.ok(body.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;t&quot;'));
  assert.ok(body.includes('&lt;img src=x onerror=alert(2)&gt;'));
  assert.ok(body.includes('&lt;b&gt;bold&lt;/b&gt;<br>second line'));
});
