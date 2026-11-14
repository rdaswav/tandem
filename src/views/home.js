import { html, raw } from './html.js';
import { page } from './layout.js';
import { dayLabel } from './moments.js';

// What Home says about the viewer's own place in this week's check-in.
// Nothing here depends on what the other person has done.
const CHECKIN_LINES = {
  not_started: 'You have not started.',
  draft: 'You have a draft.',
  waiting: 'You are done. Waiting for both.',
  revealed: 'Ready to read together.',
  passed: 'This one passed.',
};

const LOG_EXCERPT_LENGTH = 160;

function multiline(text) {
  return text
    .split('\n')
    .map((line, i) => html`${i > 0 ? raw('<br>') : ''}${line.replace(/\r$/, '')}`);
}

function checkinBlock(state) {
  return html`<h2>This week</h2>
<div class="card">
<p><strong>Check-in</strong></p>
<p>${CHECKIN_LINES[state] ?? CHECKIN_LINES.not_started}</p>
<a class="btn btn-primary" href="/checkin">Open check-in</a>
</div>`;
}

function button(talk, action, label, csrf, style = '') {
  return html`<form method="post" action="/talks/${talk.id}/${action}">
<input type="hidden" name="_csrf" value="${csrf}">
<button class="btn${style ? ` ${style}` : ''}" type="submit">${label}</button>
</form>`;
}

// A talk that is waiting for an answer, or going. Finished ones are not shown.
function talkBlock(talk, user, csrf) {
  if (!talk) return '';
  let inner;
  if (talk.state === 'proposed') {
    inner =
      talk.proposedBy === user.id
        ? html`<p>You asked to talk about: ${talk.topic}. Waiting.</p>${button(talk, 'withdraw', 'Withdraw', csrf, 'btn-quiet')}`
        : html`<p>${talk.proposerName} would like to talk about: ${talk.topic}.</p>${button(talk, 'accept', "Yes, let's", csrf, 'btn-primary')}${button(talk, 'not_now', 'Not now', csrf, 'btn-quiet')}`;
  } else {
    inner = html`<p>A talk about ${talk.topic} is going.</p><p><a href="/talks/${talk.id}">Open it</a></p>`;
  }
  return html`<h2>Talk</h2><div class="card">${inner}</div>`;
}

// Open agreements: text and who it is for. No dates, ages or counts.
function agreementsBlock(agreements) {
  if (agreements.length === 0) return '';
  return html`<h2>Agreements</h2>${agreements.map(
    (g) => html`<div class="card"><p>${g.body}</p><p class="muted small">${g.ownerLabel}</p></div>`,
  )}`;
}

// One earlier moment, cut short when it is long, with a way to the whole thing.
function fromTheLogBlock(moment) {
  if (!moment) return '';
  const chars = [...moment.body];
  const cut = chars.length > LOG_EXCERPT_LENGTH;
  const shown = cut ? `${chars.slice(0, LOG_EXCERPT_LENGTH).join('').trimEnd()}…` : moment.body;
  return html`<h2>From the log</h2>
<div class="card">
<p class="muted small">${dayLabel(moment.happenedOn)} ${moment.happenedOn.slice(0, 4)} · ${moment.authorName}</p>
<p>${multiline(shown)}</p>
${cut ? html`<p class="small"><a href="/moments#m-${moment.id}">Read the rest</a></p>` : ''}
</div>`;
}

// The blocks come in a fixed order and each one is left out when it has nothing to show.
export function homePage({ user, csrf, checkinState, talk = null, agreements = [], fromLog = null }) {
  return page({
    title: 'Tandem',
    user,
    current: 'home',
    body: html`<h1>Tandem</h1>
<p class="muted small">Signed in as ${user.displayName}.</p>
${checkinBlock(checkinState)}
${talkBlock(talk, user, csrf)}
${agreementsBlock(agreements)}
${fromTheLogBlock(fromLog)}
<p class="foot"><a class="btn" href="/moments#new-moment">Add a moment</a> <a class="btn" href="/ideas">Add an idea</a></p>
<form method="post" action="/signout">
<input type="hidden" name="_csrf" value="${csrf}">
<button class="btn btn-quiet" type="submit">Sign out</button>
</form>`,
  });
}
