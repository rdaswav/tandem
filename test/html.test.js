import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, html, raw } from '../src/views/html.js';

test('html escapes the five special characters in interpolated values', () => {
  const out = String(html`<p title="${'"quoted" & \'single\''}">${'<script>alert(1)</script>'}</p>`);
  assert.equal(
    out,
    '<p title="&quot;quoted&quot; &amp; &#39;single&#39;">&lt;script&gt;alert(1)&lt;/script&gt;</p>',
  );
});

test('the static parts of the template are left alone', () => {
  assert.equal(String(html`<b>bold</b>`), '<b>bold</b>');
});

test('nested html results are not escaped twice', () => {
  const inner = html`<em>${'a & b'}</em>`;
  assert.equal(String(html`<p>${inner}</p>`), '<p><em>a &amp; b</em></p>');
});

test('arrays are joined, each item escaped unless it is html', () => {
  const items = ['<x>', html`<i>ok</i>`, 'y'];
  assert.equal(String(html`<p>${items}</p>`), '<p>&lt;x&gt;<i>ok</i>y</p>');
});

test('null, undefined and false render as nothing, zero and true as text', () => {
  assert.equal(String(html`[${null}][${undefined}][${false}][${0}][${true}]`), '[][][][0][true]');
});

test('raw is the only way to skip escaping', () => {
  assert.equal(String(html`${raw('<hr>')}`), '<hr>');
  assert.equal(String(html`${'<hr>'}`), '&lt;hr&gt;');
});

test('escapeHtml handles non-strings', () => {
  assert.equal(escapeHtml(12), '12');
  assert.equal(escapeHtml('&&'), '&amp;&amp;');
});
