import { html, raw } from './html.js';

const NAV = [
  ['home', '/', 'Home'],
  ['checkin', '/checkin', 'Check-in'],
  ['moments', '/moments', 'Moments'],
  ['agreements', '/agreements', 'Agreements'],
  ['talks', '/talks', 'Talks'],
];

// A whole page as a string. Signed-in pages (user given) get the bottom bar.
// `current` is one of the keys in NAV.
export function page({ title, body, user = null, current = null }) {
  const fullTitle = title && title !== 'Tandem' ? `${title} | Tandem` : 'Tandem';
  const bar = user
    ? html`<nav class="bottom-bar" aria-label="Main">${NAV.map(
        ([key, href, label]) =>
          html`<a href="${href}"${current === key ? raw(' aria-current="page"') : ''}>${label}</a>`,
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
<link rel="icon" href="/public/icon-180.png" type="image/png">
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
