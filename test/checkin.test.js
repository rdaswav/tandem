import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answersVisibleTo, currentRound } from '../src/core/rounds.js';
import { form, makeAppWithUsers } from './helpers.js';

const ADA = 'Ada private answer 7731';
const BO = 'Bo private answer 4402';

// Wednesday 18 November 2026, noon in Melbourne. This week started on the 15th.
function world() {
  const ctx = makeAppWithUsers();
  ctx.clock.set('2026-11-18T01:00:00Z');
  ctx.s = { a: ctx.login('a'), b: ctx.login('b') };
  return ctx;
}

const get = (ctx, who, url) => ctx.app.inject({ method: 'GET', url, headers: ctx.s[who].headers });

const post = (ctx, who, url, fields = {}) =>
  ctx.app.inject({ method: 'POST', url, ...form({ _csrf: ctx.s[who].csrf, ...fields }, ctx.s[who].headers) });

// The CSRF token differs per session, so blank it before comparing pages.
const plain = (body) => body.replace(/name="_csrf" value="[^"]*"/g, 'name="_csrf" value="X"');

async function finish(ctx, who, text) {
  return post(ctx, who, '/checkin/submit', { appreciated: text });
}

// ---- writing --------------------------------------------------------------

test('the writing page asks the four fixed prompts and this week\'s question', async () => {
  const ctx = world();
  const res = await get(ctx, 'a', '/checkin');
  assert.equal(res.statusCode, 200);
  for (const text of [
    'Something I appreciated about you this week',
    'Something that was hard for me this week',
    'Something I would like more of, or need',
    'One thing I would like us to do in the coming week',
    'Something I would like to say thank you for',
  ]) {
    assert.ok(res.body.includes(text), text);
  }
  assert.match(res.body, /<h2>This week's question<\/h2>/);
  assert.match(res.body, /Bo cannot see this until you have both finished\./);
  assert.match(res.body, /formaction="\/checkin\/save">Save draft</);
  assert.match(res.body, /formaction="\/checkin\/submit">I'm done</);
  assert.ok(res.body.includes(`name="_csrf" value="${ctx.s.a.csrf}"`));
});

test('the page has one h1, Check-in is marked current, and every textarea has a label', async () => {
  const ctx = world();
  const res = await get(ctx, 'a', '/checkin');
  assert.equal((res.body.match(/<h1[ >]/g) ?? []).length, 1);
  assert.match(res.body, /<a href="\/checkin" aria-current="page">Check-in<\/a>/);
  const areas = [...res.body.matchAll(/<textarea id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(areas.length, 5);
  for (const id of areas) assert.ok(res.body.includes(`<label for="${id}">`), id);
});

test('save draft keeps the text, shows it again, and escapes it', async () => {
  const ctx = world();
  const res = await post(ctx, 'a', '/checkin/save', { appreciated: '<script>alert(1)</script> & "quotes"' });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/checkin');

  const page = await get(ctx, 'a', '/checkin');
  assert.equal(page.body.includes('<script>alert'), false);
  assert.ok(page.body.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;'));
  assert.match(page.body, /<textarea id="p-appreciated"/);
});

test('a form can only write the prompts this week asks, and only for the person signed in', async () => {
  const ctx = world();
  await post(ctx, 'a', '/checkin/save', {
    appreciated: 'real answer',
    r01: 'a rotating prompt from another week',
    user_id: String(ctx.users.b.id),
    round_id: '99',
  });
  const rows = ctx.db.prepare('SELECT user_id, prompt_id, body FROM answers').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, ctx.users.a.id);
  assert.equal(rows[0].prompt_id, 'appreciated');
});

test('submit saves what is on the page, then shows the done message with no form', async () => {
  const ctx = world();
  const res = await finish(ctx, 'a', ADA);
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/checkin');

  const page = await get(ctx, 'a', '/checkin');
  assert.match(page.body, /You are done\. This opens when you have both finished\./);
  assert.ok(page.body.includes(ADA));
  assert.equal(page.body.includes('<textarea'), false);
  assert.equal(page.body.includes('formaction'), false);
});

test('after submitting, a further save changes nothing', async () => {
  const ctx = world();
  await finish(ctx, 'a', ADA);
  const res = await post(ctx, 'a', '/checkin/save', { appreciated: 'a sneaky change' });
  assert.equal(res.statusCode, 303);
  const page = await get(ctx, 'a', '/checkin');
  assert.ok(page.body.includes(ADA));
  assert.equal(page.body.includes('sneaky'), false);
});

test('submitting with nothing written is refused with a plain message and nothing is locked', async () => {
  const ctx = world();
  const res = await post(ctx, 'a', '/checkin/submit', { appreciated: '   ', hard: '' });
  assert.equal(res.statusCode, 400);
  assert.match(res.body, /Write at least one answer first/);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM submissions').get().n, 0);
  assert.match((await get(ctx, 'a', '/checkin')).body, /<textarea/);
});

test('a too-long answer is refused, the text stays on the page, and nothing is saved', async () => {
  const ctx = world();
  const long = 'x'.repeat(2001);
  for (const url of ['/checkin/save', '/checkin/submit']) {
    const res = await post(ctx, 'a', url, { appreciated: long, hard: 'a fine answer' });
    assert.equal(res.statusCode, 400, url);
    assert.match(res.body, /too long\. Keep each one under 2000 characters/);
    assert.ok(res.body.includes(long), 'the entered text is kept on the page');
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM answers').get().n, 0, url);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM submissions').get().n, 0, url);
  }
});

test('line breaks in an answer show as line breaks, not as markup', async () => {
  const ctx = world();
  await post(ctx, 'a', '/checkin/save', { appreciated: 'line one' });
  await finish(ctx, 'a', 'first line\nsecond <b>line</b>');
  const page = await get(ctx, 'a', '/checkin');
  assert.ok(page.body.includes('first line<br>second &lt;b&gt;line&lt;/b&gt;'));
});

test('a POST without the CSRF token is refused and saves nothing', async () => {
  const ctx = world();
  for (const url of ['/checkin/save', '/checkin/submit']) {
    const res = await ctx.app.inject({ method: 'POST', url, ...form({ appreciated: ADA }, ctx.s.a.headers) });
    assert.equal(res.statusCode, 403, url);
  }
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM answers').get().n, 0);
});

// ---- the privacy rule at the page level -----------------------------------

// Everything a person's check-in pages say, for one stretch of the week.
async function viewsOf(ctx, who) {
  const pages = {};
  for (const url of ['/checkin', '/checkin/past']) pages[url] = plain((await get(ctx, who, url)).body);
  return pages;
}

const moves = {
  'does nothing': () => {},
  'writes a draft': (ctx, who) => post(ctx, who, '/checkin/save', { appreciated: 'a draft nobody should see 5513' }),
  'submits': (ctx, who) => finish(ctx, who, 'a submitted answer nobody should see 8820'),
};

for (const [viewer, other] of [['b', 'a'], ['a', 'b']]) {
  test(`${viewer}'s pages are identical whether ${other} does nothing, drafts or submits, and never hold ${other}'s words`, async () => {
    const baseline = {};
    for (const [label, move] of Object.entries(moves)) {
      const ctx = world();
      await get(ctx, other, '/checkin'); // opening the page is allowed to differ too
      await move(ctx, other);

      const before = await viewsOf(ctx, viewer);
      await post(ctx, viewer, '/checkin/save', { appreciated: 'my own words 1199' });
      const after = await viewsOf(ctx, viewer);

      for (const pages of [before, after]) {
        for (const body of Object.values(pages)) {
          assert.equal(body.includes('nobody should see'), false, `${other} ${label}: their words leaked`);
        }
      }
      if (label === 'does nothing') Object.assign(baseline, { before, after });
      else assert.deepEqual({ before, after }, baseline, `${viewer}'s pages changed when ${other} ${label}`);
    }
  });
}

test('once both are done both pages show both sets, slot a first, with names', async () => {
  const ctx = world();
  await post(ctx, 'b', '/checkin/save', { hard: 'Bo says hard' });
  await finish(ctx, 'b', BO);
  const waiting = await get(ctx, 'a', '/checkin');
  assert.equal(waiting.body.includes(BO), false);

  await finish(ctx, 'a', ADA);
  for (const who of ['a', 'b']) {
    const page = await get(ctx, who, '/checkin');
    assert.match(page.body, /<h1>Read together<\/h1>/);
    assert.ok(page.body.includes(ADA) && page.body.includes(BO));
    assert.ok(page.body.indexOf(ADA) < page.body.indexOf(BO), `${who}: Ada's answer comes first`);
    assert.ok(page.body.includes('Bo says hard'));
    assert.match(page.body, /\(left blank\)/);
    assert.match(page.body, /<p class="muted small">Ada<\/p>/);
    assert.match(page.body, /<p class="muted small">Bo<\/p>/);
    assert.equal(page.body.includes('<textarea'), false);
  }
});

test('after reveal a save does not change what either person wrote', async () => {
  const ctx = world();
  await finish(ctx, 'a', ADA);
  await finish(ctx, 'b', BO);
  await post(ctx, 'a', '/checkin/save', { appreciated: 'rewritten after the fact' });
  const page = await get(ctx, 'b', '/checkin');
  assert.ok(page.body.includes(ADA));
  assert.equal(page.body.includes('rewritten'), false);
});

// ---- earlier weeks --------------------------------------------------------

test('a passed round shows each person only their own answers', async () => {
  const ctx = world();
  await finish(ctx, 'a', ADA); // Ada is done; Bo only drafts
  await post(ctx, 'b', '/checkin/save', { appreciated: BO });

  ctx.clock.set('2026-11-25T01:00:00Z'); // the next week
  const a = await get(ctx, 'a', '/checkin/2026-11-15');
  const b = await get(ctx, 'b', '/checkin/2026-11-15');
  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  assert.match(a.body, /This one passed\./);
  assert.match(b.body, /This one passed\./);
  assert.ok(a.body.includes(ADA) && !a.body.includes(BO));
  assert.ok(b.body.includes(BO) && !b.body.includes(ADA));
  assert.match(a.body, /Week of 15 November 2026/);

  for (const who of ['a', 'b']) {
    const list = await get(ctx, who, '/checkin/past');
    assert.ok(list.body.includes('href="/checkin/2026-11-15"'));
    assert.ok(!list.body.includes(ADA) && !list.body.includes(BO));
  }
  // The new week starts fresh.
  assert.match((await get(ctx, 'a', '/checkin')).body, /<textarea/);
});

test('a revealed round can be read later by both', async () => {
  const ctx = world();
  await finish(ctx, 'a', ADA);
  await finish(ctx, 'b', BO);
  ctx.clock.set('2026-12-10T01:00:00Z');
  for (const who of ['a', 'b']) {
    const page = await get(ctx, who, '/checkin/2026-11-15');
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /<h1>Read together<\/h1>/);
    assert.ok(page.body.includes(ADA) && page.body.includes(BO));
    const list = await get(ctx, who, '/checkin/past');
    assert.match(list.body, /Week of 15 November 2026/);
    assert.match(list.body, /Read together/);
  }
});

test('probes: the other person\'s week, a future week, a bad address and this week', async () => {
  const ctx = world();
  await finish(ctx, 'a', ADA); // only Ada wrote
  ctx.clock.set('2026-11-25T01:00:00Z');

  // Bo asks for the week only Ada wrote in: indistinguishable from a week nobody opened.
  const theirs = await get(ctx, 'b', '/checkin/2026-11-15');
  const never = await get(ctx, 'b', '/checkin/2026-10-04');
  assert.equal(theirs.statusCode, 404);
  assert.equal(never.statusCode, 404);
  // The default 404 body echoes the path that was asked for, so compare with that blanked.
  const blank = (body, path) => body.replace(path, 'PATH');
  assert.equal(blank(theirs.body, '2026-11-15'), blank(never.body, '2026-10-04'));
  assert.deepEqual(theirs.headers['content-type'], never.headers['content-type']);
  assert.equal(theirs.body.includes(ADA), false);

  // Bo's list does not show it either.
  const list = await get(ctx, 'b', '/checkin/past');
  assert.equal(list.body.includes('2026-11-15'), false);
  assert.match(list.body, /Nothing here yet\./);

  // A week that has not happened yet.
  assert.equal((await get(ctx, 'b', '/checkin/2026-12-06')).statusCode, 404);
  assert.equal((await get(ctx, 'a', '/checkin/2027-01-03')).statusCode, 404);

  // Not a date.
  for (const url of ['/checkin/abc', '/checkin/2026-11-15x', '/checkin/2026-1-5']) {
    assert.equal((await get(ctx, 'b', url)).statusCode, 404, url);
  }

  // This week's address goes to the live page.
  const now = await get(ctx, 'b', '/checkin/2026-11-22');
  assert.equal(now.statusCode, 303);
  assert.equal(now.headers.location, '/checkin');
});

test('asking for an unopened round does not create one', async () => {
  const ctx = world();
  await get(ctx, 'a', '/checkin'); // creates this week's round
  const before = ctx.db.prepare('SELECT COUNT(*) AS n FROM rounds').get().n;
  await get(ctx, 'a', '/checkin/2026-10-04');
  await get(ctx, 'a', '/checkin/2026-12-06');
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM rounds').get().n, before);
});

test('the past list says so when it is empty', async () => {
  const ctx = world();
  const res = await get(ctx, 'a', '/checkin/past');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<h1>Earlier check-ins<\/h1>/);
  assert.match(res.body, /Nothing here yet\./);
});

test('an answer to a prompt that has left the pack still shows, under its id', async () => {
  const ctx = world();
  const round = currentRound(ctx);
  ctx.db
    .prepare('INSERT INTO answers (round_id, user_id, prompt_id, body, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(round.id, ctx.users.a.id, 'gone_prompt', 'Ada old text', '2026-11-18T01:00:00.000Z');
  assert.equal(answersVisibleTo(ctx, round.id, ctx.users.a.id).length, 1);
  ctx.clock.set('2026-11-25T01:00:00Z');
  const page = await get(ctx, 'a', '/checkin/2026-11-15');
  assert.equal(page.statusCode, 200);
  assert.ok(page.body.includes('gone_prompt'));
  assert.ok(page.body.includes('Ada old text'));
});

test('the check-in pages need a session', async () => {
  const ctx = world();
  for (const url of ['/checkin', '/checkin/past', '/checkin/2026-11-15']) {
    const res = await ctx.app.inject({ method: 'GET', url });
    assert.equal(res.statusCode, 303, url);
    assert.equal(res.headers.location, '/signin', url);
  }
});
