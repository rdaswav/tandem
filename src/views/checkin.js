import { html, raw } from './html.js';
import { page } from './layout.js';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// '2026-11-15' becomes '15 November 2026'.
export function weekLabel(weekStart) {
  const [y, m, d] = weekStart.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// Text a person wrote, keeping their line breaks.
function multiline(text) {
  return text
    .split('\n')
    .map((line, i) => html`${i > 0 ? raw('<br>') : ''}${line.replace(/\r$/, '')}`);
}

function answerText(row) {
  return row ? html`<p>${multiline(row.body)}</p>` : html`<p class="muted">(left blank)</p>`;
}

const EARLIER = html`<p class="small foot"><a href="/checkin/past">Earlier check-ins</a></p>`;

// The form for writing. values maps prompt id to the text to show.
export function writingPage({ user, csrf, otherName, prompts, values, error = null, maxLength }) {
  const field = (p) => html`<div class="card">
<label for="p-${p.id}">${p.text}</label>
<textarea id="p-${p.id}" name="${p.id}" rows="4" maxlength="${maxLength}">${values[p.id] ?? ''}</textarea>
</div>`;
  const fixed = prompts.filter((p) => !p.rotating);
  const rotating = prompts.filter((p) => p.rotating);
  return page({
    title: 'Check-in',
    user,
    current: 'checkin',
    body: html`<h1>Check-in</h1>
${error ? html`<p class="message" role="alert">${error}</p>` : ''}
<form method="post" action="/checkin/save">
<input type="hidden" name="_csrf" value="${csrf}">
${fixed.map(field)}
${rotating.length > 0 ? html`<h2>This week's question</h2>${rotating.map(field)}` : ''}
<p class="muted small">${otherName} cannot see this until you have both finished.</p>
<div class="field">
<button class="btn" type="submit" formaction="/checkin/save">Save draft</button>
<button class="btn btn-primary" type="submit" formaction="/checkin/submit">I'm done</button>
</div>
</form>
${EARLIER}`,
  });
}

// Your own answers, read only. Used after you are done and for a round that passed.
function ownAnswers(prompts, own) {
  return prompts.map(
    (p) => html`<div class="card"><h2>${p.text}</h2>${answerText(own.find((r) => r.promptId === p.id))}</div>`,
  );
}

export function waitingPage({ user, prompts, own }) {
  return page({
    title: 'Check-in',
    user,
    current: 'checkin',
    body: html`<h1>Check-in</h1>
<p class="message">You are done. This opens when you have both finished.</p>
${ownAnswers(prompts, own)}
${EARLIER}`,
  });
}

// A round that passed without both finishing. Shows only the viewer's own answers.
export function passedPage({ user, prompts, own, weekStart = null, isPast = false }) {
  return page({
    title: 'Check-in',
    user,
    current: 'checkin',
    body: html`<h1>Check-in</h1>
${weekStart ? html`<p class="muted small">Week of ${weekLabel(weekStart)}</p>` : ''}
<p class="message">This one passed.</p>
${ownAnswers(prompts, own)}
${isPast ? html`<p class="small"><a href="/checkin/past">Earlier check-ins</a></p>` : EARLIER}`,
  });
}

// Both sets side by side, slot a first. rows holds every answer for the round.
export function revealedPage({ user, prompts, rows, names, weekStart = null, isPast = false }) {
  const block = (slot, promptId) => html`<p class="muted small">${names[slot]}</p>${answerText(
    rows.find((r) => r.slot === slot && r.promptId === promptId),
  )}`;
  return page({
    title: 'Read together',
    user,
    current: 'checkin',
    body: html`<h1>Read together</h1>
${weekStart ? html`<p class="muted small">Week of ${weekLabel(weekStart)}</p>` : ''}
${prompts.map((p) => html`<div class="card"><h2>${p.text}</h2>${block('a', p.id)}${block('b', p.id)}</div>`)}
${isPast ? html`<p class="small"><a href="/checkin/past">Earlier check-ins</a></p>` : EARLIER}`,
  });
}

// rounds: [{ weekStart, state }] as returned by pastRounds.
export function pastListPage({ user, rounds }) {
  return page({
    title: 'Earlier check-ins',
    user,
    current: 'checkin',
    body: html`<h1>Earlier check-ins</h1>
${
  rounds.length === 0
    ? html`<p>Nothing here yet.</p>`
    : rounds.map(
        (r) => html`<div class="card"><p><a href="/checkin/${r.weekStart}">Week of ${weekLabel(r.weekStart)}</a></p>
<p class="muted small">${r.state === 'revealed' ? 'Read together' : 'This one passed'}</p></div>`,
      )
}
<p class="small"><a href="/checkin">Back to this week</a></p>`,
  });
}
