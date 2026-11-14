import { html } from './html.js';
import { page } from './layout.js';
import { momentTabs } from './moments.js';

function openCard(idea, { user, csrf }) {
  return html`<div class="card">
<p>${idea.body}</p>
<p class="muted small">${idea.authorName}</p>
<div class="inline">
<form method="post" action="/ideas/${idea.id}/done">
<input type="hidden" name="_csrf" value="${csrf}">
<button class="btn" type="submit">Done</button>
</form>
${
  idea.authorId === user.id
    ? html`<form method="post" action="/ideas/${idea.id}/remove">
<input type="hidden" name="_csrf" value="${csrf}">
<button class="btn btn-quiet pad" type="submit">Remove</button>
</form>`
    : ''
}
</div>
</div>`;
}

// A done idea has no controls, only a way to write down how it went.
function doneCard(idea) {
  return html`<div class="card">
<p class="muted">${idea.body}</p>
<p class="muted small">${idea.authorName}</p>
<p class="small"><a href="/moments#new-moment">Add a moment about it</a></p>
</div>`;
}

// ideas: { open, done } as returned by listIdeas.
export function ideasPage({ user, csrf, ideas, maxLength, error = null, addValue = '' }) {
  return page({
    title: 'Ideas',
    user,
    current: 'moments',
    body: html`<h1>Ideas</h1>
${momentTabs('ideas')}
${error ? html`<p class="message" role="alert">${error}</p>` : ''}
<h2>Add an idea</h2>
<form class="card" method="post" action="/ideas">
<input type="hidden" name="_csrf" value="${csrf}">
<div class="field">
<label for="idea">Something we could do together</label>
<input id="idea" type="text" name="body" value="${addValue}" maxlength="${maxLength}" autocomplete="off">
</div>
<button class="btn btn-primary" type="submit">Add</button>
</form>
${
  ideas.open.length === 0
    ? html`<p class="muted">No ideas yet. Add the first one above.</p>`
    : html`<h2>To try</h2>${ideas.open.map((i) => openCard(i, { user, csrf }))}`
}
${ideas.done.length > 0 ? html`<h2>Done</h2>${ideas.done.map(doneCard)}` : ''}`,
  });
}
