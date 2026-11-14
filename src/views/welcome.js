import { html } from './html.js';
import { page } from './layout.js';

export const WELCOME_PAGES = 3;

// The words from Visual Design (Welcome). The third page names whoever looks
// after the server; that name comes from configuration, not from this file.
const PAGES = [
  {
    heading: 'Welcome',
    text: () => 'This is a place for the two of you. A weekly check-in, the good moments, help with hard conversations, and the things you agree.',
  },
  {
    heading: 'What stays hidden',
    text: () => "What you write in a check-in stays hidden until you have both finished. Then you read each other's together.",
  },
  {
    heading: 'One more thing',
    text: (owner) =>
      `Good to know: this runs on the home server, which ${owner} looks after. The app keeps your unread answers hidden, but whoever runs a server can technically open its files. If that ever feels wrong, say so.`,
  },
];

// n is 1, 2 or 3. Skip is on every page and so is the way forward; both
// finish through POST /welcome/done, which is the only thing that is saved.
export function welcomePage({ csrf, n, serverOwner }) {
  const { heading, text } = PAGES[n - 1];
  const last = n === WELCOME_PAGES;
  const done = (label, style) => html`<form method="post" action="/welcome/done">
<input type="hidden" name="_csrf" value="${csrf}">
<button class="btn${style ? ` ${style}` : ''}" type="submit">${label}</button>
</form>`;
  return page({
    title: 'Welcome',
    body: html`<p class="muted small">${n} of ${WELCOME_PAGES}</p>
<h1>${heading}</h1>
<p>${text(serverOwner)}</p>
${last ? done('Got it', 'btn-primary') : html`<a class="btn btn-primary" href="/welcome?page=${n + 1}">Next</a>${done('Skip', 'btn-quiet')}`}`,
  });
}
