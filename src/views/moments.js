import { html, raw } from './html.js';
import { page } from './layout.js';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// '2026-11-18' becomes 'November 2026' and '18 November'.
export function monthLabel(date) {
  const [y, m] = date.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function dayLabel(date) {
  const [, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

function multiline(text) {
  return text
    .split('\n')
    .map((line, i) => html`${i > 0 ? raw('<br>') : ''}${line.replace(/\r$/, '')}`);
}

// moments arrive newest first; keep that order inside each month.
function byMonth(moments) {
  const groups = [];
  for (const m of moments) {
    const key = m.happenedOn.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(m);
    else groups.push({ key, label: monthLabel(m.happenedOn), items: [m] });
  }
  return groups;
}

function entry(m, { user, csrf, today, editing, maxLength }) {
  const own = m.authorId === user.id;
  const isEditing = editing?.id === m.id;
  const values = isEditing ? editing.values : { happenedOn: m.happenedOn, body: m.body };
  const controls = own
    ? html`<details${isEditing ? raw(' open') : ''}>
<summary class="muted small">Edit</summary>
<form method="post" action="/moments/${m.id}/edit">
<input type="hidden" name="_csrf" value="${csrf}">
<div class="field">
<label for="d-${m.id}">Date</label>
<input id="d-${m.id}" type="date" name="happened_on" value="${values.happenedOn}" max="${today}" required>
</div>
<div class="field">
<label for="b-${m.id}">What happened</label>
<textarea id="b-${m.id}" name="body" rows="3" maxlength="${maxLength}">${values.body}</textarea>
</div>
<button class="btn" type="submit">Save</button>
</form>
</details>
<form method="post" action="/moments/${m.id}/remove">
<input type="hidden" name="_csrf" value="${csrf}">
<button class="btn btn-quiet" type="submit">Remove</button>
</form>`
    : '';
  return html`<div class="card" id="m-${m.id}">
<p class="muted small">${dayLabel(m.happenedOn)} · ${m.authorName}</p>
<p>${multiline(m.body)}</p>
${controls}
</div>`;
}

// addValues: what to put back in the add form after a refused add.
// editing: { id, values: { happenedOn, body } } to reopen one entry after a refused edit.
export function momentsPage({ user, csrf, today, moments, maxLength, error = null, addValues = null, editing = null }) {
  const add = addValues ?? { happenedOn: today, body: '' };
  const ctx = { user, csrf, today, editing, maxLength };
  return page({
    title: 'Moments',
    user,
    current: 'moments',
    body: html`<h1>Moments</h1>
${error ? html`<p class="message" role="alert">${error}</p>` : ''}
<h2>Add a moment</h2>
<form class="card" method="post" action="/moments">
<input type="hidden" name="_csrf" value="${csrf}">
<div class="field">
<label for="happened_on">Date</label>
<input id="happened_on" type="date" name="happened_on" value="${add.happenedOn || today}" max="${today}" required>
</div>
<div class="field">
<label for="body">A good moment</label>
<textarea id="body" name="body" rows="3" maxlength="${maxLength}">${add.body}</textarea>
</div>
<button class="btn btn-primary" type="submit">Add</button>
</form>
${
  moments.length === 0
    ? html`<p class="muted">No moments yet. Add the first one above.</p>`
    : byMonth(moments).map((g) => html`<h2>${g.label}</h2>${g.items.map((m) => entry(m, ctx))}`)
}`,
  });
}
