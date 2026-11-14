import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listEarlier, listOpen } from '../src/core/agreements.js';
import { activeTalk, applyAction, getTalk, listTalks, proposeTalk } from '../src/core/talks.js';
import { form, makeAppWithUsers } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

const heading = (body) => /<h1>([\s\S]*?)<\/h1>/.exec(body)?.[1];
const mainText = (body) =>
  body.slice(body.indexOf('<main'), body.indexOf('</main>')).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// Takes a talk proposed by `proposer` ('a' or 'b') to a given step of the talk, using the store.
function talkAtStep(ctx, step, proposer = 'a') {
  const [p, o] = proposer === 'a' ? [ctx.a, ctx.b] : [ctx.b, ctx.a];
  const { id } = proposeTalk(ctx, p, { topic: 'Weekends' });
  applyAction(ctx, o, id, 'accept');
  applyAction(ctx, p, id, 'start');
  for (let i = 1; i < step; i += 1) applyAction(ctx, o, id, 'advance');
  assert.equal(getTalk(ctx, id).step, step);
  return id;
}

// ---- the list and asking ---------------------------------------------------

test('the Talks page has one h1, Talks current, and the ask form', async () => {
  const ctx = world();
  const res = await get(ctx, 'a', '/talks');
  assert.equal(res.statusCode, 200);
  assert.equal((res.body.match(/<h1[ >]/g) ?? []).length, 1);
  assert.match(res.body, /<h1>Talks<\/h1>/);
  assert.match(res.body, /<a href="\/talks" aria-current="page">Talks<\/a>/);
  assert.match(res.body, /<label for="topic">What would you like to talk about\?<\/label>/);
  assert.match(res.body, /<input id="topic" type="text" name="topic"[^>]*maxlength="140"/);
  assert.match(res.body, /<label for="hope">What I hope for \(optional\)<\/label>/);
  assert.match(res.body, /<textarea id="hope" name="hope"[^>]*maxlength="300"/);
  assert.ok(res.body.includes(`name="_csrf" value="${ctx.s.a.csrf}"`));
  assert.equal(res.body.includes('Earlier'), false);
});

test('asking creates the talk and shows the proposer a waiting page with Withdraw', async () => {
  const ctx = world();
  const res = await post(ctx, 'a', '/talks', { topic: 'Weekends', hope: 'A calmer Sunday' });
  assert.equal(res.statusCode, 303);
  const id = Number(res.headers.location.split('/').pop());
  assert.equal(res.headers.location, `/talks/${id}`);

  const mine = await get(ctx, 'a', res.headers.location);
  assert.match(mine.body, /You asked to talk about: Weekends\. Waiting\./);
  assert.match(mine.body, /What you hope for: A calmer Sunday/);
  assert.ok(mine.body.includes(`action="/talks/${id}/withdraw"`));
  assert.equal(mine.body.includes(`/talks/${id}/accept`), false);
});

test('the other person sees the request with Yes and Not now, and no Withdraw', async () => {
  const ctx = world();
  const id = proposeTalk(ctx, ctx.a, { topic: 'Weekends', hope: 'A calmer Sunday' }).id;
  const theirs = await get(ctx, 'b', `/talks/${id}`);
  assert.match(theirs.body, /Ada would like to talk about: Weekends\./);
  assert.match(theirs.body, /What Ada hopes for: A calmer Sunday/);
  assert.match(theirs.body, /action="\/talks\/\d+\/accept">[\s\S]*Yes, let&#39;s<\/button>/);
  assert.ok(theirs.body.includes(`action="/talks/${id}/not_now"`));
  assert.equal(theirs.body.includes(`/talks/${id}/withdraw`), false);
});

test('while a talk is going the list shows it and offers no new ask form', async () => {
  const ctx = world();
  const id = proposeTalk(ctx, ctx.a, { topic: 'Weekends' }).id;
  const a = await get(ctx, 'a', '/talks');
  assert.match(a.body, /You asked to talk about: Weekends\. Waiting\./);
  assert.ok(a.body.includes(`href="/talks/${id}"`));
  assert.equal(a.body.includes('<form class="card" method="post" action="/talks">'), false);
  const b = await get(ctx, 'b', '/talks');
  assert.match(b.body, /Ada would like to talk about: Weekends\./);
});

test('a refused ask shows a plain message and keeps what was typed', async () => {
  const ctx = world();
  const blank = await post(ctx, 'a', '/talks', { topic: '  ', hope: 'still here' });
  assert.equal(blank.statusCode, 400);
  assert.match(blank.body, /Write what you would like to talk about first\./);
  assert.ok(blank.body.includes('still here'));

  const longTopic = 't'.repeat(141);
  const tooLong = await post(ctx, 'a', '/talks', { topic: longTopic });
  assert.equal(tooLong.statusCode, 400);
  assert.match(tooLong.body, /too long\. Keep it under 140 characters\./);
  assert.ok(tooLong.body.includes(longTopic));

  const longHope = await post(ctx, 'a', '/talks', { topic: 'Fine', hope: 'h'.repeat(301) });
  assert.equal(longHope.statusCode, 400);
  assert.match(longHope.body, /too long\. Keep it under 300 characters\./);
  assert.equal(listTalks(ctx).length, 0);
});

test('a second ask while a talk is going is refused', async () => {
  const ctx = world();
  proposeTalk(ctx, ctx.a, { topic: 'First' });
  const res = await post(ctx, 'b', '/talks', { topic: 'Second' });
  assert.equal(res.statusCode, 400);
  assert.match(res.body, /There is a talk going already/);
  assert.equal(listTalks(ctx).length, 1);
});

test('topic and hope are escaped', async () => {
  const ctx = world();
  const id = proposeTalk(ctx, ctx.a, { topic: '<script>alert(1)</script> & "q"', hope: '<b>hope</b>' }).id;
  for (const who of ['a', 'b']) {
    const page = await get(ctx, who, `/talks/${id}`);
    assert.equal(page.body.includes('<script>alert'), false);
    assert.equal(page.body.includes('<b>hope'), false);
    assert.ok(page.body.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot;'));
  }
});

// ---- a whole talk, through the pages ---------------------------------------

async function walk(proposer) {
  const ctx = world();
  const [first, second] = proposer === 'a' ? ['Ada', 'Bo'] : ['Bo', 'Ada'];
  const other = proposer === 'a' ? 'b' : 'a';

  const asked = await post(ctx, proposer, '/talks', { topic: 'Weekends', hope: 'A calmer Sunday' });
  const url = asked.headers.location;
  assert.equal((await post(ctx, other, `${url}/accept`)).statusCode, 303);
  assert.match((await get(ctx, proposer, url)).body, /<h1>Ready when you are<\/h1>/);
  assert.equal((await post(ctx, proposer, `${url}/start`)).statusCode, 303);

  const expected = [
    ['Before you start', /One person talks at a time/],
    [`${first} talks. ${second} listens.`, /Say what is on your mind, from your own side\. Take your time\./],
    [`${second} says back what they heard.`, new RegExp(`Not a reply yet\\. Only what you heard\\. ${first} says if it is right\\.`)],
    [`${second} talks. ${first} listens.`, /Say what is on your mind, from your own side\./],
    [`${first} says back what they heard.`, new RegExp(`Only what you heard\\. ${second} says if it is right\\.`)],
    ['What we each need', /Each say one thing you need from here\./],
    ['Agreements', /Write down anything you have both agreed\. It is fine to agree on nothing yet\./],
  ];

  for (let step = 1; step <= 7; step += 1) {
    for (const who of ['a', 'b']) {
      const page = await get(ctx, who, url);
      assert.equal(heading(page.body), expected[step - 1][0], `step ${step} for ${who}`);
      assert.match(page.body, expected[step - 1][1], `step ${step} text`);
      assert.match(page.body, new RegExp(`Talk: Weekends · Step ${step} of 7`));
    }
    const actor = step % 2 === 0 ? 'a' : 'b'; // either person can press Next
    const res = await post(ctx, actor, `${url}/advance`, { step: String(step) });
    assert.equal(res.statusCode, 303);
  }

  // Finish at step 7 went through closing to closed in one press.
  for (const who of ['a', 'b']) {
    const done = await get(ctx, who, url);
    assert.equal(heading(done.body), 'Done');
    assert.match(done.body, /Thank you both\./);
  }
  const talk = getTalk(ctx, Number(url.split('/').pop()));
  assert.equal(talk.state, 'closed');
  assert.equal(talk.firstSpeaker, proposer);
  assert.ok(talk.closedAt);
  assert.equal(activeTalk(ctx), null);
}

test('a whole talk proposed by Ada: the right names in the right order at every step', () => walk('a'));
test('a whole talk proposed by Bo: the order follows the proposer', () => walk('b'));

test('the timer box and script appear only at the two talking steps', async () => {
  for (let step = 1; step <= 7; step += 1) {
    const fresh = world();
    talkAtStep(fresh, step);
    const page = await get(fresh, 'a', `/talks/${activeTalk(fresh).id}`);
    const timed = step === 2 || step === 4;
    assert.equal(page.body.includes('<div id="timer" data-seconds="180"></div>'), timed, `step ${step}`);
    assert.equal(page.body.includes('<script src="/public/talk.js" defer></script>'), timed, `step ${step}`);
    assert.match(page.body, /<button class="btn btn-primary" type="submit">(Next|Finish)<\/button>/);
  }
});

test('the timer script is served, is under 60 lines, stores nothing and sends nothing', async () => {
  const ctx = world();
  const res = await ctx.app.inject({ method: 'GET', url: '/public/talk.js' });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers['content-type']), /javascript/);
  const source = fs.readFileSync(path.join(ROOT, 'public', 'talk.js'), 'utf8');
  assert.ok(source.trimEnd().split('\n').length < 60);
  for (const banned of ['localStorage', 'sessionStorage', 'indexedDB', 'fetch(', 'XMLHttpRequest', 'sendBeacon', 'cookie']) {
    assert.equal(source.includes(banned), false, banned);
  }
});

test('the page is complete without the timer: every control is a plain form', async () => {
  const ctx = world();
  const id = talkAtStep(ctx, 2);
  const page = await get(ctx, 'b', `/talks/${id}`);
  for (const action of ['advance', 'pause', 'end']) {
    assert.ok(page.body.includes(`<form method="post" action="/talks/${id}/${action}">`), action);
  }
  assert.equal((page.body.match(/<script/g) ?? []).length, 1, 'the timer is the only script');
});

// ---- pause and end, at every step, by either person ------------------------

for (const step of [1, 2, 3, 4, 5, 6, 7]) {
  for (const [pauser, resumer] of [['a', 'b'], ['b', 'a']]) {
    test(`step ${step}: ${pauser} can pause, ${resumer} can resume at the same step and end`, async () => {
      const ctx = world();
      const id = talkAtStep(ctx, step);
      const url = `/talks/${id}`;
      const before = heading((await get(ctx, pauser, url)).body);

      assert.equal((await post(ctx, pauser, `${url}/pause`)).statusCode, 303);
      for (const who of ['a', 'b']) {
        const page = await get(ctx, who, url);
        assert.equal(heading(page.body), 'Paused');
        assert.match(page.body, /Come back when you are both ready\./);
        assert.ok(page.body.includes(`action="${url}/resume"`));
        assert.ok(page.body.includes(`action="${url}/end"`));
      }

      assert.equal((await post(ctx, resumer, `${url}/resume`)).statusCode, 303);
      assert.equal(heading((await get(ctx, resumer, url)).body), before, 'same step again');
      assert.equal(getTalk(ctx, id).step, step);

      assert.equal((await post(ctx, resumer, `${url}/end`)).statusCode, 303);
      assert.equal(heading((await get(ctx, pauser, url)).body), 'Done');
      assert.equal(getTalk(ctx, id).state, 'closed');
    });
  }
}

test('a paused talk can be ended without resuming', async () => {
  const ctx = world();
  const id = talkAtStep(ctx, 3);
  await post(ctx, 'a', `/talks/${id}/pause`);
  await post(ctx, 'b', `/talks/${id}/end`);
  assert.equal(getTalk(ctx, id).state, 'closed');
});

// ---- guarding against a second tap and wrong people ------------------------

test('Next only counts on the step that is showing: a second tap does not skip a step', async () => {
  const ctx = world();
  const id = talkAtStep(ctx, 2);
  const url = `/talks/${id}`;
  await post(ctx, 'a', `${url}/advance`, { step: '2' });
  assert.equal(getTalk(ctx, id).step, 3);
  const stale = await post(ctx, 'a', `${url}/advance`, { step: '2' }); // the same page, pressed again
  assert.equal(stale.statusCode, 303);
  assert.equal(stale.headers.location, url);
  assert.equal(getTalk(ctx, id).step, 3);
  await post(ctx, 'b', `${url}/advance`, { step: '3' });
  assert.equal(getTalk(ctx, id).step, 4);
});

test('the proposer cannot accept their own request, and the other person cannot withdraw it', async () => {
  const ctx = world();
  const id = proposeTalk(ctx, ctx.a, { topic: 'Weekends' }).id;
  const own = await post(ctx, 'a', `/talks/${id}/accept`);
  assert.equal(own.statusCode, 403);
  assert.match(own.body, /Only the other person can answer this request\./);
  const notNow = await post(ctx, 'a', `/talks/${id}/not_now`);
  assert.equal(notNow.statusCode, 403);
  const withdraw = await post(ctx, 'b', `/talks/${id}/withdraw`);
  assert.equal(withdraw.statusCode, 403);
  assert.equal(getTalk(ctx, id).state, 'proposed');
});

test('pressing something that no longer applies just shows where the talk is', async () => {
  const ctx = world();
  const id = talkAtStep(ctx, 3);
  const res = await post(ctx, 'a', `/talks/${id}/start`); // already started
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, `/talks/${id}`);
  assert.equal(getTalk(ctx, id).step, 3);
});

test('unknown talks, odd ids and unknown actions are 404', async () => {
  const ctx = world();
  const id = proposeTalk(ctx, ctx.a, { topic: 'Weekends' }).id;
  assert.equal((await get(ctx, 'a', '/talks/999')).statusCode, 404);
  assert.equal((await get(ctx, 'a', '/talks/abc')).statusCode, 404);
  assert.equal((await post(ctx, 'b', '/talks/999/accept')).statusCode, 404);
  assert.equal((await post(ctx, 'b', '/talks/abc/accept')).statusCode, 404);
  assert.equal((await post(ctx, 'b', `/talks/${id}/frobnicate`)).statusCode, 404);
  assert.equal((await post(ctx, 'b', `/talks/${id}/constructor`)).statusCode, 404);
  assert.equal((await post(ctx, 'b', '/talks/999/agreement', { body: 'x', owner: 'both' })).statusCode, 404);
  assert.equal(getTalk(ctx, id).state, 'proposed');
});

// ---- other endings ---------------------------------------------------------

test('Not now sets the talk aside, says so kindly to both, and allows a new ask', async () => {
  const ctx = world();
  const id = proposeTalk(ctx, ctx.a, { topic: 'Weekends' }).id;
  assert.equal((await post(ctx, 'b', `/talks/${id}/not_now`)).statusCode, 303);

  const proposer = await get(ctx, 'a', `/talks/${id}`);
  assert.equal(heading(proposer.body), 'Not now');
  assert.match(proposer.body, /Bo would like to hold this for now\. Either of you can ask again whenever it feels right\./);
  const other = await get(ctx, 'b', `/talks/${id}`);
  assert.match(other.body, /You said not now\. Either of you can ask again whenever it feels right\./);

  const again = await post(ctx, 'a', '/talks', { topic: 'Weekends, another day' });
  assert.equal(again.statusCode, 303);
});

test('a withdrawn request says so', async () => {
  const ctx = world();
  const id = proposeTalk(ctx, ctx.a, { topic: 'Weekends' }).id;
  await post(ctx, 'a', `/talks/${id}/withdraw`);
  for (const who of ['a', 'b']) {
    const page = await get(ctx, who, `/talks/${id}`);
    assert.equal(heading(page.body), 'Withdrawn');
    assert.match(page.body, /This request was withdrawn\./);
  }
});

test('a talk left at closing shows a Finish button and finish closes it', async () => {
  const ctx = world();
  const id = talkAtStep(ctx, 7);
  applyAction(ctx, ctx.a, id, 'advance'); // straight to closing, as an interrupted request would leave it
  assert.equal(getTalk(ctx, id).state, 'closing');
  const page = await get(ctx, 'b', `/talks/${id}`);
  assert.equal(heading(page.body), 'Nearly done');
  assert.ok(page.body.includes(`action="/talks/${id}/finish"`));
  await post(ctx, 'b', `/talks/${id}/finish`);
  assert.equal(getTalk(ctx, id).state, 'closed');
});

// ---- agreements made in the talk -------------------------------------------

test('the agreement form appears at step 7 only', async () => {
  for (let step = 1; step <= 7; step += 1) {
    const ctx = world();
    const id = talkAtStep(ctx, step);
    const page = await get(ctx, 'a', `/talks/${id}`);
    assert.equal(page.body.includes(`action="/talks/${id}/agreement"`), step === 7, `step ${step}`);
  }
});

test('an agreement made at step 7 is saved as from the talk, shown on the page and on Agreements', async () => {
  const ctx = world();
  const id = talkAtStep(ctx, 7);
  const res = await post(ctx, 'b', `/talks/${id}/agreement`, { body: 'Phones away at dinner', owner: 'both' });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, `/talks/${id}`);

  const [g] = listOpen(ctx);
  assert.deepEqual([g.body, g.source, g.sourceId, g.owner, g.createdBy], ['Phones away at dinner', 'talk', id, 'both', ctx.b]);

  for (const who of ['a', 'b']) {
    const page = await get(ctx, who, `/talks/${id}`);
    assert.match(page.body, /<h2>Agreed so far<\/h2>/);
    assert.ok(page.body.includes('Phones away at dinner'));
  }
  assert.ok((await get(ctx, 'a', '/agreements')).body.includes('Phones away at dinner'));

  await post(ctx, 'a', `/talks/${id}/advance`, { step: '7' });
  const closed = await get(ctx, 'a', `/talks/${id}`);
  assert.equal(heading(closed.body), 'Done');
  assert.ok(closed.body.includes('Phones away at dinner'), 'the agreements stay on the finished talk');
});

test('an agreement is refused before step 7, after the talk, or while paused', async () => {
  const ctx = world();
  const early = talkAtStep(ctx, 5);
  const res = await post(ctx, 'a', `/talks/${early}/agreement`, { body: 'Too early', owner: 'both' });
  assert.equal(res.statusCode, 403);
  assert.match(res.body, /Agreements are added in the last step of a talk\./);

  applyAction(ctx, ctx.a, early, 'end');
  assert.equal((await post(ctx, 'a', `/talks/${early}/agreement`, { body: 'Too late', owner: 'both' })).statusCode, 403);
  assert.equal(listOpen(ctx).length, 0);
});

test('a refused agreement shows a plain message and keeps what was typed', async () => {
  const ctx = world();
  const id = talkAtStep(ctx, 7);
  const blank = await post(ctx, 'a', `/talks/${id}/agreement`, { body: '  ', owner: 'b' });
  assert.equal(blank.statusCode, 400);
  assert.match(blank.body, /Write something first\./);
  assert.match(blank.body, /<option value="b" selected>Bo<\/option>/);
  assert.equal(heading(blank.body), 'Agreements');

  const long = 'z'.repeat(301);
  const tooLong = await post(ctx, 'a', `/talks/${id}/agreement`, { body: long, owner: 'a' });
  assert.equal(tooLong.statusCode, 400);
  assert.ok(tooLong.body.includes(long));

  const noOwner = await post(ctx, 'a', `/talks/${id}/agreement`, { body: 'A real one', owner: 'x' });
  assert.match(noOwner.body, /Choose who it is for\./);
  assert.equal(listOpen(ctx).length + listEarlier(ctx).length, 0);
});

// ---- the list afterwards, nothing kept, access -----------------------------

test('earlier talks show the topic and a state word, and no dates or counts', async () => {
  const ctx = world();
  const closed = talkAtStep(ctx, 3);
  applyAction(ctx, ctx.a, closed, 'end');
  const asideId = proposeTalk(ctx, ctx.b, { topic: 'Holidays' }).id;
  applyAction(ctx, ctx.a, asideId, 'not_now');
  const withdrawnId = proposeTalk(ctx, ctx.a, { topic: 'Chores' }).id;
  applyAction(ctx, ctx.a, withdrawnId, 'withdraw');

  const page = await get(ctx, 'b', '/talks');
  assert.match(page.body, /<h2>Earlier<\/h2>/);
  const text = mainText(page.body);
  for (const [topic, word] of [['Chores', 'Withdrawn'], ['Holidays', 'Not now'], ['Weekends', 'Finished']]) {
    assert.ok(text.includes(`${topic} ${word}`), `${topic} ${word}`);
  }
  assert.ok(text.indexOf('Chores') < text.indexOf('Holidays') && text.indexOf('Holidays') < text.indexOf('Weekends'), 'newest first');
  assert.equal(/\d/.test(text), false, 'no digits on the list');
  assert.equal(page.body.includes('<time'), false);
});

test('talk POSTs without the CSRF token are refused and change nothing', async () => {
  const ctx = world();
  const id = proposeTalk(ctx, ctx.a, { topic: 'Weekends' }).id;
  for (const url of ['/talks', `/talks/${id}/accept`, `/talks/${id}/agreement`]) {
    const res = await ctx.app.inject({ method: 'POST', url, ...form({ topic: 'x', body: 'x', owner: 'both' }, ctx.s.b.headers) });
    assert.equal(res.statusCode, 403, url);
  }
  assert.equal(getTalk(ctx, id).state, 'proposed');
  assert.equal(listTalks(ctx).length, 1);
});

test('the talk pages need a session', async () => {
  const ctx = world();
  const id = proposeTalk(ctx, ctx.a, { topic: 'Weekends' }).id;
  for (const url of ['/talks', `/talks/${id}`]) {
    const res = await ctx.app.inject({ method: 'GET', url });
    assert.equal(res.statusCode, 303, url);
    assert.equal(res.headers.location, '/signin', url);
  }
  const posted = await ctx.app.inject({ method: 'POST', url: `/talks/${id}/accept`, ...form({ _csrf: 'x' }) });
  assert.equal(posted.statusCode, 303);
  assert.equal(getTalk(ctx, id).state, 'proposed');
});

test('nothing said in a talk can be kept: the pages post no free text except topic, hope and agreements', async () => {
  const ctx = world();
  const id = talkAtStep(ctx, 2);
  const page = await get(ctx, 'a', `/talks/${id}`);
  assert.equal(page.body.includes('<textarea'), false, 'no box to type what is said');
  assert.equal(page.body.includes('type="text"'), false);
});
