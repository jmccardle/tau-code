#!/usr/bin/env node
/**
 * TC-04: the protocol package against a real `tau serve --no-unix` (the HTTP edge alone), with
 * the mock model in a throwaway TAU_HOME. Run after `npm run build`:
 *
 *   TAU_BIN=/path/to/venv/bin/tau npm run smoke
 *
 * It checks, in order: the edge refuses a wrong token (401) and a foreign origin (403); `hello`'s
 * snapshot arrives before its answer; `watch` then `send` streams `Live` text, then `Appended`,
 * then the cursor at rest with `ending` Done; `walk` holds the reply; a second client, through
 * `SessionLink`, sees the same session and can read the whole tree; and `tau serve --stop` ends
 * the first client's stream with `end {error: null}`.
 */
import assert from 'node:assert/strict';
import {
  EdgeError,
  HttpTransport,
  PROTOCOL,
  ServeClient,
  SessionLink,
  SessionModel,
  bodyKind,
  proseText,
} from '../packages/protocol/dist/index.js';
import { serve, until } from './lib/serve.mjs';

const served = await serve();
const { url, token, session } = served.record;
let failed = false;
try {
  assert.equal(served.record.socket, undefined, '--no-unix: the record names no socket');
  console.log(`τ ${served.record.version} serving ${session} at ${url}`);

  // Refusals.
  await assert.rejects(HttpTransport.open({ url, token: 'wrong' }), (e) => e instanceof EdgeError && e.kind === 'unauthorized');
  const foreign = await fetch(new URL('stream', url), {
    headers: { Authorization: `Bearer ${token}`, Origin: 'http://evil.example' },
  });
  assert.equal(foreign.status, 403, 'a foreign Origin is refused');
  console.log('ok: a wrong token is 401, a foreign origin 403');

  // Client A, by hand: hello's snapshot first.
  const a = new ServeClient(await HttpTransport.open({ url, token }));
  const order = [];
  const events = [];
  const model = new SessionModel();
  a.on('event', (event) => {
    order.push(`event:${event.kind}`);
    events.push(event);
    model.hear(event);
  });
  let closedA = null;
  a.on('closed', (reason, end) => (closedA = { reason, end }));
  const welcome = await a.hello('smoke@tau-code:a');
  order.push('hello');
  model.welcome = welcome;
  assert.equal(welcome.protocol, PROTOCOL);
  assert.equal(welcome.session, session);
  assert.deepEqual(order, ['event:CursorView', 'event:Labels', 'hello'], 'the snapshot comes before hello answers');
  const cursor = model.openCursors()[0].cursor;
  console.log(`ok: hello after its snapshot; cursor ${cursor} at node ${model.views.get(cursor).at}`);

  // A turn, watched.
  await a.call('watch', { cursors: [cursor] });
  events.length = 0;
  const item = await a.call('send', { cursor, text: 'hello from the smoke' });
  assert.equal(typeof item, 'number');
  let sawBusy = false;
  await until(() => {
    const view = model.views.get(cursor);
    sawBusy ||= view.busy;
    return sawBusy && !view.busy;
  }, 'the step to end');
  const text = events
    .filter((e) => e.kind === 'Live' && e.delta.kind === 'TextDelta')
    .map((e) => e.delta.text)
    .join('');
  assert.equal(text, 'mock: hello from the smoke', 'Live streamed the reply');
  const firstLive = events.findIndex((e) => e.kind === 'Live');
  const reply = events.findIndex(
    (e) => e.kind === 'Appended' && e.nodes.some((n) => bodyKind(n.body) === 'Assistant'),
  );
  assert.ok(firstLive >= 0 && reply > firstLive, 'Live came before the Appended reply');
  const view = model.views.get(cursor);
  assert.equal(view.ending, 'Done');
  assert.equal(model.layers.has(cursor), false, 'at rest: no live layer');
  console.log(`ok: Live "${text}", then Appended, then at rest (ending Done, at ${view.at})`);

  const walk = await a.call('walk', { id: view.at });
  const last = walk.at(-1);
  assert.equal(bodyKind(last.body), 'Assistant');
  assert.equal(proseText(last.body.Assistant.parts[0].Text), 'mock: hello from the smoke');
  assert.ok(walk.some((n) => n.body.User === 'hello from the smoke'));
  console.log(`ok: walk(${view.at}) holds the input and the reply (${walk.length} nodes)`);

  // Client B, through the link: the same session.
  const b = new SessionLink({ open: () => HttpTransport.open({ url, token }), client: 'smoke@tau-code:b' });
  b.start();
  await until(() => b.state.phase === 'ready', 'client b to be ready');
  assert.equal(b.state.welcome.session, session);
  assert.deepEqual(b.state.model.views.get(cursor).at, view.at, 'b sees the same cursor');
  await until(() => b.state.model.walk(view.at) !== null, 'b to read its walk');
  await b.loadTree();
  assert.equal(b.state.model.nodes.size, view.at + 1, 'the whole tree, read in pages');
  console.log(`ok: a second client sees cursor ${cursor} at ${view.at} and reads ${b.state.model.nodes.size} nodes`);

  // The server stops: a's stream ends with end {error: null}.
  b.dispose();
  await served.stop();
  await until(() => closedA !== null, "a's stream to end");
  assert.deepEqual(closedA.end, { error: null });
  assert.equal(closedA.reason, 'the server stopped');
  console.log('ok: tau serve --stop ends the stream with end {error: null}');
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  await served.stop().catch((error) => {
    failed = true;
    console.error(error);
  });
}
if (failed) process.exit(1);
console.log('smoke: green');
