import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUsers, listUsers } from '../src/core/auth.js';
import { PASSPHRASES, form, makeApp, makeAppWithUsers } from './helpers.js';

// The three pages, exactly as written in Visual Design (Welcome).
const PAGE_1 = 'This is a place for the two of you. A weekly check-in, the good moments, help with hard conversations, and the things you agree.';
const PAGE_2 = "What you write in a check-in stays hidden until you have both finished. Then you read each other's together.";
const page3 = (owner) =>
  `Good to know: this runs on the home server, which ${owner} looks after. The app keeps your unread answers hidden, but whoever runs a server can technically open its files. If that ever feels wrong, say so.`;

// A world where nobody has been welcomed yet.
function fresh(overrides = {}) {
  const ctx = makeAppWithUsers({ welcomed: false, ...overrides });
  ctx.clock.set('2026-11-18T01:00:00Z');
  return ctx;
}

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
const mainText = (body) => words(body.slice(body.indexOf('<main'), body.indexOf('</main>')));
const heading = (body) => /<h1>([\s\S]*?)<\/h1>/.exec(body)?.[1];

// Signs in through the real sign in page and returns the response and a cookie.
async function signInAs(ctx, slot) {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/signin',
    ...form({ user: String(ctx.users[slot].id), passphrase: PASSPHRASES[slot] }),
  });
  const cookie = String(res.headers['set-cookie'] ?? '').split(';')[0];
  return { res, headers: { cookie } };
}

async function csrfOf(ctx, headers) {
  const page = await ctx.app.inject({ method: 'GET', url: '/welcome', headers });
  return /name="_csrf" value="([^"]+)"/.exec(page.body)[1];
}

const getAs = (ctx, headers, url) => ctx.app.inject({ method: 'GET', url, headers });

// ---- when it is shown -------------------------------------------------------

test('someone not yet welcomed is sent to the welcome pages after signing in', async () => {
  const ctx = fresh();
  const { res } = await signInAs(ctx, 'a');
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/welcome');
});

test('someone already welcomed goes straight to Home', async () => {
  const ctx = makeAppWithUsers(); // welcomed by default
  const { res } = await signInAs(ctx, 'a');
  assert.equal(res.headers.location, '/');
});

test('a brand-new person is welcomed straight after choosing a passphrase', async () => {
  const { app, db, clock } = makeApp();
  const [a] = createUsers(db, clock, 'Ada', 'Bo');
  const res = await app.inject({
    method: 'POST',
    url: `/setup/${a.setupToken}`,
    ...form({ passphrase: PASSPHRASES.a, confirm: PASSPHRASES.a }),
  });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/welcome');
});

test('it is shown once per person: each is welcomed on their own', async () => {
  const ctx = fresh();
  const ada = await signInAs(ctx, 'a');
  const csrf = await csrfOf(ctx, ada.headers);
  await ctx.app.inject({ method: 'POST', url: '/welcome/done', ...form({ _csrf: csrf }, ada.headers) });

  assert.equal((await signInAs(ctx, 'a')).res.headers.location, '/', 'Ada has been welcomed');
  assert.equal((await signInAs(ctx, 'b')).res.headers.location, '/welcome', 'Bo has not');
});

test('leaving without finishing shows it again at the next sign in', async () => {
  const ctx = fresh();
  assert.equal((await signInAs(ctx, 'a')).res.headers.location, '/welcome');
  assert.equal((await signInAs(ctx, 'a')).res.headers.location, '/welcome');
});

test('it never blocks the rest of the app: other pages open without finishing', async () => {
  const ctx = fresh();
  const { headers } = await signInAs(ctx, 'a');
  for (const url of ['/', '/checkin', '/moments', '/agreements', '/talks']) {
    assert.equal((await getAs(ctx, headers, url)).statusCode, 200, url);
  }
});

// ---- the three pages --------------------------------------------------------

test('the three pages carry the exact words from the design', async () => {
  const ctx = fresh({ config: { serverOwner: 'Cy' } });
  const { headers } = await signInAs(ctx, 'a');
  const expected = [PAGE_1, PAGE_2, page3('Cy')];
  for (const [i, text] of expected.entries()) {
    const res = await getAs(ctx, headers, `/welcome?page=${i + 1}`);
    assert.equal(res.statusCode, 200);
    assert.ok(mainText(res.body).includes(text), `page ${i + 1}: ${mainText(res.body)}`);
  }
});

test('page one is the default, and bad page numbers show page one', async () => {
  const ctx = fresh();
  const { headers } = await signInAs(ctx, 'a');
  const first = await getAs(ctx, headers, '/welcome');
  assert.ok(mainText(first.body).includes(PAGE_1));
  for (const bad of ['0', '4', '-1', 'abc', '2.5', '', '99999']) {
    const res = await getAs(ctx, headers, `/welcome?page=${bad}`);
    assert.equal(res.statusCode, 200, bad);
    assert.ok(mainText(res.body).includes(PAGE_1), `page=${bad} shows page one`);
  }
});

test('whoever looks after the server comes from the setting, or else the first person', async () => {
  const withSetting = fresh({ config: { serverOwner: 'Cy' } });
  const a = await signInAs(withSetting, 'a');
  assert.ok(mainText((await getAs(withSetting, a.headers, '/welcome?page=3')).body).includes('which Cy looks after'));

  const without = fresh();
  const b = await signInAs(without, 'b');
  const text = mainText((await getAs(without, b.headers, '/welcome?page=3')).body);
  assert.ok(text.includes(page3('Ada')), 'falls back to the first person, whoever is reading');

  const named = fresh({ names: ['<b>Ed</b>', 'Fay'] });
  const e = await signInAs(named, 'b');
  const raw = (await getAs(named, e.headers, '/welcome?page=3')).body;
  assert.equal(raw.includes('<b>Ed'), false, 'the name is escaped');
  assert.ok(mainText(raw).includes('which <b>Ed</b> looks after'));
});

test('each page has one h1, an n of 3 marker, and the right buttons', async () => {
  const ctx = fresh();
  const { headers } = await signInAs(ctx, 'a');
  const headings = ['Welcome', 'What stays hidden', 'One more thing'];
  for (let n = 1; n <= 3; n += 1) {
    const res = await getAs(ctx, headers, `/welcome?page=${n}`);
    assert.equal((res.body.match(/<h1[ >]/g) ?? []).length, 1, `page ${n}`);
    assert.equal(heading(res.body), headings[n - 1]);
    assert.match(res.body, new RegExp(`<p class="muted small">${n} of 3</p>`));
    assert.ok(res.body.includes('action="/welcome/done"'), 'every page can be finished');
    if (n < 3) {
      assert.ok(res.body.includes(`<a class="btn btn-primary" href="/welcome?page=${n + 1}">Next</a>`), `page ${n} Next`);
      assert.match(res.body, />Skip<\/button>/);
      assert.equal(res.body.includes('Got it'), false);
    } else {
      assert.match(res.body, />Got it<\/button>/);
      assert.equal(res.body.includes('>Next<'), false);
      assert.equal(res.body.includes('>Skip<'), false);
    }
  }
});

test('the welcome pages have no bottom bar: they stand on their own', async () => {
  const ctx = fresh();
  const { headers } = await signInAs(ctx, 'a');
  assert.equal((await getAs(ctx, headers, '/welcome')).body.includes('bottom-bar'), false);
});

// ---- finishing and skipping -------------------------------------------------

test('skipping from page one, and finishing at page three, both save it', async () => {
  for (const [slot, label] of [['a', 'skip'], ['b', 'finish']]) {
    const ctx = fresh();
    const { headers } = await signInAs(ctx, slot);
    const csrf = await csrfOf(ctx, headers);
    const url = label === 'skip' ? '/welcome?page=1' : '/welcome?page=3';
    assert.ok((await getAs(ctx, headers, url)).body.includes('action="/welcome/done"'));

    const res = await ctx.app.inject({ method: 'POST', url: '/welcome/done', ...form({ _csrf: csrf }, headers) });
    assert.equal(res.statusCode, 303, label);
    assert.equal(res.headers.location, '/', label);
    const user = listUsers(ctx.db).find((u) => u.slot === slot);
    assert.ok(user.welcomedAt, `${label}: saved`);
    const other = listUsers(ctx.db).find((u) => u.slot !== slot);
    assert.equal(other.welcomedAt, null, `${label}: the other person is not marked`);
  }
});

test('it can be opened again from a small link at the foot of Home, and finishing again keeps the first time', async () => {
  const ctx = fresh();
  const { headers } = await signInAs(ctx, 'a');
  const csrf = await csrfOf(ctx, headers);
  ctx.clock.set('2026-11-18T02:00:00Z');
  await ctx.app.inject({ method: 'POST', url: '/welcome/done', ...form({ _csrf: csrf }, headers) });
  const first = listUsers(ctx.db).find((u) => u.slot === 'a').welcomedAt;
  assert.equal(first, '2026-11-18T02:00:00.000Z');

  const home = await getAs(ctx, headers, '/');
  assert.match(home.body, /<div class="links-quiet">\s*<a href="\/welcome">How this works<\/a>/);
  assert.ok(home.body.indexOf('How this works') > home.body.indexOf('Add a moment'), 'at the foot');
  assert.ok(home.body.indexOf('How this works') < home.body.indexOf('Sign out'));

  assert.equal((await getAs(ctx, headers, '/welcome')).statusCode, 200);
  ctx.clock.set('2026-12-01T00:00:00Z');
  await ctx.app.inject({ method: 'POST', url: '/welcome/done', ...form({ _csrf: csrf }, headers) });
  assert.equal(listUsers(ctx.db).find((u) => u.slot === 'a').welcomedAt, first);
});

// ---- access -----------------------------------------------------------------

test('finishing needs the CSRF token, and without it nothing is saved', async () => {
  const ctx = fresh();
  const { headers } = await signInAs(ctx, 'a');
  const res = await ctx.app.inject({ method: 'POST', url: '/welcome/done', ...form({}, headers) });
  assert.equal(res.statusCode, 403);
  assert.equal(listUsers(ctx.db).find((u) => u.slot === 'a').welcomedAt, null);
});

test('the welcome pages need a session', async () => {
  const ctx = fresh();
  const get = await ctx.app.inject({ method: 'GET', url: '/welcome' });
  assert.equal(get.statusCode, 303);
  assert.equal(get.headers.location, '/signin');
  const post = await ctx.app.inject({ method: 'POST', url: '/welcome/done', ...form({ _csrf: 'x' }) });
  assert.equal(post.statusCode, 303);
  assert.equal(post.headers.location, '/signin');
  assert.equal(listUsers(ctx.db).every((u) => u.welcomedAt === null), true);
});
