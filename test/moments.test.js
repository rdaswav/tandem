import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_MOMENT_LENGTH,
  addMoment,
  editMoment,
  fromTheLog,
  listMoments,
  removeMoment,
  todayFor,
} from '../src/core/moments.js';
import { addDays, daysBetween } from '../src/core/week.js';
import { form, makeAppWithUsers } from './helpers.js';

// Wednesday 18 November 2026, noon in Melbourne.
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

// ---- the store ------------------------------------------------------------

test('a moment with no date is dated today in the configured time zone', () => {
  const ctx = world();
  ctx.clock.set('2026-11-14T13:30:00Z'); // Saturday in UTC, already Sunday in Melbourne
  assert.equal(todayFor(ctx), '2026-11-15');
  const added = addMoment(ctx, ctx.a, { body: 'A walk on the beach' });
  assert.equal(added.ok, true);
  assert.equal(listMoments(ctx)[0].happenedOn, '2026-11-15');
  assert.equal(addMoment(ctx, ctx.a, { happenedOn: '', body: 'Empty date means today' }).ok, true);
  assert.equal(listMoments(ctx)[0].happenedOn, '2026-11-15');
});

test('a past date is accepted, today is accepted, tomorrow is refused', () => {
  const ctx = world();
  assert.equal(addMoment(ctx, ctx.a, { happenedOn: '2026-10-02', body: 'Earlier' }).ok, true);
  assert.equal(addMoment(ctx, ctx.a, { happenedOn: '2026-11-18', body: 'Today' }).ok, true);
  assert.deepEqual(addMoment(ctx, ctx.a, { happenedOn: '2026-11-19', body: 'Tomorrow' }), {
    ok: false,
    error: 'future_date',
  });
  assert.equal(listMoments(ctx).length, 2);
});

test('the future is judged in the local time zone, not UTC', () => {
  const ctx = world();
  ctx.clock.set('2026-11-14T13:30:00Z'); // Sunday 15th in Melbourne, still the 14th in UTC
  assert.equal(addMoment(ctx, ctx.a, { happenedOn: '2026-11-15', body: 'Local today' }).ok, true);
  assert.equal(addMoment(ctx, ctx.a, { happenedOn: '2026-11-16', body: 'Local tomorrow' }).error, 'future_date');
});

test('dates that are not real dates are refused', () => {
  const ctx = world();
  for (const bad of ['2026-02-30', 'abc', '2026-2-3', '18/11/2026', '1999-12-31', '2026-13-01', 20261118, {}]) {
    assert.equal(addMoment(ctx, ctx.a, { happenedOn: bad, body: 'x' }).error, 'bad_date', String(bad));
  }
  assert.equal(listMoments(ctx).length, 0);
});

test('empty and whitespace-only text is refused, and the length limit is 2000', () => {
  const ctx = world();
  for (const bad of ['', '   \n\t', undefined, null, 42]) {
    assert.equal(addMoment(ctx, ctx.a, { body: bad }).error, 'blank');
  }
  assert.equal(addMoment(ctx, ctx.a, undefined).error, 'blank');
  assert.equal(MAX_MOMENT_LENGTH, 2000);
  assert.equal(addMoment(ctx, ctx.a, { body: 'x'.repeat(2000) }).ok, true);
  assert.equal(addMoment(ctx, ctx.a, { body: 'x'.repeat(2001) }).error, 'too_long');
  assert.equal(listMoments(ctx).length, 1);
});

test('text is trimmed and the author name comes with each moment', () => {
  const ctx = world();
  addMoment(ctx, ctx.b, { body: '  Dinner with friends \n' });
  const [m] = listMoments(ctx);
  assert.equal(m.body, 'Dinner with friends');
  assert.equal(m.authorName, 'Bo');
  assert.equal(m.authorSlot, 'b');
});

test('moments are listed newest first by date, then by id, across both authors', () => {
  const ctx = world();
  const first = addMoment(ctx, ctx.a, { happenedOn: '2026-10-05', body: 'oct 5' }).id;
  const second = addMoment(ctx, ctx.b, { happenedOn: '2026-11-02', body: 'nov 2 first' }).id;
  const third = addMoment(ctx, ctx.a, { happenedOn: '2026-11-02', body: 'nov 2 second' }).id;
  const fourth = addMoment(ctx, ctx.b, { happenedOn: '2026-09-30', body: 'sep 30' }).id;
  assert.deepEqual(listMoments(ctx).map((m) => m.id), [third, second, first, fourth]);
});

test('the author can edit their own moment, the other person cannot', () => {
  const ctx = world();
  const { id } = addMoment(ctx, ctx.a, { happenedOn: '2026-11-01', body: 'original' });

  assert.deepEqual(editMoment(ctx, ctx.b, id, { happenedOn: '2026-11-02', body: 'hijacked' }), {
    ok: false,
    error: 'not_author',
  });
  assert.deepEqual(
    [listMoments(ctx)[0].body, listMoments(ctx)[0].happenedOn],
    ['original', '2026-11-01'],
  );

  assert.equal(editMoment(ctx, ctx.a, id, { happenedOn: '2026-11-03', body: 'changed' }).ok, true);
  assert.deepEqual(
    [listMoments(ctx)[0].body, listMoments(ctx)[0].happenedOn],
    ['changed', '2026-11-03'],
  );
});

test('an edit with bad input changes nothing', () => {
  const ctx = world();
  const { id } = addMoment(ctx, ctx.a, { happenedOn: '2026-11-01', body: 'original' });
  assert.equal(editMoment(ctx, ctx.a, id, { happenedOn: '2026-11-01', body: '  ' }).error, 'blank');
  assert.equal(editMoment(ctx, ctx.a, id, { happenedOn: '2026-12-25', body: 'x' }).error, 'future_date');
  assert.equal(editMoment(ctx, ctx.a, id, { happenedOn: 'nope', body: 'x' }).error, 'bad_date');
  assert.equal(editMoment(ctx, ctx.a, id, { body: 'x'.repeat(2001) }).error, 'too_long');
  assert.equal(listMoments(ctx)[0].body, 'original');
});

test('only the author can remove, and removed moments are never listed', () => {
  const ctx = world();
  const { id } = addMoment(ctx, ctx.a, { body: 'to be removed' });
  assert.deepEqual(removeMoment(ctx, ctx.b, id), { ok: false, error: 'not_author' });
  assert.equal(listMoments(ctx).length, 1);

  assert.equal(removeMoment(ctx, ctx.a, id).ok, true);
  assert.equal(listMoments(ctx).length, 0);
  const row = ctx.db.prepare('SELECT deleted_at FROM moments WHERE id = ?').get(id);
  assert.ok(row.deleted_at, 'a soft delete: the row stays, marked');

  assert.equal(removeMoment(ctx, ctx.a, id).error, 'not_found');
  assert.equal(editMoment(ctx, ctx.a, id, { body: 'back from the dead' }).error, 'not_found');
  assert.equal(removeMoment(ctx, ctx.a, 999).error, 'not_found');
});

// ---- from the log ---------------------------------------------------------

test('fromTheLog is null with no moments, and null while nothing is 14 days old', () => {
  const ctx = world();
  assert.equal(fromTheLog(ctx), null);
  addMoment(ctx, ctx.a, { happenedOn: '2026-11-05', body: 'thirteen days ago' }); // 13 days
  addMoment(ctx, ctx.b, { happenedOn: '2026-11-18', body: 'today' });
  assert.equal(fromTheLog(ctx), null);
});

test('a moment becomes eligible at exactly 14 days old', () => {
  const ctx = world();
  addMoment(ctx, ctx.a, { happenedOn: '2026-11-04', body: 'fourteen days ago' });
  assert.equal(fromTheLog(ctx).body, 'fourteen days ago');
  ctx.clock.set('2026-11-17T01:00:00Z'); // the same moment is now only 13 days old
  assert.equal(fromTheLog(ctx), null);
});

test('fromTheLog gives the same moment all day and one different moment on another day', () => {
  const ctx = world();
  const ids = ['2026-08-01', '2026-08-15', '2026-09-01'].map(
    (d) => addMoment(ctx, ctx.a, { happenedOn: d, body: `moment ${d}` }).id,
  );

  const morning = fromTheLog(ctx);
  ctx.clock.set('2026-11-18T10:00:00Z'); // same Melbourne day, evening
  assert.equal(fromTheLog(ctx).id, morning.id);

  // The next three days cycle through all three.
  const picked = [];
  for (let i = 0; i < 3; i += 1) {
    ctx.clock.set(`${addDays('2026-11-18', i)}T01:00:00Z`);
    picked.push(fromTheLog(ctx).id);
  }
  assert.deepEqual([...picked].sort(), [...ids].sort());
  assert.equal(new Set(picked).size, 3);
  assert.equal(picked[0], morning.id);
});

test('fromTheLog picks by day number modulo the count, in id order', () => {
  const ctx = world();
  const ids = ['2026-08-01', '2026-08-15', '2026-09-01'].map(
    (d) => addMoment(ctx, ctx.a, { happenedOn: d, body: d }).id,
  );
  const dayNumber = daysBetween('1970-01-01', '2026-11-18');
  assert.equal(fromTheLog(ctx).id, ids[dayNumber % 3]);
});

test('fromTheLog ignores removed moments', () => {
  const ctx = world();
  const only = addMoment(ctx, ctx.a, { happenedOn: '2026-08-01', body: 'the only one' }).id;
  assert.equal(fromTheLog(ctx).id, only);
  removeMoment(ctx, ctx.a, only);
  assert.equal(fromTheLog(ctx), null);
});

// ---- the pages ------------------------------------------------------------

test('the page has the add form with today as the date, one h1, and Moments marked current', async () => {
  const ctx = world();
  const res = await get(ctx, 'a', '/moments');
  assert.equal(res.statusCode, 200);
  assert.equal((res.body.match(/<h1[ >]/g) ?? []).length, 1);
  assert.match(res.body, /<a href="\/moments" aria-current="page">Moments<\/a>/);
  assert.match(res.body, /<input id="happened_on" type="date" name="happened_on" value="2026-11-18" max="2026-11-18" required>/);
  assert.ok(res.body.includes(`name="_csrf" value="${ctx.s.a.csrf}"`));
  assert.match(res.body, /No moments yet\. Add the first one above\./);
});

test('adding a moment shows it to both people at once, with the date and the writer', async () => {
  const ctx = world();
  const res = await post(ctx, 'a', '/moments', { happened_on: '2026-11-10', body: 'We found the little cafe' });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/moments');

  for (const who of ['a', 'b']) {
    const page = await get(ctx, who, '/moments');
    assert.ok(page.body.includes('We found the little cafe'));
    assert.match(page.body, /10 November · Ada/);
    assert.match(page.body, /<h2>November 2026<\/h2>/);
  }
});

test('moments are grouped by month, newest month first', async () => {
  const ctx = world();
  await post(ctx, 'a', '/moments', { happened_on: '2026-10-20', body: 'october moment' });
  await post(ctx, 'b', '/moments', { happened_on: '2026-11-12', body: 'november moment' });
  await post(ctx, 'a', '/moments', { happened_on: '2026-09-02', body: 'september moment' });
  const { body } = await get(ctx, 'a', '/moments');
  const at = (s) => body.indexOf(s);
  assert.ok(at('<h2>November 2026</h2>') < at('<h2>October 2026</h2>'));
  assert.ok(at('<h2>October 2026</h2>') < at('<h2>September 2026</h2>'));
  assert.ok(at('november moment') < at('<h2>October 2026</h2>'));
  assert.ok(at('october moment') > at('<h2>October 2026</h2>') && at('october moment') < at('<h2>September 2026</h2>'));
});

test('text is escaped and line breaks are kept', async () => {
  const ctx = world();
  await post(ctx, 'a', '/moments', { body: 'line one\n<script>alert(1)</script> & "q"' });
  const page = await get(ctx, 'b', '/moments');
  assert.equal(page.body.includes('<script>alert'), false);
  assert.ok(page.body.includes('line one<br>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot;'));
});

test('a refused add shows a plain message and keeps what was typed', async () => {
  const ctx = world();
  const cases = [
    [{ body: '   ' }, /Write something first\./],
    [{ body: 'x'.repeat(2001) }, /too long\. Keep it under 2000 characters\./],
    [{ happened_on: '2026-12-25', body: 'christmas' }, /still ahead\. Pick today or earlier\./],
    [{ happened_on: 'soon', body: 'a typed moment' }, /date did not look right/],
  ];
  for (const [fields, message] of cases) {
    const res = await post(ctx, 'a', '/moments', fields);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, message);
    if (fields.body.trim()) assert.ok(res.body.includes(fields.body), 'the typed text is kept');
  }
  assert.equal(listMoments(ctx).length, 0);
});

test('only your own moments have Edit and Remove', async () => {
  const ctx = world();
  const mine = addMoment(ctx, ctx.a, { body: 'ada wrote this' }).id;
  const theirs = addMoment(ctx, ctx.b, { body: 'bo wrote this' }).id;
  const page = await get(ctx, 'a', '/moments');
  assert.ok(page.body.includes(`action="/moments/${mine}/edit"`));
  assert.ok(page.body.includes(`action="/moments/${mine}/remove"`));
  assert.equal(page.body.includes(`/moments/${theirs}/edit`), false);
  assert.equal(page.body.includes(`/moments/${theirs}/remove`), false);
  assert.match(page.body, /<summary class="muted small" aria-label="Edit, [^"]+">Edit<\/summary>/);
  assert.match(page.body, />Remove<\/button>/);
});

test('editing your own moment works; editing the other person\'s is 403 and changes nothing', async () => {
  const ctx = world();
  const id = addMoment(ctx, ctx.a, { happenedOn: '2026-11-01', body: 'original' }).id;

  const denied = await post(ctx, 'b', `/moments/${id}/edit`, { happened_on: '2026-11-02', body: 'hijacked' });
  assert.equal(denied.statusCode, 403);
  assert.match(denied.body, /only the moments you wrote yourself/);
  assert.equal(listMoments(ctx)[0].body, 'original');

  const ok = await post(ctx, 'a', `/moments/${id}/edit`, { happened_on: '2026-11-03', body: 'changed' });
  assert.equal(ok.statusCode, 303);
  const [m] = listMoments(ctx);
  assert.deepEqual([m.body, m.happenedOn], ['changed', '2026-11-03']);
});

test('a refused edit reopens that entry with what was typed', async () => {
  const ctx = world();
  const id = addMoment(ctx, ctx.a, { happenedOn: '2026-11-01', body: 'original' }).id;
  const res = await post(ctx, 'a', `/moments/${id}/edit`, { happened_on: '2026-11-01', body: '   ' });
  assert.equal(res.statusCode, 400);
  assert.match(res.body, /Write something first\./);
  assert.match(res.body, /<details open>/);

  const long = 'y'.repeat(2001);
  const tooLong = await post(ctx, 'a', `/moments/${id}/edit`, { happened_on: '2026-11-01', body: long });
  assert.equal(tooLong.statusCode, 400);
  assert.ok(tooLong.body.includes(long));
  assert.equal(listMoments(ctx)[0].body, 'original');
});

test('removing: author yes, other person 403, unknown or odd ids 404', async () => {
  const ctx = world();
  const id = addMoment(ctx, ctx.a, { body: 'remove me' }).id;

  const denied = await post(ctx, 'b', `/moments/${id}/remove`);
  assert.equal(denied.statusCode, 403);
  assert.equal(listMoments(ctx).length, 1);

  const ok = await post(ctx, 'a', `/moments/${id}/remove`);
  assert.equal(ok.statusCode, 303);
  assert.equal(listMoments(ctx).length, 0);
  assert.equal((await get(ctx, 'b', '/moments')).body.includes('remove me'), false);

  assert.equal((await post(ctx, 'a', `/moments/${id}/remove`)).statusCode, 404);
  assert.equal((await post(ctx, 'a', '/moments/999/remove')).statusCode, 404);
  assert.equal((await post(ctx, 'a', '/moments/abc/remove')).statusCode, 404);
  assert.equal((await post(ctx, 'a', '/moments/abc/edit', { body: 'x' })).statusCode, 404);
  assert.equal((await post(ctx, 'a', '/moments/999/edit', { body: 'x' })).statusCode, 404);
});

test('moment POSTs without the CSRF token are refused', async () => {
  const ctx = world();
  const id = addMoment(ctx, ctx.a, { body: 'mine' }).id;
  for (const url of ['/moments', `/moments/${id}/edit`, `/moments/${id}/remove`]) {
    const res = await ctx.app.inject({ method: 'POST', url, ...form({ body: 'x' }, ctx.s.a.headers) });
    assert.equal(res.statusCode, 403, url);
  }
  assert.equal(listMoments(ctx).length, 1);
  assert.equal(listMoments(ctx)[0].body, 'mine');
});

test('the moments pages need a session', async () => {
  const ctx = world();
  const res = await ctx.app.inject({ method: 'GET', url: '/moments' });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/signin');
});
