import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_IDEA_LENGTH, addIdea, listIdeas, markDone, removeIdea } from '../src/core/ideas.js';
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
const ids = (list) => list.map((i) => i.id);

// ---- the store ------------------------------------------------------------

test('an idea is added open, trimmed, with its author', () => {
  const ctx = world();
  const { id } = addIdea(ctx, ctx.b, { body: '  Try the new ramen place \n' });
  const [idea] = listIdeas(ctx).open;
  assert.equal(idea.id, id);
  assert.equal(idea.body, 'Try the new ramen place');
  assert.equal(idea.authorName, 'Bo');
  assert.equal(idea.state, 'open');
  assert.equal(idea.doneAt, null);
});

test('blank text is refused and the limit is 2000 characters', () => {
  const ctx = world();
  for (const bad of ['', '  \n ', undefined, null, 7]) {
    assert.equal(addIdea(ctx, ctx.a, { body: bad }).error, 'blank');
  }
  assert.equal(addIdea(ctx, ctx.a, undefined).error, 'blank');
  assert.equal(MAX_IDEA_LENGTH, 2000);
  assert.equal(addIdea(ctx, ctx.a, { body: 'x'.repeat(2000) }).ok, true);
  assert.equal(addIdea(ctx, ctx.a, { body: 'x'.repeat(2001) }).error, 'too_long');
  assert.equal(listIdeas(ctx).open.length, 1);
});

test('open ideas are newest first', () => {
  const ctx = world();
  const first = addIdea(ctx, ctx.a, { body: 'first' }).id;
  const second = addIdea(ctx, ctx.b, { body: 'second' }).id;
  const third = addIdea(ctx, ctx.a, { body: 'third' }).id;
  assert.deepEqual(ids(listIdeas(ctx).open), [third, second, first]);
});

test('either person can mark any open idea done', () => {
  const ctx = world();
  const byAda = addIdea(ctx, ctx.a, { body: 'ada idea' }).id;
  const byBo = addIdea(ctx, ctx.b, { body: 'bo idea' }).id;

  ctx.clock.set('2026-11-19T02:00:00Z');
  assert.equal(markDone(ctx, ctx.b, byAda).ok, true); // Bo finishes Ada's idea
  ctx.clock.set('2026-11-20T02:00:00Z');
  assert.equal(markDone(ctx, ctx.b, byBo).ok, true); // and his own

  const { open, done } = listIdeas(ctx);
  assert.deepEqual(open, []);
  assert.deepEqual(ids(done), [byBo, byAda], 'most recently done first');
  assert.equal(done[1].doneAt, '2026-11-19T02:00:00.000Z');
  assert.equal(done[0].state, 'done');
});

test('marking done twice, or a removed or unknown idea, is refused', () => {
  const ctx = world();
  const id = addIdea(ctx, ctx.a, { body: 'one' }).id;
  assert.equal(markDone(ctx, ctx.a, id).ok, true);
  assert.equal(markDone(ctx, ctx.b, id).error, 'not_open');
  assert.equal(markDone(ctx, ctx.a, 999).error, 'not_found');

  const gone = addIdea(ctx, ctx.a, { body: 'gone' }).id;
  removeIdea(ctx, ctx.a, gone);
  assert.equal(markDone(ctx, ctx.b, gone).error, 'not_found');
});

test('only the author can remove, and removed ideas are never listed', () => {
  const ctx = world();
  const id = addIdea(ctx, ctx.a, { body: 'ada idea' }).id;
  assert.deepEqual(removeIdea(ctx, ctx.b, id), { ok: false, error: 'not_author' });
  assert.equal(listIdeas(ctx).open.length, 1);

  assert.equal(removeIdea(ctx, ctx.a, id).ok, true);
  const { open, done } = listIdeas(ctx);
  assert.deepEqual([open.length, done.length], [0, 0]);
  assert.equal(ctx.db.prepare('SELECT state FROM ideas WHERE id = ?').get(id).state, 'removed');
  assert.equal(removeIdea(ctx, ctx.a, id).error, 'not_found');
  assert.equal(removeIdea(ctx, ctx.a, 999).error, 'not_found');
});

test('a done idea can still be removed by its author, and not by the other person', () => {
  const ctx = world();
  const id = addIdea(ctx, ctx.a, { body: 'finished idea' }).id;
  markDone(ctx, ctx.b, id);
  assert.equal(removeIdea(ctx, ctx.b, id).error, 'not_author');
  assert.equal(listIdeas(ctx).done.length, 1);
  assert.equal(removeIdea(ctx, ctx.a, id).ok, true);
  assert.equal(listIdeas(ctx).done.length, 0);
});

// ---- the pages ------------------------------------------------------------

test('the Ideas page has one h1, the add form and the tab links with Ideas current', async () => {
  const ctx = world();
  const res = await get(ctx, 'a', '/ideas');
  assert.equal(res.statusCode, 200);
  assert.equal((res.body.match(/<h1[ >]/g) ?? []).length, 1);
  assert.match(res.body, /<h1>Ideas<\/h1>/);
  assert.match(
    res.body,
    /<nav class="tabs" aria-label="Moments and ideas"><a href="\/moments">Moments<\/a> <a href="\/ideas" aria-current="page">Ideas<\/a><\/nav>/,
  );
  assert.match(res.body, /<label for="idea">Something we could do together<\/label>/);
  assert.match(res.body, /<input id="idea" type="text" name="body"/);
  assert.ok(res.body.includes(`name="_csrf" value="${ctx.s.a.csrf}"`));
  assert.match(res.body, /No ideas yet\. Add the first one above\./);
  // The bottom bar keeps Moments as the current section while on Ideas.
  assert.match(res.body, /<nav class="bottom-bar"[^>]*>.*<a href="\/moments" aria-current="page">Moments<\/a>/);
});

test('the Moments page has the same tabs with Moments current, and an add form to link to', async () => {
  const ctx = world();
  const res = await get(ctx, 'a', '/moments');
  assert.match(
    res.body,
    /<nav class="tabs" aria-label="Moments and ideas"><a href="\/moments" aria-current="page">Moments<\/a> <a href="\/ideas">Ideas<\/a><\/nav>/,
  );
  assert.match(res.body, /<form class="card" id="new-moment" method="post" action="\/moments">/);
});

test('adding an idea shows it to both people at once', async () => {
  const ctx = world();
  const res = await post(ctx, 'a', '/ideas', { body: 'Take the ferry to the island' });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/ideas');
  for (const who of ['a', 'b']) {
    const page = await get(ctx, who, '/ideas');
    assert.ok(page.body.includes('Take the ferry to the island'));
    assert.match(page.body, /<h2>To try<\/h2>/);
  }
});

test('idea text is escaped', async () => {
  const ctx = world();
  await post(ctx, 'a', '/ideas', { body: '<script>alert(1)</script> & "q"' });
  const page = await get(ctx, 'b', '/ideas');
  assert.equal(page.body.includes('<script>alert'), false);
  assert.ok(page.body.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot;'));
});

test('a refused add shows a plain message and keeps what was typed', async () => {
  const ctx = world();
  const blank = await post(ctx, 'a', '/ideas', { body: '   ' });
  assert.equal(blank.statusCode, 400);
  assert.match(blank.body, /Write something first\./);

  const long = 'z'.repeat(2001);
  const tooLong = await post(ctx, 'a', '/ideas', { body: long });
  assert.equal(tooLong.statusCode, 400);
  assert.match(tooLong.body, /too long\. Keep it under 2000 characters\./);
  assert.ok(tooLong.body.includes(long));
  assert.equal(listIdeas(ctx).open.length, 0);
});

test('open ideas show Done to both people and Remove only to the author', async () => {
  const ctx = world();
  const id = addIdea(ctx, ctx.a, { body: 'ada wrote this' }).id;

  const mine = await get(ctx, 'a', '/ideas');
  assert.ok(mine.body.includes(`action="/ideas/${id}/done"`));
  assert.ok(mine.body.includes(`action="/ideas/${id}/remove"`));

  const theirs = await get(ctx, 'b', '/ideas');
  assert.ok(theirs.body.includes(`action="/ideas/${id}/done"`), 'the other person can mark it done');
  assert.equal(theirs.body.includes(`/ideas/${id}/remove`), false, 'but cannot remove it');
});

test('there is no add-a-moment link on an open idea; it appears once the idea is done', async () => {
  const ctx = world();
  const id = addIdea(ctx, ctx.a, { body: 'Picnic by the river' }).id;
  const before = await get(ctx, 'a', '/ideas');
  assert.equal(before.body.includes('Add a moment about it'), false);
  assert.equal(before.body.includes('/moments#new-moment'), false);

  const res = await post(ctx, 'b', `/ideas/${id}/done`); // the other person marks it done
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/ideas');

  for (const who of ['a', 'b']) {
    const after = await get(ctx, who, '/ideas');
    assert.match(after.body, /<h2>Done<\/h2>/);
    assert.match(after.body, /<a href="\/moments#new-moment">Add a moment about it<\/a>/);
    assert.equal(after.body.includes(`/ideas/${id}/done`), false, 'no Done button any more');
    assert.equal(after.body.includes(`/ideas/${id}/remove`), false, 'no controls on a done idea');
  }
});

test('nothing is added to the moments log automatically when an idea is done', async () => {
  const ctx = world();
  const id = addIdea(ctx, ctx.a, { body: 'Picnic by the river' }).id;
  await post(ctx, 'a', `/ideas/${id}/done`);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM moments').get().n, 0);
});

test('marking done twice is harmless', async () => {
  const ctx = world();
  const id = addIdea(ctx, ctx.a, { body: 'once' }).id;
  assert.equal((await post(ctx, 'a', `/ideas/${id}/done`)).statusCode, 303);
  const again = await post(ctx, 'a', `/ideas/${id}/done`);
  assert.equal(again.statusCode, 303);
  assert.equal(listIdeas(ctx).done.length, 1);
});

test('removing: author yes, the other person 403 with nothing changed, unknown or odd ids 404', async () => {
  const ctx = world();
  const id = addIdea(ctx, ctx.a, { body: 'remove me' }).id;

  const denied = await post(ctx, 'b', `/ideas/${id}/remove`);
  assert.equal(denied.statusCode, 403);
  assert.match(denied.body, /only the ideas you wrote yourself/);
  assert.equal(listIdeas(ctx).open.length, 1);

  const ok = await post(ctx, 'a', `/ideas/${id}/remove`);
  assert.equal(ok.statusCode, 303);
  assert.equal(listIdeas(ctx).open.length, 0);
  assert.equal((await get(ctx, 'b', '/ideas')).body.includes('remove me'), false);

  for (const url of [`/ideas/${id}/remove`, '/ideas/999/remove', '/ideas/abc/remove', '/ideas/999/done', '/ideas/abc/done']) {
    assert.equal((await post(ctx, 'a', url)).statusCode, 404, url);
  }
});

test('idea POSTs without the CSRF token are refused', async () => {
  const ctx = world();
  const id = addIdea(ctx, ctx.a, { body: 'mine' }).id;
  for (const url of ['/ideas', `/ideas/${id}/done`, `/ideas/${id}/remove`]) {
    const res = await ctx.app.inject({ method: 'POST', url, ...form({ body: 'x' }, ctx.s.a.headers) });
    assert.equal(res.statusCode, 403, url);
  }
  const { open, done } = listIdeas(ctx);
  assert.deepEqual([open.length, done.length], [1, 0]);
});

test('the Ideas pages need a session', async () => {
  const ctx = world();
  const res = await ctx.app.inject({ method: 'GET', url: '/ideas' });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/signin');
});
