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
<div class="actions">
<button class="btn btn-text" type="submit" formaction="/checkin/save">Save draft</button>
<button class="btn btn-primary" type="submit" formaction="/checkin/submit">I'm done</button>
</div>
<p class="muted small">${otherName} cannot see this until you have both finished.</p>
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

// Open agreements to glance at before reading. Text and who it is for, nothing else.
function lookingBack(openAgreements) {
  if (openAgreements.length === 0) return '';
  return html`<h2>Looking back</h2>
<div class="list">${openAgreements.map(
    (g) => html`<div class="row row-plain row-main"><span>${g.body}</span><span class="muted small">${g.ownerLabel}</span></div>`,
  )}</div>`;
}

// The box at the end of reading together. form: { maxLength, values: { body, owner }, error }.
function weekThing({ csrf, names, form }) {
  const option = (value, label) =>
    html`<option value="${value}"${form.values.owner === value ? ' selected' : ''}>${label}</option>`;
  return html`${form.error ? html`<p class="message" role="alert">${form.error}</p>` : ''}
<form class="card" method="post" action="/checkin/agreement">
<input type="hidden" name="_csrf" value="${csrf}">
<div class="field">
<label for="week-thing">One thing for the week</label>
<input id="week-thing" type="text" name="body" value="${form.values.body}" maxlength="${form.maxLength}" autocomplete="off">
</div>
<div class="field">
<label for="week-owner">Who is it for?</label>
<select id="week-owner" name="owner">
${option('both', 'Both')}
${option('a', names.a)}
${option('b', names.b)}
</select>
</div>
<button class="btn btn-primary" type="submit">Add</button>
</form>`;
}

// Both sets side by side, slot a first. rows holds every answer for the round.
// For this week's round, also pass csrf, openAgreements and agreementForm: they
// add the Looking back list and the One thing for the week box. Earlier weeks
// are read only and leave them out.
export function revealedPage({
  user,
  prompts,
  rows,
  names,
  weekStart = null,
  isPast = false,
  csrf = null,
  openAgreements = [],
  agreementForm = null,
}) {
  const block = (slot, promptId) => html`<p class="muted small">${names[slot]}</p>${answerText(
    rows.find((r) => r.slot === slot && r.promptId === promptId),
  )}`;
  return page({
    title: 'Read together',
    user,
    current: 'checkin',
    body: html`<h1>Read together</h1>
${weekStart ? html`<p class="muted small">Week of ${weekLabel(weekStart)}</p>` : ''}
${isPast ? '' : lookingBack(openAgreements)}
${prompts.map((p) => html`<div class="card"><h2>${p.text}</h2>${block('a', p.id)}${block('b', p.id)}</div>`)}
${agreementForm && !isPast ? weekThing({ csrf, names, form: agreementForm }) : ''}
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
