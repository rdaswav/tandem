import { html } from './html.js';
import { page } from './layout.js';

// users: [{ id, displayName }] who have finished setting up.
export function signInPage({ users, error = null, selectedId = null }) {
  if (users.length === 0) {
    return page({
      title: 'Sign in',
      body: html`<h1>Sign in</h1><p>Nobody has finished setting up yet. Open the setup link you were given.</p>`,
    });
  }
  return page({
    title: 'Sign in',
    body: html`<h1>Sign in</h1>
${error ? html`<p class="message" role="alert">${error}</p>` : ''}
<form method="post" action="/signin">
<fieldset>
<legend>Who is signing in?</legend>
${users.map(
  (u) => html`<label class="choice"><input type="radio" name="user" value="${u.id}" required${String(u.id) === String(selectedId) ? ' checked' : ''}> ${u.displayName}</label>`,
)}
</fieldset>
<div class="field">
<label for="passphrase">Passphrase</label>
<input id="passphrase" name="passphrase" type="password" autocomplete="current-password" required>
</div>
<button class="btn btn-primary" type="submit">Sign in</button>
</form>`,
  });
}

export function setupPage({ token, error = null }) {
  return page({
    title: 'Choose a passphrase',
    body: html`<h1>Choose a passphrase</h1>
<p>Choose a passphrase only you know. At least 8 characters.</p>
${error ? html`<p class="message" role="alert">${error}</p>` : ''}
<form method="post" action="/setup/${encodeURIComponent(token)}">
<div class="field">
<label for="passphrase">Passphrase</label>
<input id="passphrase" name="passphrase" type="password" autocomplete="new-password" minlength="8" required>
</div>
<div class="field">
<label for="confirm">Type it again</label>
<input id="confirm" name="confirm" type="password" autocomplete="new-password" minlength="8" required>
</div>
<button class="btn btn-primary" type="submit">Save passphrase</button>
</form>`,
  });
}
