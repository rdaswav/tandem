import { html } from './html.js';
import { page } from './layout.js';

// Placeholder Home: the title and sign out. Later tasks fill in the blocks.
export function homePage({ user, csrf }) {
  return page({
    title: 'Tandem',
    user,
    current: 'home',
    body: html`<h1>Tandem</h1>
<p class="muted small">Signed in as ${user.displayName}.</p>
<form class="foot" method="post" action="/signout">
<input type="hidden" name="_csrf" value="${csrf}">
<button class="btn btn-quiet" type="submit">Sign out</button>
</form>`,
  });
}
