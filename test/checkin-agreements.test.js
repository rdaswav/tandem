import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addAgreement, listEarlier, listOpen } from '../src/core/agreements.js';
import { currentRound } from '../src/core/rounds.js';
import { form, makeAppWithUsers } from './helpers.js';

const ADA = 'Ada private answer 7731';
const BO = 'Bo private answer 4402';

// Wednesday 18 November 2026, noon in Melbourne. This week started on the 15th.
function world() {
  const ctx = makeAppWithUsers();
  ctx.clock.set('2026-11-18T01:00:00Z');
  ctx.a = ctx.users.a.id;
  ctx.b = ctx.users.b.id;
  ctx.s = { a: ctx.login('a'), b: ctx.login('b') };
  return ctx;
}

const get = (ctx, who, url) => ctx.app.inject({ method: 'GET', url, headers: ctx.s[who].headers });
const post = (ctx, who, url, fields = {}) =>
  ctx.app.inject({ method: 'POST', url, ...form({ _csrf: ctx.s[who].csrf, ...fields }, ctx.s[who].headers) });

const finish = (ctx, who, text) => post(ctx, who, '/checkin/submit', { appreciated: text });

async function reveal(ctx) {
  await finish(ctx, 'a', ADA);
  await finish(ctx, 'b', BO);
}

// The visible words between one heading and the next.
function section(body, heading) {
  const start = body.indexOf(`<h2>${heading}</h2>`);
  if (start === -1) return null;
  const rest = body.slice(start + heading.length + 9);
  const end = rest.search(/<h2>/);
  return (end === -1 ? rest : rest.slice(0, end)).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ---- before the check-in opens --------------------------------------------

test('before reveal there is no box and no Looking back, in any state', async () => {
  const ctx = world();
  addAgreement(ctx, ctx.a, { body: 'Phones away at dinner', owner: 'both' });

  const states = {
    'not started': () => {},
    draft: () => post(ctx, 'a', '/checkin/save', { appreciated: ADA }),
    'done, waiting': () => finish(ctx, 'a', ADA),
  };
  for (const [label, move] of Object.entries(states)) {
    await move();
    const page = await get(ctx, 'a', '/checkin');
    assert.equal(page.body.includes('One thing for the week'), false, label);
    assert.equal(page.body.includes('Looking back'), false, label);
    assert.equal(page.body.includes('/checkin/agreement'), false, label);
  }
  // The other person, who has not even started, sees none of it either.
  const other = await get(ctx, 'b', '/checkin');
  assert.equal(other.body.includes('One thing for the week'), false);
});

test('before reveal a POST to the box is refused the same way in every state, and adds nothing', async () => {
  const ctx = world();
  const attempt = () => post(ctx, 'a', '/checkin/agreement', { body: 'Sneak this in', owner: 'both' });
  const replies = [];

  replies.push(await attempt()); // not started
  await post(ctx, 'a', '/checkin/save', { appreciated: ADA });
  replies.push(await attempt()); // draft
  await finish(ctx, 'a', ADA);
  replies.push(await attempt()); // done, waiting for the other person
  await post(ctx, 'b', '/checkin/save', { appreciated: BO });
  replies.push(await attempt()); // the other person is only drafting

  for (const res of replies) {
    assert.equal(res.statusCode, 403);
    assert.match(res.body, /This opens once you have both finished the check-in\./);
  }
  const first = replies[0].body.replace(/name="_csrf" value="[^"]*"/g, '');
  for (const res of replies) assert.equal(res.body.replace(/name="_csrf" value="[^"]*"/g, ''), first, 'the refusal is identical');
  assert.equal(listOpen(ctx).length, 0);
});

test('a round that passed without opening stays closed to the box', async () => {
  const ctx = world();
  await finish(ctx, 'a', ADA);
  ctx.clock.set('2026-11-25T01:00:00Z'); // next week: the old round passed, a new one is empty
  const res = await post(ctx, 'a', '/checkin/agreement', { body: 'Too late', owner: 'both' });
  assert.equal(res.statusCode, 403);
  assert.equal(listOpen(ctx).length, 0);
});

test('a POST without the CSRF token is refused and adds nothing', async () => {
  const ctx = world();
  await reveal(ctx);
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/checkin/agreement',
    ...form({ body: 'No token', owner: 'both' }, ctx.s.a.headers),
  });
  assert.equal(res.statusCode, 403);
  assert.equal(listOpen(ctx).length, 0);
});

test('the box needs a session', async () => {
  const ctx = world();
  const res = await ctx.app.inject({ method: 'POST', url: '/checkin/agreement', ...form({ body: 'x', owner: 'both' }) });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/signin');
});

// ---- after the check-in opens ---------------------------------------------

test('after reveal both people get the box with Both selected and each name offered', async () => {
  const ctx = world();
  await reveal(ctx);
  for (const who of ['a', 'b']) {
    const page = await get(ctx, who, '/checkin');
    assert.match(page.body, /<h1>Read together<\/h1>/);
    assert.match(page.body, /<label for="week-thing">One thing for the week<\/label>/);
    assert.match(page.body, /<form class="card" method="post" action="\/checkin\/agreement">/);
    assert.ok(page.body.includes(`name="_csrf" value="${ctx.s[who].csrf}"`));
    const options = [...page.body.matchAll(/<option value="([^"]+)"( selected)?>([^<]+)<\/option>/g)];
    assert.deepEqual(options.map((m) => [m[1], m[3], Boolean(m[2])]), [
      ['both', 'Both', true],
      ['a', 'Ada', false],
      ['b', 'Bo', false],
    ]);
    assert.match(page.body, /<label for="week-owner">Who is it for\?<\/label>/);
  }
});

test('adding one creates an agreement from the check-in that shows on the agreements page', async () => {
  const ctx = world();
  await reveal(ctx);
  const round = currentRound(ctx);

  const res = await post(ctx, 'b', '/checkin/agreement', { body: 'Cook dinner together on Friday', owner: 'a' });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/agreements');

  const [g] = listOpen(ctx);
  assert.equal(g.body, 'Cook dinner together on Friday');
  assert.equal(g.owner, 'a');
  assert.equal(g.ownerLabel, 'Ada');
  assert.equal(g.source, 'checkin');
  assert.equal(g.sourceId, round.id);
  assert.equal(g.createdBy, ctx.b);

  for (const who of ['a', 'b']) {
    const page = await get(ctx, who, '/agreements');
    assert.ok(page.body.includes('Cook dinner together on Friday'));
  }
});

test('more than one thing can be added in a week, and for both people', async () => {
  const ctx = world();
  await reveal(ctx);
  await post(ctx, 'a', '/checkin/agreement', { body: 'First thing', owner: 'both' });
  await post(ctx, 'b', '/checkin/agreement', { body: 'Second thing', owner: 'b' });
  assert.deepEqual(listOpen(ctx).map((g) => g.body), ['First thing', 'Second thing']);
});

test('Looking back lists the open agreements, and only those, with who they are for', async () => {
  const ctx = world();
  addAgreement(ctx, ctx.a, { body: 'Phones away at dinner', owner: 'both' });
  addAgreement(ctx, ctx.b, { body: 'Book the dentist', owner: 'b' });
  const closed = addAgreement(ctx, ctx.a, { body: 'Already finished', owner: 'a' }).id;
  ctx.db.prepare("UPDATE agreements SET state = 'done', closed_at = ? WHERE id = ?").run('2026-11-17T01:00:00.000Z', closed);
  await reveal(ctx);

  for (const who of ['a', 'b']) {
    const page = await get(ctx, who, '/checkin');
    const text = section(page.body, 'Looking back');
    assert.ok(text, 'there is a Looking back section');
    assert.ok(text.includes('Phones away at dinner · Both'));
    assert.ok(text.includes('Book the dentist · Bo'));
    assert.equal(text.includes('Already finished'), false);
    assert.equal(/\d/.test(text), false, 'no dates, ages or counts');
    // It comes before the answers.
    assert.ok(page.body.indexOf('Looking back') < page.body.indexOf(ADA));
  }
});

test('with no open agreements there is no Looking back heading', async () => {
  const ctx = world();
  await reveal(ctx);
  const page = await get(ctx, 'a', '/checkin');
  assert.equal(page.body.includes('Looking back'), false);
  assert.ok(page.body.includes('One thing for the week'));
});

test('an agreement added from the check-in appears in Looking back on the next visit', async () => {
  const ctx = world();
  await reveal(ctx);
  await post(ctx, 'a', '/checkin/agreement', { body: 'A walk after dinner', owner: 'both' });
  const page = await get(ctx, 'b', '/checkin');
  assert.ok(section(page.body, 'Looking back').includes('A walk after dinner · Both'));
});

test('agreement text in Looking back is escaped', async () => {
  const ctx = world();
  addAgreement(ctx, ctx.a, { body: '<script>alert(1)</script> & "q"', owner: 'both' });
  await reveal(ctx);
  const page = await get(ctx, 'b', '/checkin');
  assert.equal(page.body.includes('<script>alert'), false);
  assert.ok(page.body.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot;'));
});

test('a refused add shows a plain message on the same page and keeps what was typed and chosen', async () => {
  const ctx = world();
  await reveal(ctx);

  const blank = await post(ctx, 'a', '/checkin/agreement', { body: '   ', owner: 'b' });
  assert.equal(blank.statusCode, 400);
  assert.match(blank.body, /Write something first\./);
  assert.match(blank.body, /<h1>Read together<\/h1>/);
  assert.match(blank.body, /<option value="b" selected>Bo<\/option>/);

  const long = 'q'.repeat(301);
  const tooLong = await post(ctx, 'a', '/checkin/agreement', { body: long, owner: 'a' });
  assert.equal(tooLong.statusCode, 400);
  assert.match(tooLong.body, /too long\. Keep it under 300 characters\./);
  assert.ok(tooLong.body.includes(long));
  assert.match(tooLong.body, /<option value="a" selected>Ada<\/option>/);

  const noOwner = await post(ctx, 'a', '/checkin/agreement', { body: 'A real one', owner: 'c' });
  assert.equal(noOwner.statusCode, 400);
  assert.match(noOwner.body, /Choose who it is for\./);
  assert.ok(noOwner.body.includes('A real one'));

  assert.equal(listOpen(ctx).length, 0);
  assert.equal(listEarlier(ctx).length, 0);
});

test('the answers on the page are unchanged by a refused add', async () => {
  const ctx = world();
  await reveal(ctx);
  const res = await post(ctx, 'a', '/checkin/agreement', { body: '', owner: 'both' });
  assert.ok(res.body.includes(ADA) && res.body.includes(BO));
  assert.ok(res.body.indexOf(ADA) < res.body.indexOf(BO));
});

// ---- earlier weeks --------------------------------------------------------

test('an earlier revealed week is read only: no box and no Looking back', async () => {
  const ctx = world();
  addAgreement(ctx, ctx.a, { body: 'Phones away at dinner', owner: 'both' });
  await reveal(ctx);
  ctx.clock.set('2026-12-02T01:00:00Z');
  for (const who of ['a', 'b']) {
    const page = await get(ctx, who, '/checkin/2026-11-15');
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /<h1>Read together<\/h1>/);
    assert.equal(page.body.includes('One thing for the week'), false);
    assert.equal(page.body.includes('Looking back'), false);
    assert.equal(page.body.includes('/checkin/agreement'), false);
  }
});

test('in a later week the box is closed until that week opens', async () => {
  const ctx = world();
  await reveal(ctx);
  ctx.clock.set('2026-12-02T01:00:00Z'); // a new round, nobody has written yet
  const res = await post(ctx, 'a', '/checkin/agreement', { body: 'Old week box', owner: 'both' });
  assert.equal(res.statusCode, 403);
  assert.equal(listOpen(ctx).length, 0);
});
