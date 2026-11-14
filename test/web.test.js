import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { completeSetup, createUsers, sessionFromCookie } from '../src/core/auth.js';
import { COOKIE_NAME } from '../src/routes/auth.js';
import { PASSPHRASES, form, makeApp, makeAppWithUsers } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- the guard ------------------------------------------------------------

// Every route in Architecture section 7 that needs a session, plus a path
// that does not exist. None of them may answer without a session.
const PRIVATE_GETS = [
  '/', '/welcome', '/checkin', '/checkin/past', '/checkin/2026-11-15', '/moments', '/ideas',
  '/agreements', '/agreements/earlier', '/talks', '/talks/1', '/export.json', '/does-not-exist',
  '/public/../checkin',
];
const PRIVATE_POSTS = [
  '/signout', '/welcome/done', '/checkin/save', '/checkin/submit', '/moments', '/moments/1/edit',
  '/moments/1/remove', '/ideas', '/ideas/1/done', '/ideas/1/remove', '/agreements',
  '/agreements/1/done', '/agreements/1/drop', '/talks', '/talks/1/accept',
];

for (const url of PRIVATE_GETS) {
  test(`GET ${url} redirects to /signin without a session`, async () => {
    const { app } = makeAppWithUsers();
    const res = await app.inject({ method: 'GET', url });
    assert.equal(res.statusCode, 303);
    assert.equal(res.headers.location, '/signin');
  });
}

for (const url of PRIVATE_POSTS) {
  test(`POST ${url} redirects to /signin without a session`, async () => {
    const { app } = makeAppWithUsers();
    const res = await app.inject({ method: 'POST', url, ...form({ _csrf: 'anything' }) });
    assert.equal(res.statusCode, 303);
    assert.equal(res.headers.location, '/signin');
  });
}

test('a cookie that matches no session is the same as no cookie', async () => {
  const { app } = makeAppWithUsers();
  const res = await app.inject({ method: 'GET', url: '/', headers: { cookie: `${COOKIE_NAME}=not-a-real-session` } });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/signin');
});

test('an expired session is refused', async () => {
  const { app, clock, login } = makeAppWithUsers();
  clock.set('2026-11-15T01:00:00Z');
  const s = login('a');
  assert.equal((await app.inject({ method: 'GET', url: '/', headers: s.headers })).statusCode, 200);
  clock.set('2027-02-14T01:00:00Z');
  const res = await app.inject({ method: 'GET', url: '/', headers: s.headers });
  assert.equal(res.statusCode, 303);
});

test('the public routes work without a session', async () => {
  const { app } = makeAppWithUsers();
  const cases = [
    ['/healthz', 'application/json'],
    ['/signin', 'text/html'],
    ['/setup/some-token', 'text/html'],
    ['/public/tokens.css', 'text/css'],
    ['/public/app.css', 'text/css'],
    ['/public/manifest.webmanifest', 'application/manifest+json'],
    ['/public/icon-180.png', 'image/png'],
    ['/public/icon-512.png', 'image/png'],
  ];
  for (const [url, type] of cases) {
    const res = await app.inject({ method: 'GET', url });
    assert.equal(res.statusCode, 200, url);
    assert.ok(String(res.headers['content-type']).startsWith(type), `${url}: ${res.headers['content-type']}`);
  }
});

test('a signed-in user gets 404 for a path that does not exist', async () => {
  const { app, login } = makeAppWithUsers();
  const res = await app.inject({ method: 'GET', url: '/does-not-exist', headers: login('a').headers });
  assert.equal(res.statusCode, 404);
});

// ---- CSRF -----------------------------------------------------------------

test('a POST without a CSRF token gets 403 and changes nothing', async () => {
  const { app, db, clock, login } = makeAppWithUsers();
  const s = login('a');
  const noBody = await app.inject({ method: 'POST', url: '/signout', headers: s.headers });
  assert.equal(noBody.statusCode, 403);
  const emptyForm = await app.inject({ method: 'POST', url: '/signout', ...form({}, s.headers) });
  assert.equal(emptyForm.statusCode, 403);
  assert.ok(sessionFromCookie(db, clock, s.cookieValue), 'the session must still be there');
});

test('a POST with a wrong or another session\'s CSRF token gets 403', async () => {
  const { app, db, clock, login } = makeAppWithUsers();
  const a = login('a');
  const b = login('b');
  for (const token of ['wrong', a.csrf + 'x', b.csrf]) {
    const res = await app.inject({ method: 'POST', url: '/signout', ...form({ _csrf: token }, a.headers) });
    assert.equal(res.statusCode, 403);
  }
  assert.ok(sessionFromCookie(db, clock, a.cookieValue));
});

test('the 403 page says what to do and shows no secret', async () => {
  const { app, login } = makeAppWithUsers();
  const s = login('a');
  const res = await app.inject({ method: 'POST', url: '/signout', headers: s.headers });
  assert.match(res.body, /Go back, reload it and try again/);
  assert.equal(res.body.includes(s.csrf), false);
  assert.equal(res.body.includes(s.cookieValue), false);
});

test('a POST with the right CSRF token goes through', async () => {
  const { app, db, clock, login } = makeAppWithUsers();
  const s = login('a');
  const res = await app.inject({ method: 'POST', url: '/signout', ...form({ _csrf: s.csrf }, s.headers) });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/signin');
  assert.equal(sessionFromCookie(db, clock, s.cookieValue), null);
  assert.match(String(res.headers['set-cookie']), new RegExp(`${COOKIE_NAME}=;`));
  const after = await app.inject({ method: 'GET', url: '/', headers: s.headers });
  assert.equal(after.statusCode, 303);
});

// ---- headers --------------------------------------------------------------

test('security headers are on every kind of response', async () => {
  const { app, login } = makeAppWithUsers();
  const s = login('a');
  const requests = [
    { method: 'GET', url: '/healthz' },
    { method: 'GET', url: '/signin' },
    { method: 'GET', url: '/public/app.css' },
    { method: 'GET', url: '/' , headers: s.headers },
    { method: 'GET', url: '/checkin' }, // a redirect
    { method: 'GET', url: '/does-not-exist', headers: s.headers }, // a 404
  ];
  for (const req of requests) {
    const res = await app.inject(req);
    const label = `${req.url} (${res.statusCode})`;
    assert.equal(res.headers['content-security-policy'], "default-src 'self'; frame-ancestors 'none'", label);
    assert.equal(res.headers['referrer-policy'], 'no-referrer', label);
    assert.equal(res.headers['x-content-type-options'], 'nosniff', label);
  }
});

test('HTML pages are never cached', async () => {
  const { app, login } = makeAppWithUsers();
  for (const [url, headers] of [['/signin', {}], ['/', login('a').headers], ['/setup/x', {}]]) {
    const res = await app.inject({ method: 'GET', url, headers });
    assert.equal(res.headers['cache-control'], 'no-store', url);
  }
});

// ---- sign in --------------------------------------------------------------

test('sign in page lists both names; wrong passphrase gives the plain message and no cookie', async () => {
  const { app, users } = makeAppWithUsers();
  const page = await app.inject({ method: 'GET', url: '/signin' });
  assert.match(page.body, />\s*Ada</);
  assert.match(page.body, />\s*Bo</);

  const res = await app.inject({
    method: 'POST',
    url: '/signin',
    ...form({ user: String(users.a.id), passphrase: 'not the passphrase' }),
  });
  assert.equal(res.statusCode, 401);
  assert.match(res.body, /That did not match\. Try again\./);
  assert.equal(res.headers['set-cookie'], undefined);
  assert.equal(res.body.includes('not the passphrase'), false);
});

test('sign in with the right passphrase sets the cookie and opens Home', async () => {
  const { app, users } = makeAppWithUsers();
  const res = await app.inject({
    method: 'POST',
    url: '/signin',
    ...form({ user: String(users.a.id), passphrase: PASSPHRASES.a }),
  });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/');

  const cookie = String(res.headers['set-cookie']);
  assert.match(cookie, new RegExp(`^${COOKIE_NAME}=[A-Za-z0-9_-]{40,};`));
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=7776000/);
  assert.doesNotMatch(cookie, /Secure/i);

  const value = cookie.split(';')[0];
  const home = await app.inject({ method: 'GET', url: '/', headers: { cookie: value } });
  assert.equal(home.statusCode, 200);
  assert.match(home.body, /Signed in as Ada\./);
  assert.equal(home.body.includes(value.split('=')[1]), false, 'the cookie value must not be in the page');

  const again = await app.inject({ method: 'GET', url: '/signin', headers: { cookie: value } });
  assert.equal(again.statusCode, 303);
  assert.equal(again.headers.location, '/');
});

test('an unknown user id is treated as a wrong passphrase', async () => {
  const { app } = makeAppWithUsers();
  const res = await app.inject({ method: 'POST', url: '/signin', ...form({ user: '999', passphrase: PASSPHRASES.a }) });
  assert.equal(res.statusCode, 401);
  const none = await app.inject({ method: 'POST', url: '/signin', ...form({}) });
  assert.equal(none.statusCode, 401);
});

test('five wrong tries lock sign in, even for the right passphrase', async () => {
  const { app, users } = makeAppWithUsers();
  for (let i = 0; i < 5; i += 1) {
    const res = await app.inject({
      method: 'POST',
      url: '/signin',
      ...form({ user: String(users.a.id), passphrase: `wrong ${i}` }),
    });
    assert.equal(res.statusCode, 401);
  }
  const locked = await app.inject({
    method: 'POST',
    url: '/signin',
    ...form({ user: String(users.a.id), passphrase: PASSPHRASES.a }),
  });
  assert.equal(locked.statusCode, 429);
  assert.match(locked.body, /Too many tries\. Wait ten minutes\./);
  assert.equal(locked.headers['retry-after'], '600');
  assert.equal(locked.headers['set-cookie'], undefined);
});

// ---- setup links ----------------------------------------------------------

test('the setup link flow: mismatch, too short, success, then it is used up', async () => {
  const { app, db, clock } = makeApp();
  const [a] = createUsers(db, clock, 'Ada', 'Bo');
  const url = `/setup/${a.setupToken}`;

  const page = await app.inject({ method: 'GET', url });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /Choose a passphrase only you know\. At least 8 characters\./);

  const mismatch = await app.inject({ method: 'POST', url, ...form({ passphrase: 'abcdefgh', confirm: 'abcdefgz' }) });
  assert.equal(mismatch.statusCode, 400);
  assert.match(mismatch.body, /The two did not match\. Try again\./);

  const short = await app.inject({ method: 'POST', url, ...form({ passphrase: 'abc', confirm: 'abc' }) });
  assert.equal(short.statusCode, 400);
  assert.match(short.body, /at least 8 characters/);
  assert.equal(short.body.includes('abc"'), false, 'the passphrase must not be echoed');

  const ok = await app.inject({ method: 'POST', url, ...form({ passphrase: PASSPHRASES.a, confirm: PASSPHRASES.a }) });
  assert.equal(ok.statusCode, 303);
  assert.equal(ok.headers.location, '/');
  const cookie = String(ok.headers['set-cookie']).split(';')[0];
  const home = await app.inject({ method: 'GET', url: '/', headers: { cookie } });
  assert.equal(home.statusCode, 200);

  const reuse = await app.inject({ method: 'POST', url, ...form({ passphrase: 'another phrase', confirm: 'another phrase' }) });
  assert.equal(reuse.statusCode, 400);
  assert.match(reuse.body, /already been used or is not valid/);
});

test('sign in shows only people who have finished setting up', async () => {
  const { app, db, clock } = makeApp();
  const none = await app.inject({ method: 'GET', url: '/signin' });
  assert.match(none.body, /Nobody has finished setting up yet/);

  const [a] = createUsers(db, clock, 'Ada', 'Bo');
  completeSetup(db, clock, a.setupToken, PASSPHRASES.a);
  const one = await app.inject({ method: 'GET', url: '/signin' });
  assert.match(one.body, />\s*Ada</);
  assert.doesNotMatch(one.body, />\s*Bo</);
});

// ---- escaping and shape of pages ------------------------------------------

test('a display name with markup is escaped on the sign in page and on Home', async () => {
  const nasty = 'Ada <script>alert("x")</script>';
  const { app, login } = makeAppWithUsers({ names: [nasty, "Bo's & co"] });

  const signin = await app.inject({ method: 'GET', url: '/signin' });
  assert.equal(signin.body.includes('<script>alert'), false);
  assert.ok(signin.body.includes('Ada &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'));
  assert.ok(signin.body.includes('Bo&#39;s &amp; co'));

  const home = await app.inject({ method: 'GET', url: '/', headers: login('a').headers });
  assert.equal(home.body.includes('<script>alert'), false);
  assert.ok(home.body.includes('Signed in as Ada &lt;script&gt;'));
});

test('a setup token in the address cannot break out of the page', async () => {
  const { app } = makeApp();
  const res = await app.inject({ method: 'GET', url: '/setup/%22%3E%3Cscript%3Ex%3C%2Fscript%3E' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.includes('<script>x'), false);
});

test('Home has one h1, the five links in order and Home marked as current', async () => {
  const { app, login } = makeAppWithUsers();
  const s = login('a');
  const res = await app.inject({ method: 'GET', url: '/', headers: s.headers });
  assert.equal(res.statusCode, 200);
  assert.equal((res.body.match(/<h1[ >]/g) ?? []).length, 1);

  const links = [...res.body.matchAll(/<a href="([^"]+)"( aria-current="page")?>([^<]+)<\/a>/g)];
  const bar = links.filter((m) => ['/', '/checkin', '/moments', '/agreements', '/talks'].includes(m[1]));
  assert.deepEqual(bar.map((m) => m[3]), ['Home', 'Check-in', 'Moments', 'Agreements', 'Talks']);
  assert.deepEqual(bar.map((m) => Boolean(m[2])), [true, false, false, false, false]);

  assert.ok(res.body.includes(`name="_csrf" value="${s.csrf}"`), 'the sign out form carries the CSRF token');
  assert.match(res.body, /<link rel="manifest" href="\/public\/manifest\.webmanifest">/);
  assert.match(res.body, /<link rel="apple-touch-icon" href="\/public\/icon-180\.png">/);
  assert.match(res.body, /<meta name="viewport" content="width=device-width, initial-scale=1/);
});

test('signed-out pages have no bottom bar', async () => {
  const { app } = makeAppWithUsers();
  const res = await app.inject({ method: 'GET', url: '/signin' });
  assert.equal(res.body.includes('bottom-bar'), false);
  assert.equal((res.body.match(/<h1[ >]/g) ?? []).length, 1);
});

// ---- tokens and contrast --------------------------------------------------

function luminance(hex) {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function vars(css) {
  return Object.fromEntries([...css.matchAll(/--([a-z-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]]));
}

const css = fs.readFileSync(path.join(ROOT, 'public', 'tokens.css'), 'utf8');
const schemes = { light: vars(css.slice(0, css.indexOf('@media'))), dark: vars(css.slice(css.indexOf('@media'))) };

for (const [scheme, t] of Object.entries(schemes)) {
  test(`tokens.css defines every token in ${scheme}`, () => {
    for (const name of ['bg', 'surface', 'line', 'text', 'text-muted', 'accent', 'on-accent']) {
      assert.match(t[name] ?? '', /^#[0-9A-Fa-f]{6}$/, `${scheme} ${name}`);
    }
  });

  test(`contrast in ${scheme}: accent on bg and on-accent on accent are at least 4.5`, () => {
    assert.ok(contrast(t.accent, t.bg) >= 4.5, `accent on bg ${contrast(t.accent, t.bg).toFixed(2)}`);
    assert.ok(contrast(t['on-accent'], t.accent) >= 4.5, `on-accent on accent ${contrast(t['on-accent'], t.accent).toFixed(2)}`);
  });

  test(`contrast in ${scheme}: text is at least 7 and muted text at least 4.5 on bg and surface`, () => {
    for (const ground of ['bg', 'surface']) {
      assert.ok(contrast(t.text, t[ground]) >= 7, `text on ${ground}`);
      assert.ok(contrast(t['text-muted'], t[ground]) >= 4.5, `text-muted on ${ground}`);
    }
  });
}

test('app.css uses tokens only: no colour values in it', () => {
  const appCss = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');
  assert.doesNotMatch(appCss, /#[0-9A-Fa-f]{3,8}\b|rgba?\(|hsla?\(/);
});
