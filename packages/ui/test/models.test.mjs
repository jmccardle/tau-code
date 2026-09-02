/**
 * Tests for reading `get_models`, against the shapes tau actually sends.
 *
 * The claims worth pinning are all about `activeNames`, which exists because
 * `get_models` does NOT flag the active entry. Guessing produces a wrong mark
 * in two cases that a config can reach, and both are tested here.
 *
 *   node --test packages/ui/test/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { activeNames, modelLabel, readActiveModel, readModelRows } from '../dist/models.js';
import { ModelPanel } from '../dist/components.js';

// Copied from a live `get_models` against the repo owner's own config. The
// point of this fixture is `local-llm`: the config NAME and the model ID are
// different strings, which is the whole reason a name cannot be inferred.
const WIRE = [
  { name: 'claude-3.5-sonnet', model: { id: 'claude-3-5-sonnet-20241022', provider: 'anthropic', context_window: 128000 } },
  { name: 'gpt-4o', model: { id: 'gpt-4o', provider: 'openai', context_window: 128000 } },
  { name: 'local-llm', model: { id: 'qwen38-27B', provider: 'openai', context_window: 128000 } },
];

test('a row keeps the name and what it resolved to', () => {
  const rows = readModelRows(WIRE);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[2], { name: 'local-llm', id: 'qwen38-27B', provider: 'openai' });
});

test('an entry with no name is dropped, because set_model could not take it', () => {
  const rows = readModelRows([...WIRE, { model: { id: 'x', provider: 'openai' } }, null, 'nonsense']);
  assert.equal(rows.length, 3);
});

test('an entry with no model record is kept, with nothing invented for it', () => {
  const rows = readModelRows([{ name: 'broken' }]);
  assert.deepEqual(rows, [{ name: 'broken', id: null, provider: null }]);
});

test('the active name is found by id AND provider', () => {
  const rows = readModelRows(WIRE);
  assert.deepEqual(activeNames(rows, { id: 'qwen38-27B', provider: 'openai' }), ['local-llm']);
});

test('the same id under a different provider is a different model', () => {
  // tau's own notes say a cross-provider switch is where an auth error shows
  // up, so the provider is part of what a model is.
  const rows = readModelRows(WIRE);
  assert.deepEqual(activeNames(rows, { id: 'gpt-4o', provider: 'azure' }), []);
});

test('two names aliasing one model both match, so neither is guessed at', () => {
  const rows = readModelRows([
    ...WIRE,
    { name: 'fast', model: { id: 'gpt-4o', provider: 'openai', context_window: 128000 } },
  ]);
  assert.deepEqual(activeNames(rows, { id: 'gpt-4o', provider: 'openai' }), ['gpt-4o', 'fast']);
});

test('an ad-hoc startup model matches nothing, which is the one-way case', () => {
  // `--model openai/some-id` is resolved without a config key, so set_model has
  // no name to switch back to. An empty list is what says so.
  const rows = readModelRows(WIRE);
  assert.deepEqual(activeNames(rows, { id: 'some-id', provider: 'openai' }), []);
});

test('nothing matches when tau reported no running model', () => {
  const rows = readModelRows(WIRE);
  assert.deepEqual(activeNames(rows, null), []);
  assert.deepEqual(activeNames(rows, { id: null, provider: null }), []);
});

test('the active projection is read from get_state and from set_model alike', () => {
  assert.deepEqual(readActiveModel({ id: 'gpt-4o', provider: 'openai', context_window: 128000 }), {
    id: 'gpt-4o',
    provider: 'openai',
  });
  assert.equal(readActiveModel(null), null);
});

test('the label pairs provider with id, and survives a missing provider', () => {
  assert.equal(modelLabel({ id: 'qwen38-27B', provider: 'openai' }), 'openai/qwen38-27B');
  assert.equal(modelLabel({ id: 'qwen38-27B', provider: null }), 'qwen38-27B');
  assert.equal(modelLabel(null), null);
});

/*
 * The panel. Its interesting states are reachable only after an async load,
 * which is why the markup lives in a component that takes them as props.
 */

const panel = (props) =>
  renderToStaticMarkup(
    React.createElement(ModelPanel, {
      rows: readModelRows(WIRE),
      active: { id: 'qwen38-27B', provider: 'openai' },
      running: false,
      busy: false,
      error: null,
      onClose: () => {},
      onReload: () => {},
      onChoose: () => {},
      ...props,
    }),
  );

test('a row shows the config name and the id it resolves to, which differ', () => {
  const html = panel({});
  assert.match(html, /<span class="tau-session-title">local-llm<\/span>/);
  assert.match(html, /openai\/qwen38-27B/);
});

test('the active row is marked and cannot be clicked, being already active', () => {
  const html = panel({});
  const rows = html.split('<li>');
  const active = rows.find((row) => row.includes('local-llm'));
  assert.match(active, /tau-session-current/);
  assert.match(active, /active ·/);
  assert.match(active, /disabled/);
  // And exactly one row is marked.
  assert.equal(html.split('tau-session-current').length - 1, 1);
});

test('a model with no config name says so, and marks nothing', () => {
  const html = panel({ active: { id: 'set-at-startup', provider: 'openai' } });
  assert.match(html, /no entry in tau&#x27;s config/);
  assert.doesNotMatch(html, /tau-session-current/);
});

test('two aliases are both marked, and the panel says why', () => {
  const html = panel({
    rows: readModelRows([...WIRE, { name: 'fast', model: { id: 'gpt-4o', provider: 'openai' } }]),
    active: { id: 'gpt-4o', provider: 'openai' },
  });
  assert.match(html, /2 names resolve to the running model/);
  assert.equal(html.split('tau-session-current').length - 1, 2);
});

test('a running turn disables every row and says what is waiting', () => {
  const html = panel({ running: true });
  assert.match(html, /will not change model mid-stream/);
  assert.equal(html.split('disabled=""').length - 1, 3); // one per row, none clickable
});

test('an empty config is a sentence about where models live, not a blank list', () => {
  const html = panel({ rows: [] });
  assert.match(html, /declares no models/);
  assert.match(html, /config\.json/);
});

test('an error from tau is shown verbatim, next to the list it failed to change', () => {
  const html = panel({ error: "unknown model 'no-such-model'; configured models: gpt-4o" });
  assert.match(html, /unknown model &#x27;no-such-model&#x27;/);
});
