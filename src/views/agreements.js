import { html } from './html.js';
import { page } from './layout.js';

// The open list shows the text and who it is for, in one card of rows. No
// dates, no ages, no counts, and every row looks the same however old it is.
function openRow(g, csrf) {
  return html`<div class="row">
<div class="row-main"><span>${g.body}</span><span class="muted small">${g.ownerLabel}</span></div>
<div class="row-actions">
<form method="post" action="/agreements/${g.id}/done">
<input type="hidden" name="_csrf" value="${csrf}">
<button class="btn btn-quiet pad" type="submit">Done</button>
</form>
<form method="post" action="/agreements/${g.id}/drop">
<input type="hidden" name="_csrf" value="${csrf}">
<button class="btn btn-quiet pad" type="submit">Drop</button>
</form>
</div>
</div>`;
}

// names: { a, b } display names by slot. addValues: what to put back after a refused add.
export function agreementsPage({ user, csrf, agreements, names, maxLength, error = null, addValues = null }) {
  const add = addValues ?? { body: '', owner: 'both' };
  const option = (value, label) =>
    html`<option value="${value}"${add.owner === value ? ' selected' : ''}>${label}</option>`;
  return page({
    title: 'Agreements',
    user,
    current: 'agreements',
    body: html`<h1>Agreements</h1>
${error ? html`<p class="message" role="alert">${error}</p>` : ''}
<h2>Add an agreement</h2>
<form class="card" method="post" action="/agreements">
<input type="hidden" name="_csrf" value="${csrf}">
<div class="field">
<label for="agreement">What did you agree?</label>
<input id="agreement" type="text" name="body" value="${add.body}" maxlength="${maxLength}" autocomplete="off">
</div>
<div class="field">
<label for="owner">Who is it for?</label>
<select id="owner" name="owner">
${option('both', 'Both')}
${option('a', names.a)}
${option('b', names.b)}
</select>
</div>
<button class="btn btn-primary" type="submit">Add</button>
</form>
${
  agreements.length === 0
    ? html`<p class="muted">No agreements yet. Add the first one above.</p>`
    : html`<h2>Open</h2><div class="list">${agreements.map((g) => openRow(g, csrf))}</div>`
}
<p class="small foot"><a href="/agreements/earlier">Earlier</a></p>`,
  });
}

// Done and dropped agreements: the text, who it was for and the state word. Nothing else.
export function earlierPage({ user, agreements }) {
  return page({
    title: 'Earlier agreements',
    user,
    current: 'agreements',
    body: html`<h1>Earlier agreements</h1>
${
  agreements.length === 0
    ? html`<p class="muted">Nothing here yet.</p>`
    : html`<div class="list">${agreements.map(
        (g) => html`<div class="row row-plain row-main"><span class="muted">${g.body}</span><span class="muted small">${g.ownerLabel} · ${g.state === 'done' ? 'Done' : 'Dropped'}</span></div>`,
      )}</div>`
}
<p class="small"><a href="/agreements">Back to agreements</a></p>`,
  });
}
