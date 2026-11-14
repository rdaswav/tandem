import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { makeAppWithUsers } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

function world() {
  const ctx = makeAppWithUsers();
  ctx.clock.set('2026-11-18T01:00:00Z');
  ctx.s = ctx.login('a');
  return ctx;
}

const SIGNED_IN_PAGES = ['/', '/checkin', '/checkin/past', '/moments', '/ideas', '/agreements', '/agreements/earlier', '/talks'];

test('every signed-in page has the five-link bar, with Agree for Agreements and its full name kept', async () => {
  const ctx = world();
  for (const url of SIGNED_IN_PAGES) {
    const res = await ctx.app.inject({ method: 'GET', url, headers: ctx.s.headers });
    assert.equal(res.statusCode, 200, url);
    const bar = /<nav class="bottom-bar" aria-label="Main">([\s\S]*?)<\/nav>/.exec(res.body)?.[1];
    assert.ok(bar, `${url}: the bar`);
    const labels = [...bar.matchAll(/>([^<]+)<\/a>/g)].map((m) => m[1]);
    assert.deepEqual(labels, ['Home', 'Check-in', 'Moments', 'Agree', 'Talks'], url);
    assert.match(bar, /<a href="\/agreements" aria-label="Agreements"/, url);
    assert.equal(bar.includes('Agreements<'), false, `${url}: the long word is not shown`);
  }
});

test('Home opens with the mark beside the name, as decoration only', async () => {
  const ctx = world();
  const { body } = await ctx.app.inject({ method: 'GET', url: '/', headers: ctx.s.headers });
  const brand = /<div class="brand">([\s\S]*?)<\/div>/.exec(body)?.[1];
  assert.ok(brand, 'the brand header');
  assert.match(brand, /<svg [^>]*aria-hidden="true"/);
  assert.match(brand, /<h1>Tandem<\/h1>/);
  assert.equal((body.match(/<h1[ >]/g) ?? []).length, 1);
  // The mark is the two equal rings with the overlap filled, drawn in the current colour.
  assert.equal((brand.match(/<circle /g) ?? []).length, 2);
  assert.match(brand, /<path d="M60 37\.5A26 26 0 0 1 60 82\.5A26 26 0 0 1 60 37\.5Z" fill="currentColor"\/>/);
  assert.match(brand, /cx="47" cy="60" r="26"/);
  assert.match(brand, /cx="73" cy="60" r="26"/);
  assert.equal(/#[0-9A-Fa-f]{3,8}\b/.test(brand), false, 'no colour value in the mark');
});

test('the tab icon follows light and dark, and both icon sets are served', async () => {
  const ctx = world();
  const { body } = await ctx.app.inject({ method: 'GET', url: '/signin' });
  assert.match(body, /<link rel="icon" href="\/public\/icon-180\.png" type="image\/png" media="\(prefers-color-scheme: light\)">/);
  assert.match(body, /<link rel="icon" href="\/public\/icon-dark-180\.png" type="image\/png" media="\(prefers-color-scheme: dark\)">/);
  assert.match(body, /<link rel="apple-touch-icon" href="\/public\/icon-180\.png">/);
  for (const file of ['icon-180.png', 'icon-512.png', 'icon-dark-180.png', 'icon-dark-512.png']) {
    const res = await ctx.app.inject({ method: 'GET', url: `/public/${file}` });
    assert.equal(res.statusCode, 200, file);
    assert.equal(res.headers['content-type'], 'image/png', file);
    assert.equal(res.rawPayload.subarray(1, 4).toString(), 'PNG', `${file} is a PNG`);
  }
});

// Width, height and the colour of the top left pixel of a PNG written as 8-bit RGB.
function pngInfo(file) {
  const buf = fs.readFileSync(path.join(ROOT, 'public', file));
  const idat = [];
  for (let at = 8; at < buf.length; ) {
    const length = buf.readUInt32BE(at);
    if (buf.subarray(at + 4, at + 8).toString() === 'IDAT') idat.push(buf.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const pixels = zlib.inflateSync(Buffer.concat(idat));
  return { size: [buf.readUInt32BE(16), buf.readUInt32BE(20)], corner: [...pixels.subarray(1, 4)] };
}

test('the icons are full-bleed squares of the right size and colour (the phone rounds the corners)', () => {
  const rose = [0xA6, 0x4B, 0x63];
  const softRose = [0xE8, 0xA0, 0xB2];
  for (const [file, size, colour] of [
    ['icon-180.png', 180, rose],
    ['icon-512.png', 512, rose],
    ['icon-dark-180.png', 180, softRose],
    ['icon-dark-512.png', 512, softRose],
  ]) {
    const info = pngInfo(file);
    assert.deepEqual(info.size, [size, size], file);
    assert.deepEqual(info.corner, colour, `${file}: the corner is the square colour, not transparent or rounded away`);
  }
});

test('the manifest colours are the tokens: theme is the light accent, background is the light page colour', () => {
  const tokens = read('public', 'tokens.css');
  const light = tokens.slice(0, tokens.indexOf('@media'));
  const accent = /--accent:\s*(#[0-9A-Fa-f]{6})/.exec(light)[1].toUpperCase();
  const bg = /--bg:\s*(#[0-9A-Fa-f]{6})/.exec(light)[1].toUpperCase();
  const manifest = JSON.parse(read('public', 'manifest.webmanifest'));
  assert.equal(manifest.theme_color.toUpperCase(), accent);
  assert.equal(manifest.background_color.toUpperCase(), bg);
  assert.equal(manifest.name, 'Tandem');
});

test('the palette is the design system\'s, in light and dark', () => {
  const tokens = read('public', 'tokens.css');
  const vars = (css) => Object.fromEntries([...css.matchAll(/--([a-z-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2].toUpperCase()]));
  assert.deepEqual(vars(tokens.slice(0, tokens.indexOf('@media'))), {
    bg: '#FBF6F3', surface: '#FFFFFF', line: '#EBDDD6', text: '#2E2226',
    'text-muted': '#7A6A6C', accent: '#A64B63', 'on-accent': '#FFFFFF',
  });
  assert.deepEqual(vars(tokens.slice(tokens.indexOf('@media'))), {
    bg: '#1A1416', surface: '#251D20', line: '#43353A', text: '#F6EDEA',
    'text-muted': '#B3A2A4', accent: '#E8A0B2', 'on-accent': '#2E1620',
  });
});

test('every class a view writes out is defined in the stylesheet', () => {
  const css = read('public', 'app.css');
  const defined = new Set([...css.matchAll(/\.([a-z][a-z0-9-]*)/gi)].map((m) => m[1]));
  const missing = [];
  for (const file of fs.readdirSync(path.join(ROOT, 'src', 'views')).filter((f) => f.endsWith('.js'))) {
    const source = read('src', 'views', file);
    // Only fully written-out class attributes; ones built from a value are skipped.
    for (const m of source.matchAll(/class="([^"$`{}]*)"/g)) {
      for (const name of m[1].split(/\s+/).filter(Boolean)) {
        if (!defined.has(name)) missing.push(`${file}: ${name}`);
      }
    }
    // The pieces of the button style that views build up: btn, btn-primary, btn-text, btn-quiet, pad.
    for (const m of source.matchAll(/'(btn-[a-z]+)'/g)) {
      if (!defined.has(m[1])) missing.push(`${file}: ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('the stylesheet carries no colour of its own and no shadows', () => {
  const css = read('public', 'app.css');
  assert.doesNotMatch(css, /#[0-9A-Fa-f]{3,8}\b|rgba?\(|hsla?\(/);
  assert.doesNotMatch(css, /box-shadow|text-shadow/);
});

test('buttons and fields are at least 44px high', () => {
  const css = read('public', 'app.css');
  const block = (selector) => new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*\\}`).exec(css)?.[0] ?? '';
  for (const selector of ['.btn', '.link-action', '.tabs a', 'summary']) {
    assert.match(block(selector), /min-height:\s*44px/, selector);
  }
  assert.match(css, /input\[type="text"\][\s\S]*?min-height:\s*44px/);
  assert.match(block('.bottom-bar a'), /min-height:\s*52px/);
});
