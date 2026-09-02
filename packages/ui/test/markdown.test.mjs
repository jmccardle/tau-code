/**
 * Tests for the Markdown renderer, against strings a model actually produces.
 *
 * These render to a STRING with `react-dom/server` and assert on it, which is
 * the one place in this repo where HTML text is the thing under test. That is
 * deliberate: the claims worth pinning are about what does and does not become
 * an element -- a `<script>` in the model's answer, tau's own `<attachment>`
 * block -- and those are claims about the output, not about a React tree.
 *
 *   node --test packages/ui/test/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../dist/markdown.js';

const render = (text) => renderToStaticMarkup(React.createElement(Markdown, { text }));

test('prose becomes elements, not escaped text', () => {
  const html = render('A **bold** word and `code`.');
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
});

test('a fenced block is a code inside a pre, which is what the stylesheet keys on', () => {
  const html = render('```python\nprint(1)\n```');
  assert.match(html, /<pre class="tau-md-pre"><code[^>]*>print\(1\)/);
});

test('inline code has no pre parent, so the two are distinguishable without a heuristic', () => {
  const html = render('the `x` value');
  assert.doesNotMatch(html, /<pre/);
  assert.match(html, /<code>x<\/code>/);
});

test('a GFM table renders, and inside its own scroll container', () => {
  const html = render('| a | b |\n|---|---|\n| 1 | 2 |');
  assert.match(html, /<div class="tau-md-tablewrap"><table>/);
  assert.match(html, /<th>a<\/th>/);
});

/*
 * The two that matter most. Both are about NOT doing something.
 */

test('raw HTML is shown as the characters the model wrote, never as an element', () => {
  const html = render('before <script>alert(1)</script> after');
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /&lt;script&gt;/);
});

test("tau's attachment block survives rendering", () => {
  // The failure this guards: react-markdown drops `html` nodes when rehype-raw
  // is absent. Dropping this one would erase, from the transcript, the block
  // that says what was actually sent to the model.
  // The quotes come back as `&quot;` because this is serialized HTML. In a
  // browser that IS the character the model wrote, which is the claim.
  const html = render('read this\n\n<attachment filename="notes.txt">hello</attachment>\n');
  assert.match(html, /&lt;attachment filename=&quot;notes.txt&quot;&gt;/);
  assert.match(html, /hello/);
});

test('a reference block with no content is still visible', () => {
  const html = render('<reference filename="big.bin" size="900000" reason="over the inline limit" />');
  assert.match(html, /&lt;reference filename=&quot;big.bin&quot;/);
  assert.match(html, /over the inline limit/);
});

test('a remote image is a link, because the webview CSP will not load it', () => {
  const html = render('![a diagram](https://example.com/d.png)');
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /href="https:\/\/example.com\/d.png"/);
  assert.match(html, /a diagram/);
});

test('a javascript: link is not rendered as a live href', () => {
  const html = render('[click](javascript:alert(1))');
  assert.doesNotMatch(html, /href="javascript:/);
});

test('an unclosed fence renders as a code block rather than failing', () => {
  // Every streamed message passes through this state on its way to being
  // finished, so it is the common case and not an edge one.
  const html = render('here is the fix:\n\n```js\nconst a = 1;');
  assert.match(html, /<pre class="tau-md-pre">/);
  assert.match(html, /const a = 1;/);
});

test('plain text with no markup renders unchanged', () => {
  const html = render('just a sentence');
  assert.match(html, /just a sentence/);
});
