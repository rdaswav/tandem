import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addAgreement, dropAgreement } from '../src/core/agreements.js';
import { createUsers } from '../src/core/auth.js';
import { addIdea, markDone } from '../src/core/ideas.js';
import { addMoment } from '../src/core/moments.js';
import { applyAction, proposeTalk } from '../src/core/talks.js';
import { PASSPHRASES, form, makeApp, makeAppWithUsers } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- what to check on every page --------------------------------------------

const BANNED = ['streak', 'score', 'overdue', 'late', 'failed', 'missed', 'reminder', 'should', 'must'];

const decode = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

const visibleText = (html) =>
  decode(
    html
      .replace(/<script[\s\S]*?<\/script>/g, ' ')
      .replace(/<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );

const attr = (attrs, name) => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs)?.[1];

// Returns a list of problems with one page; empty means it is fine.
function problems(body) {
  const found = [];

  if (!/<html lang="en">/.test(body)) found.push('html has no lang');
  if (!/<title>[^<]+<\/title>/.test(body)) found.push('no title');
  if (!/<meta name="viewport" content="width=device-width/.test(body)) found.push('no viewport');
  if ((body.match(/<main[ >]/g) ?? []).length !== 1) found.push('not exactly one main');
  for (const nav of body.matchAll(/<nav\b([^>]*)>/g)) {
    if (!attr(nav[1], 'aria-label')) found.push('a nav has no aria-label');
  }

  // Headings: exactly one h1, first, and no level skipped on the way down.
  const levels = [...body.matchAll(/<h([1-6])[ >]/g)].map((m) => Number(m[1]));
  if (levels.filter((l) => l === 1).length !== 1) found.push(`${levels.filter((l) => l === 1).length} h1`);
  if (levels[0] !== 1) found.push('the first heading is not the h1');
  levels.forEach((l, i) => {
    if (i > 0 && l > levels[i - 1] + 1) found.push(`heading level jumps from ${levels[i - 1]} to ${l}`);
  });

  // Ids are unique, and every label points at something.
  const ids = [...body.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) found.push(`duplicate ids: ${[...new Set(dupes)].join(', ')}`);
  const labels = [...body.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/g)];
  for (const l of labels) {
    const target = attr(l[1], 'for');
    if (target && !ids.includes(target)) found.push(`label for="${target}" points at nothing`);
    if (visibleText(l[2]) === '') found.push('an empty label');
  }

  // Every field has a label: one that points at it, one around it, or an aria-label.
  const spans = labels.map((l) => [l.index, l.index + l[0].length]);
  const forIds = new Set(labels.map((l) => attr(l[1], 'for')).filter(Boolean));
  for (const control of body.matchAll(/<(input|textarea|select)\b([^>]*)>/g)) {
    const attrs = control[2];
    if (attr(attrs, 'type') === 'hidden') continue;
    const id = attr(attrs, 'id');
    const wrapped = spans.some(([from, to]) => control.index > from && control.index < to);
    const named = (id && forIds.has(id)) || wrapped || attr(attrs, 'aria-label');
    if (!named) found.push(`a ${control[1]} (${attr(attrs, 'name') ?? 'unnamed'}) has no label`);
  }

  // Every link, button and summary has a name a screen reader can say.
  for (const el of body.matchAll(/<(a|button|summary)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const name = attr(el[2], 'aria-label') || visibleText(el[3]);
    if (!name) found.push(`a ${el[1]} has no name`);
    const visible = visibleText(el[3]);
    const label = attr(el[2], 'aria-label');
    if (label && visible && !label.toLowerCase().startsWith(visible.toLowerCase())) {
      found.push(`${el[1]} "${visible}" is called "${label}": the name must start with the visible words`);
    }
  }
  for (const a of body.matchAll(/<a\b([^>]*)>/g)) {
    if (attr(a[1], 'href') === undefined) found.push('a link has no href');
  }

  // The same name twice is ambiguous: three Done buttons say nothing about which is which.
  // Buttons and summaries must be unique by name; links may repeat only if they go to the same place.
  const byName = new Map();
  for (const el of body.matchAll(/<(a|button|summary)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const name = attr(el[2], 'aria-label') || visibleText(el[3]);
    const where = el[1] === 'a' ? attr(el[2], 'href') : 'control';
    const seen = byName.get(`${el[1] === 'a' ? 'a' : 'control'}|${name}`);
    if (seen && (el[1] !== 'a' || seen !== where)) found.push(`two ${el[1]}s are both called "${name}"`);
    byName.set(`${el[1] === 'a' ? 'a' : 'control'}|${name}`, where);
  }
  if (/tabindex="[1-9]/.test(body)) found.push('a positive tabindex');
  if (/<img\b/.test(body)) found.push('an image (none expected)');

  // The copy rules, on what a person actually reads.
  const text = visibleText(body);
  if (text.includes('!')) found.push('an exclamation mark');
  if (text.includes('—')) found.push('an em dash');
  for (const word of BANNED) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(text)) found.push(`the word "${word}"`);
  }
  return found;
}

// ---- the pages --------------------------------------------------------------

function world(overrides) {
  const ctx = makeAppWithUsers(overrides);
  ctx.clock.set('2026-11-18T01:00:00Z');
  ctx.a = ctx.users.a.id;
  ctx.b = ctx.users.b.id;
  ctx.s = { a: ctx.login('a'), b: ctx.login('b') };
  return ctx;
}

const get = (ctx, who, url) => ctx.app.inject({ method: 'GET', url, headers: ctx.s[who].headers });
const post = (ctx, who, url, fields = {}) =>
  ctx.app.inject({ method: 'POST', url, ...form({ _csrf: ctx.s[who].csrf, ...fields }, ctx.s[who].headers) });

// Collects [label, body] for one page.
async function collect(list, label, response) {
  assert.ok([200, 400, 401, 403, 429].includes(response.statusCode), `${label}: status ${response.statusCode}`);
  assert.match(String(response.headers['content-type']), /text\/html/, label);
  list.push([label, response.body]);
}

async function everyPage() {
  const list = [];

  // The check-in through all its states, with shared things filled in.
  const ctx = world();
  addMoment(ctx, ctx.a, { happenedOn: '2026-08-01', body: 'Found the little cafe by the river' });
  addMoment(ctx, ctx.b, { happenedOn: '2026-11-12', body: 'Rain all afternoon, so we cooked together' });
  addMoment(ctx, ctx.a, { happenedOn: '2026-11-13', body: 'A long walk after dinner' });
  addIdea(ctx, ctx.a, { body: 'Take the ferry to the island' });
  addAgreement(ctx, ctx.b, { body: 'Book the dentist', owner: 'a' });
  addIdea(ctx, ctx.a, { body: 'Try the new ramen place' });
  markDone(ctx, ctx.a, addIdea(ctx, ctx.b, { body: 'Picnic by the river' }).id);
  addAgreement(ctx, ctx.a, { body: 'Phones away at dinner', owner: 'both' });
  dropAgreement(ctx, ctx.b, addAgreement(ctx, ctx.b, { body: 'Learn to surf', owner: 'b' }).id);

  for (const url of ['/', '/checkin', '/checkin/past', '/moments', '/ideas', '/agreements', '/agreements/earlier', '/talks']) {
    await collect(list, `${url} (nothing written)`, await get(ctx, 'a', url));
  }
  await post(ctx, 'a', '/checkin/save', { appreciated: 'The walk on Sunday morning' });
  await collect(list, '/checkin (draft)', await get(ctx, 'a', '/checkin'));
  await post(ctx, 'a', '/checkin/submit', { appreciated: 'The walk on Sunday morning' });
  await collect(list, '/checkin (done, waiting)', await get(ctx, 'a', '/checkin'));
  await collect(list, '/ (done, waiting)', await get(ctx, 'a', '/'));
  await post(ctx, 'b', '/checkin/submit', { appreciated: 'You took the bins out' });
  await collect(list, '/checkin (read together)', await get(ctx, 'a', '/checkin'));
  await collect(list, '/ (read together)', await get(ctx, 'b', '/'));
  await collect(list, '/moments (Bo)', await get(ctx, 'b', '/moments'));
  await collect(list, '/ideas (Bo)', await get(ctx, 'b', '/ideas'));
  await collect(list, '/agreements (Bo)', await get(ctx, 'b', '/agreements'));
  ctx.clock.set('2026-12-02T01:00:00Z');
  await collect(list, '/checkin/past (with a round)', await get(ctx, 'a', '/checkin/past'));
  await collect(list, '/checkin/2026-11-15 (earlier, read together)', await get(ctx, 'a', '/checkin/2026-11-15'));
  ctx.clock.set('2026-11-18T01:00:00Z');

  // Error states on the same forms.
  await collect(list, 'moments: blank add', await post(ctx, 'a', '/moments', { body: ' ' }));
  const myMoment = ctx.db.prepare('SELECT id FROM moments WHERE author_id = ? LIMIT 1').get(ctx.a).id;
  await collect(list, 'moments: refused edit', await post(ctx, 'a', `/moments/${myMoment}/edit`, { happened_on: '2026-11-01', body: ' ' }));
  await collect(list, 'ideas: blank add', await post(ctx, 'a', '/ideas', { body: ' ' }));
  await collect(list, 'agreements: blank add', await post(ctx, 'a', '/agreements', { body: ' ', owner: 'both' }));
  await collect(list, 'talks: blank ask', await post(ctx, 'a', '/talks', { topic: ' ' }));
  await collect(list, '403: no CSRF token', await ctx.app.inject({ method: 'POST', url: '/moments', ...form({ body: 'x' }, ctx.s.a.headers) }));
  await collect(list, '403: not yours', await post(ctx, 'b', `/moments/${myMoment}/remove`));

  // A round that passed: only the person's own answers.
  const passed = world();
  await post(passed, 'a', '/checkin/submit', { appreciated: 'Only I wrote this' });
  await collect(list, 'checkin: too long', await post(passed, 'b', '/checkin/save', { appreciated: 'x'.repeat(2001) }));
  passed.clock.set('2026-11-25T01:00:00Z');
  await collect(list, '/checkin/2026-11-15 (passed)', await get(passed, 'a', '/checkin/2026-11-15'));
  await collect(list, '/checkin (the new week)', await get(passed, 'a', '/checkin'));

  // The welcome pages, and the signed-out pages with their errors.
  for (const n of [1, 2, 3]) await collect(list, `/welcome?page=${n}`, await get(ctx, 'a', `/welcome?page=${n}`));
  const fresh = makeApp();
  const [a] = createUsers(fresh.db, fresh.clock, 'Ada', 'Bo');
  await collect(list, '/signin (nobody set up)', await fresh.app.inject({ method: 'GET', url: '/signin' }));
  await collect(list, '/setup', await fresh.app.inject({ method: 'GET', url: `/setup/${a.setupToken}` }));
  await collect(list, '/setup: mismatch', await fresh.app.inject({ method: 'POST', url: `/setup/${a.setupToken}`, ...form({ passphrase: 'abcdefgh', confirm: 'abcdefgz' }) }));
  await collect(list, '/setup: too short', await fresh.app.inject({ method: 'POST', url: `/setup/${a.setupToken}`, ...form({ passphrase: 'abc', confirm: 'abc' }) }));
  await collect(list, '/setup: used link', await fresh.app.inject({ method: 'POST', url: '/setup/not-a-link', ...form({ passphrase: 'abcdefgh', confirm: 'abcdefgh' }) }));

  const signedOut = world();
  await collect(list, '/signin', await signedOut.app.inject({ method: 'GET', url: '/signin' }));
  const attempt = (passphrase) =>
    signedOut.app.inject({ method: 'POST', url: '/signin', ...form({ user: String(signedOut.a), passphrase }) });
  await collect(list, '/signin: wrong passphrase', await attempt('wrong one'));
  for (let i = 0; i < 4; i += 1) await attempt(`wrong ${i}`);
  await collect(list, '/signin: locked', await attempt(PASSPHRASES.a));

  // A talk in every state, for both people where it differs.
  const driveTo = (state, proposer = 'a') => {
    const t = world();
    const [p, o] = proposer === 'a' ? [t.a, t.b] : [t.b, t.a];
    const { id } = proposeTalk(t, p, { topic: 'Weekends', hope: 'A calmer Sunday' });
    const steps = {
      proposed: [],
      ready: [[o, 'accept']],
      paused: [[o, 'accept'], [p, 'start'], [p, 'pause']],
      closing: [[o, 'accept'], [p, 'start'], ...Array(7).fill([o, 'advance'])],
      closed: [[o, 'accept'], [p, 'start'], [o, 'end']],
      set_aside: [[o, 'not_now']],
      withdrawn: [[p, 'withdraw']],
    }[state];
    if (state.startsWith('step')) {
      applyAction(t, o, id, 'accept');
      applyAction(t, p, id, 'start');
      for (let i = 1; i < Number(state.slice(4)); i += 1) applyAction(t, o, id, 'advance');
    } else {
      for (const [user, action] of steps) applyAction(t, user, id, action);
    }
    return { t, id };
  };
  for (const state of ['proposed', 'ready', 'step1', 'step2', 'step3', 'step4', 'step5', 'step6', 'step7', 'paused', 'closing', 'closed', 'set_aside', 'withdrawn']) {
    const { t, id } = driveTo(state);
    for (const who of ['a', 'b']) await collect(list, `/talks/${id} (${state}, ${who})`, await get(t, who, `/talks/${id}`));
  }
  const { t: step7, id: step7Id } = driveTo('step7');
  await collect(list, 'talk step 7: blank agreement', await post(step7, 'a', `/talks/${step7Id}/agreement`, { body: ' ', owner: 'both' }));
  await post(step7, 'a', `/talks/${step7Id}/agreement`, { body: 'Phones away at dinner', owner: 'both' });
  await collect(list, 'talk step 7: with an agreement', await get(step7, 'b', `/talks/${step7Id}`));
  const { t: closedTalk } = driveTo('closed');
  await collect(list, '/talks (earlier talks listed)', await get(closedTalk, 'a', '/talks'));
  return list;
}

const pages = await everyPage();

test('the survey covers every kind of page', () => {
  assert.ok(pages.length >= 70, `only ${pages.length} pages were checked`);
  const labels = pages.map(([label]) => label).join('\n');
  for (const expect of ['(draft)', '(done, waiting)', '(read together)', '(passed)', 'closing', 'closed', 'set_aside', 'withdrawn', 'step7', 'locked', 'too long', '403']) {
    assert.ok(labels.includes(expect), `no page for ${expect}`);
  }
});

test('every page has exactly one h1, headings in order, a label on every field and a name on every link and button', () => {
  const report = [];
  for (const [label, body] of pages) {
    for (const issue of problems(body)) report.push(`${label}: ${issue}`);
  }
  assert.deepEqual(report, []);
});

// ---- the stylesheet ---------------------------------------------------------

const css = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');
const rule = (selector) =>
  new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*\\}`).exec(css)?.[0] ?? '';

test('a focus ring shows on every control: 2px, the accent colour, off the edge', () => {
  const focus = rule(':focus-visible');
  assert.match(focus, /outline:\s*2px solid var\(--accent\)/);
  assert.match(focus, /outline-offset:\s*2px/);
  assert.doesNotMatch(css, /outline:\s*(none|0)/, 'nothing turns the ring off');
});

test('a link on its own line is a 44px target, like a button', () => {
  assert.match(rule('p > a:only-child'), /min-height:\s*44px/);
});

test('the layout gives way at large text and narrow screens: rows wrap and the bar does not float over the page', () => {
  for (const selector of ['.actions', '.split', '#timer', '.links', '.links-quiet', '.row-actions', '.inline']) {
    assert.match(rule(selector), /flex-wrap:\s*wrap/, `${selector} wraps`);
  }
  const bar = rule('.bottom-bar');
  assert.match(bar, /flex-wrap:\s*wrap/);
  assert.match(bar, /position:\s*sticky/, 'the bar sticks to the bottom instead of covering the page');
  assert.doesNotMatch(bar, /position:\s*fixed/);
  assert.match(rule('.bottom-bar a'), /min-height:\s*52px/);
  assert.match(rule('body'), /min-height:\s*100dvh/);
  assert.match(css, /overflow-wrap:\s*anywhere/, 'long words in a card wrap instead of overflowing');
});

test('text sizes are in rem so they follow the phone\'s text size setting', () => {
  assert.doesNotMatch(css, /font-size:\s*\d+px/);
  assert.match(rule('html'), /font-size:\s*100%/);
});
