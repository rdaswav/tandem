import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addAgreement, getAgreement, listEarlier, listOpen } from '../src/core/agreements.js';
import { form, makeAppWithUsers } from './helpers.js';

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

// The visible words in the main part of a page, with all markup removed.
function mainText(body) {
  const main = body.slice(body.indexOf('<main'), body.indexOf('</main>'));
  return main.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// The open-list cards, with the text and ids blanked so two cards can be compared.
function cardShapes(body, texts) {
  return [...body.matchAll(/<div class="card">([\s\S]*?)<\/div>/g)].map((m) => {
    let shape = m[1].replace(/agreements\/\d+\//g, 'agreements/N/');
    for (const t of texts) shape = shape.split(t).join('TEXT');
    return shape;
  });
}

// ---- the open page --------------------------------------------------------

test('the page has one h1, Agreements current, the add form and a link to Earlier', async () => {
  const ctx = world();
  const res = await get(ctx, 'a', '/agreements');
  assert.equal(res.statusCode, 200);
  assert.equal((res.body.match(/<h1[ >]/g) ?? []).length, 1);
  assert.match(res.body, /<h1>Agreements<\/h1>/);
  assert.match(res.body, /<a href="\/agreements" aria-current="page">Agreements<\/a>/);
  assert.match(res.body, /<label for="agreement">What did you agree\?<\/label>/);
  assert.match(res.body, /<input id="agreement" type="text" name="body"[^>]*maxlength="300"/);
  assert.match(res.body, /<label for="owner">Who is it for\?<\/label>/);
  assert.ok(res.body.includes(`name="_csrf" value="${ctx.s.a.csrf}"`));
  assert.match(res.body, /<a href="\/agreements\/earlier">Earlier<\/a>/);
  assert.match(res.body, /No agreements yet\. Add the first one above\./);
});

test('the owner choice lists Both first and selected, then each person by name', async () => {
  const ctx = world();
  const res = await get(ctx, 'b', '/agreements');
  const options = [...res.body.matchAll(/<option value="([^"]+)"( selected)?>([^<]+)<\/option>/g)];
  assert.deepEqual(options.map((m) => [m[1], m[3], Boolean(m[2])]), [
    ['both', 'Both', true],
    ['a', 'Ada', false],
    ['b', 'Bo', false],
  ]);
});

test('adding agreements shows them to both people, oldest first, with who they are for', async () => {
  const ctx = world();
  ctx.clock.set('2026-11-10T01:00:00Z');
  const first = await post(ctx, 'a', '/agreements', { body: 'Phones away at dinner', owner: 'both' });
  assert.equal(first.statusCode, 303);
  assert.equal(first.headers.location, '/agreements');
  ctx.clock.set('2026-11-12T01:00:00Z');
  await post(ctx, 'a', '/agreements', { body: 'Book the dentist', owner: 'a' });
  ctx.clock.set('2026-11-15T01:00:00Z');
  await post(ctx, 'b', '/agreements', { body: 'Plan the weekend away', owner: 'b' });

  for (const who of ['a', 'b']) {
    const page = await get(ctx, who, '/agreements');
    const at = (s) => page.body.indexOf(s);
    assert.ok(at('Phones away at dinner') > -1);
    assert.ok(at('Phones away at dinner') < at('Book the dentist'));
    assert.ok(at('Book the dentist') < at('Plan the weekend away'));
    assert.match(page.body, /<p class="muted small">Both<\/p>/);
    assert.match(page.body, /<p class="muted small">Ada<\/p>/);
    assert.match(page.body, /<p class="muted small">Bo<\/p>/);
  }
  const stored = listOpen(ctx);
  assert.deepEqual(stored.map((g) => [g.source, g.createdBy]), [['direct', ctx.a], ['direct', ctx.a], ['direct', ctx.b]]);
});

test('agreement text is escaped', async () => {
  const ctx = world();
  await post(ctx, 'a', '/agreements', { body: '<script>alert(1)</script> & "q"', owner: 'both' });
  const page = await get(ctx, 'b', '/agreements');
  assert.equal(page.body.includes('<script>alert'), false);
  assert.ok(page.body.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot;'));
});

test('a refused add shows a plain message and keeps what was typed and chosen', async () => {
  const ctx = world();
  const blank = await post(ctx, 'a', '/agreements', { body: '   ', owner: 'b' });
  assert.equal(blank.statusCode, 400);
  assert.match(blank.body, /Write something first\./);
  assert.match(blank.body, /<option value="b" selected>Bo<\/option>/);

  const long = 'w'.repeat(301);
  const tooLong = await post(ctx, 'a', '/agreements', { body: long, owner: 'a' });
  assert.equal(tooLong.statusCode, 400);
  assert.match(tooLong.body, /too long\. Keep it under 300 characters\./);
  assert.ok(tooLong.body.includes(long));
  assert.match(tooLong.body, /<option value="a" selected>Ada<\/option>/);

  for (const owner of ['c', '', undefined]) {
    const fields = { body: 'A real agreement' };
    if (owner !== undefined) fields.owner = owner;
    const res = await post(ctx, 'a', '/agreements', fields);
    assert.equal(res.statusCode, 400, String(owner));
    assert.match(res.body, /Choose who it is for\./);
    assert.ok(res.body.includes('A real agreement'));
  }
  assert.equal(listOpen(ctx).length, 0);
});

// ---- closing --------------------------------------------------------------

test('either person can mark one done or drop it, and it moves to Earlier with its state word', async () => {
  const ctx = world();
  const finished = addAgreement(ctx, ctx.a, { body: 'Cook together on Fridays', owner: 'a' }).id;
  const abandoned = addAgreement(ctx, ctx.b, { body: 'Learn to surf', owner: 'b' }).id;

  ctx.clock.set('2026-11-19T01:00:00Z');
  const done = await post(ctx, 'b', `/agreements/${finished}/done`); // Bo closes Ada's
  assert.equal(done.statusCode, 303);
  assert.equal(done.headers.location, '/agreements');
  ctx.clock.set('2026-11-20T01:00:00Z');
  const drop = await post(ctx, 'a', `/agreements/${abandoned}/drop`); // Ada closes Bo's
  assert.equal(drop.statusCode, 303);

  for (const who of ['a', 'b']) {
    const open = await get(ctx, who, '/agreements');
    assert.equal(open.body.includes('Cook together'), false);
    assert.equal(open.body.includes('Learn to surf'), false);

    const earlier = await get(ctx, who, '/agreements/earlier');
    assert.equal(earlier.statusCode, 200);
    assert.ok(earlier.body.indexOf('Learn to surf') < earlier.body.indexOf('Cook together'), 'most recently closed first');
    assert.match(earlier.body, /Bo · Dropped/);
    assert.match(earlier.body, /Ada · Done/);
  }
});

test('open cards have Done and Drop for everyone', async () => {
  const ctx = world();
  const id = addAgreement(ctx, ctx.a, { body: 'Shared promise', owner: 'both' }).id;
  for (const who of ['a', 'b']) {
    const page = await get(ctx, who, '/agreements');
    assert.ok(page.body.includes(`action="/agreements/${id}/done"`));
    assert.ok(page.body.includes(`action="/agreements/${id}/drop"`));
  }
});

test('a closed agreement stays closed: closing it again is harmless and changes nothing', async () => {
  const ctx = world();
  const id = addAgreement(ctx, ctx.a, { body: 'Closed once', owner: 'both' }).id;
  ctx.clock.set('2026-11-19T01:00:00Z');
  await post(ctx, 'a', `/agreements/${id}/drop`);
  ctx.clock.set('2026-12-01T01:00:00Z');
  const again = await post(ctx, 'b', `/agreements/${id}/done`);
  assert.equal(again.statusCode, 303);
  const g = getAgreement(ctx, id);
  assert.equal(g.state, 'dropped');
  assert.equal(g.closedAt, '2026-11-19T01:00:00.000Z');
});

test('the Earlier page says so when empty', async () => {
  const ctx = world();
  const res = await get(ctx, 'a', '/agreements/earlier');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<h1>Earlier agreements<\/h1>/);
  assert.match(res.body, /Nothing here yet\./);
  assert.match(res.body, /<a href="\/agreements">Back to agreements<\/a>/);
});

// ---- nothing that nags ----------------------------------------------------

test('the open list and Earlier show no dates, ages or counts', async () => {
  const ctx = world();
  ctx.clock.set('2026-01-02T01:00:00Z');
  const old = addAgreement(ctx, ctx.a, { body: 'Promise one', owner: 'both' }).id;
  addAgreement(ctx, ctx.b, { body: 'Promise two', owner: 'a' });
  ctx.clock.set('2026-05-02T01:00:00Z');
  addAgreement(ctx, ctx.b, { body: 'Promise three', owner: 'b' });
  const closed = addAgreement(ctx, ctx.a, { body: 'Closed one', owner: 'both' }).id;
  ctx.clock.set('2026-11-18T01:00:00Z');
  addAgreement(ctx, ctx.a, { body: 'Promise four', owner: 'both' });
  await post(ctx, 'a', `/agreements/${closed}/done`);
  assert.ok(old);

  const open = mainText((await get(ctx, 'a', '/agreements')).body);
  const earlier = mainText((await get(ctx, 'b', '/agreements/earlier')).body);
  for (const [name, text] of [['open', open], ['earlier', earlier]]) {
    assert.equal(/\d/.test(text), false, `${name} page shows a digit: ${text}`);
    assert.equal(/\b(ago|day|days|week|weeks|month|months|year|since|overdue|waiting|open now|total)\b/i.test(text), false, name);
  }
  const rawOpen = (await get(ctx, 'a', '/agreements')).body;
  assert.equal(rawOpen.includes('<time'), false);
});

test('an agreement made long ago looks exactly like one made today', async () => {
  const ctx = world();
  ctx.clock.set('2026-01-02T01:00:00Z');
  addAgreement(ctx, ctx.a, { body: 'Very old promise', owner: 'both' });
  ctx.clock.set('2026-11-18T01:00:00Z');
  addAgreement(ctx, ctx.a, { body: 'Brand new promise', owner: 'both' });

  const page = await get(ctx, 'a', '/agreements');
  assert.ok(page.body.indexOf('Very old promise') < page.body.indexOf('Brand new promise'));
  const shapes = cardShapes(page.body, ['Very old promise', 'Brand new promise']);
  assert.equal(shapes.length, 2);
  assert.equal(shapes[0], shapes[1]);
  assert.equal(page.body.includes('style='), false, 'no inline styling that could change with age');
});

// ---- errors and access ----------------------------------------------------

test('unknown or odd ids are 404', async () => {
  const ctx = world();
  for (const action of ['done', 'drop']) {
    for (const id of ['999', 'abc', '1x', '0000000000000']) {
      const res = await post(ctx, 'a', `/agreements/${id}/${action}`);
      assert.equal(res.statusCode, 404, `${action} ${id}`);
    }
  }
});

test('agreement POSTs without the CSRF token are refused and change nothing', async () => {
  const ctx = world();
  const id = addAgreement(ctx, ctx.a, { body: 'Mine', owner: 'both' }).id;
  for (const url of ['/agreements', `/agreements/${id}/done`, `/agreements/${id}/drop`]) {
    const res = await ctx.app.inject({ method: 'POST', url, ...form({ body: 'x', owner: 'both' }, ctx.s.a.headers) });
    assert.equal(res.statusCode, 403, url);
  }
  assert.equal(listOpen(ctx).length, 1);
  assert.equal(listEarlier(ctx).length, 0);
});

test('the agreements pages need a session', async () => {
  const ctx = world();
  for (const url of ['/agreements', '/agreements/earlier']) {
    const res = await ctx.app.inject({ method: 'GET', url });
    assert.equal(res.statusCode, 303, url);
    assert.equal(res.headers.location, '/signin', url);
  }
});
