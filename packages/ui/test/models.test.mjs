/**
 * The model picker: the daemon's `ModelRecord`s, and which one a cursor runs.
 *
 * A cursor names its model by config NAME (`CursorState.model`), so the active
 * row is found by name and never by matching ids -- the guess the RPC-era
 * picker had to make, because `get_state` reported only an id. What is left to
 * pin is the alias rule and the panel's sentences.
 *
 *   node --test packages/ui/test/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { aliasesOf, modelLabel, recordFor } from '../dist/models.js';
import { ModelPanel } from '../dist/components.js';

// `local-llm` is the point of this fixture: the config NAME and the model ID
// are different strings, which is why a name cannot be inferred from an id.
const MODELS = [
  { name: 'claude-3.5-sonnet', model: { id: 'claude-3-5-sonnet-20241022', provider: 'anthropic', context_window: 128000 }, error: null },
  { name: 'gpt-4o', model: { id: 'gpt-4o', provider: 'openai', context_window: 128000 }, error: null },
  { name: 'local-llm', model: { id: 'qwen38-27B', provider: 'openai', context_window: 128000 }, error: null },
];

test('a name resolves to its record, and a name the config dropped resolves to nothing', () => {
  assert.equal(recordFor(MODELS, 'local-llm')?.model.id, 'qwen38-27B');
  assert.equal(recordFor(MODELS, 'gone'), null);
  assert.equal(recordFor(MODELS, null), null);
});

test('aliases are found by id AND provider', () => {
  const withAlias = [...MODELS, { name: 'fast', model: { id: 'gpt-4o', provider: 'openai', context_window: 1 }, error: null }];
  assert.deepEqual(aliasesOf(withAlias, 'gpt-4o').sort(), ['fast', 'gpt-4o']);
  const otherProvider = [...MODELS, { name: 'azure', model: { id: 'gpt-4o', provider: 'azure', context_window: 1 }, error: null }];
  assert.deepEqual(aliasesOf(otherProvider, 'gpt-4o'), ['gpt-4o']);
});

// An entry τ's config cannot build: listed with its reason, never selectable.
const BROKEN = { name: 'typo', model: null, error: "unknown backend 'opnai' and no base_url" };

test('an entry that does not build has no aliases and is no one\'s alias', () => {
  const models = [...MODELS, BROKEN];
  assert.deepEqual(aliasesOf(models, 'typo'), []);
  assert.deepEqual(aliasesOf(models, 'gpt-4o'), ['gpt-4o']);
});

test('the label pairs provider with id', () => {
  assert.equal(modelLabel(MODELS[2]), 'openai/qwen38-27B');
});

const panel = (props) =>
  renderToStaticMarkup(
    React.createElement(ModelPanel, {
      models: MODELS,
      active: 'local-llm',
      running: false,
      busy: false,
      error: null,
      onClose: () => {},
      onChoose: () => {},
      ...props,
    }),
  );

test('a row shows the config name and the id it resolves to, which differ', () => {
  const html = panel({});
  assert.match(html, /<span class="tau-session-title">local-llm<\/span>/);
  assert.match(html, /openai\/qwen38-27B/);
});

test('exactly the active row is marked, and cannot be clicked', () => {
  const html = panel({});
  const active = html.split('<li>').slice(1).find((row) => row.includes('local-llm'));
  assert.match(active, /tau-session-current/);
  assert.match(active, /disabled/);
  assert.equal(html.split('tau-session-current').length - 1, 1);
});

test('a name the config no longer has is said, and marks nothing', () => {
  const html = panel({ active: 'set-at-startup' });
  assert.match(html, /no longer a name in the daemon/);
  assert.doesNotMatch(html, /tau-session-current/);
});

test('an alias of the running model says switching to it changes nothing', () => {
  const html = panel({
    models: [...MODELS, { name: 'fast', model: { id: 'gpt-4o', provider: 'openai', context_window: 1 }, error: null }],
    active: 'gpt-4o',
  });
  assert.match(html, /fast resolves to the same model/);
});

test('a running turn says when a switch takes effect, and still offers it', () => {
  const html = panel({ running: true });
  assert.match(html, /next turn/);
  assert.equal(html.split('disabled=""').length - 1, 1, 'only the active row is disabled');
});

test('an empty config is a sentence about where models live, not a blank list', () => {
  const html = panel({ models: [] });
  assert.match(html, /declares no models/);
  assert.match(html, /config\.json/);
});

test('an error from τ is shown verbatim', () => {
  const html = panel({ error: "unknown model 'no-such-model'" });
  assert.match(html, /unknown model &#x27;no-such-model&#x27;/);
});

test('an entry that does not build is listed with its reason and cannot be chosen', () => {
  const html = panel({ models: [...MODELS, BROKEN] });
  const row = html.split('<li>').slice(1).find((r) => r.includes('>typo<'));
  assert.match(row, /tau-model-unavailable/);
  assert.match(row, /disabled/);
  assert.match(row, /unavailable — unknown backend &#x27;opnai&#x27; and no base_url/);
});

test('running a name the config no longer builds says why', () => {
  const html = panel({ models: [...MODELS, BROKEN], active: 'typo' });
  assert.match(html, /no longer builds: unknown backend/);
});
