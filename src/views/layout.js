import { html, raw } from './html.js';

// [key, address, visible label, full name when the label is shortened].
// The bar is five short text links; "Agree" fits where "Agreements" does not,
// and the full word is kept for screen readers.
const NAV = [
  ['home', '/', 'Home'],
  ['checkin', '/checkin', 'Check-in'],
  ['moments', '/moments', 'Moments'],
  ['agreements', '/agreements', 'Agree', 'Agreements'],
  ['talks', '/talks', 'Talks'],
];

// The Tandem mark: two equal rings, the overlap filled. One colour, from the
// text colour around it, so it follows light and dark.
export const LOGO_MARK = raw(
  '<svg width="36" height="24" viewBox="12 28 96 64" aria-hidden="true" focusable="false">' +
    '<path d="M60 37.5A26 26 0 0 1 60 82.5A26 26 0 0 1 60 37.5Z" fill="currentColor"/>' +
    '<circle cx="47" cy="60" r="26" fill="none" stroke="currentColor" stroke-width="5"/>' +
    '<circle cx="73" cy="60" r="26" fill="none" stroke="currentColor" stroke-width="5"/>' +
    '</svg>',
);

// A whole page as a string. Signed-in pages (user given) get the bottom bar.
// `current` is one of the keys in NAV.
export function page({ title, body, user = null, current = null }) {
  const fullTitle = title && title !== 'Tandem' ? `${title} | Tandem` : 'Tandem';
  const bar = user
    ? html`<nav class="bottom-bar" aria-label="Main">${NAV.map(
        ([key, href, label, full]) =>
          html`<a href="${href}"${full ? html` aria-label="${full}"` : ''}${current === key ? raw(' aria-current="page"') : ''}>${label}</a>`,
      )}</nav>`
    : '';
  const doc = html`<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Tandem">
<title>${fullTitle}</title>
<link rel="manifest" href="/public/manifest.webmanifest">
<link rel="apple-touch-icon" href="/public/icon-180.png">
<link rel="icon" href="/public/icon-180.png" type="image/png" media="(prefers-color-scheme: light)">
<link rel="icon" href="/public/icon-dark-180.png" type="image/png" media="(prefers-color-scheme: dark)">
<link rel="stylesheet" href="/public/tokens.css">
<link rel="stylesheet" href="/public/app.css">
</head>
<body>
<main${user ? raw(' class="with-bar"') : ''}>
${body}
</main>
${bar}
</body>
</html>
`;
  return `<!doctype html>\n${doc}`;
}

// A plain page for something that went wrong. Says what happened and what to do next.
export function messagePage({ title, text, user = null }) {
  return page({
    title,
    user,
    body: html`<h1>${title}</h1><p class="message">${text}</p><p><a href="/">Back to Home</a></p>`,
  });
}
