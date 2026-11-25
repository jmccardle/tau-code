import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/**
 * The webview's half of the relay: numbered connections to `tau serve`
 * through the extension host.
 *
 * ## Why this file compiles its subject
 *
 * The transport is TypeScript that only ever reaches a bundle: `tsc` emits
 * declarations for this package and esbuild emits one `extension.js` plus one
 * webview bundle, so there is no module on disk to import. Rather than leave the
 * one class that can silently strand the UI untested, this compiles the single
 * file in memory and imports the result. It costs about 30ms.
 *
 * ## What these pin
 *
 * `open()` resolves once the host says the stream is open and rejects with the
 * host's `EdgeError` kind otherwise, so `SessionLink` retries what can change
 * and stops on what cannot. A close arriving before anyone listens is held and
 * delivered once; messages for a connection the page has moved on from are
 * dropped rather than handed to its replacement; the bearer token never
 * appears in what the page sends.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, '..', 'src', 'webview', 'vscode-transport.ts');

/** Compile the transport, with the protocol package (its `EdgeError`) bundled in from its dist. */
async function load() {
  const { outputFiles } = await build({
    stdin: {
      contents: readFileSync(SOURCE, 'utf8'),
      loader: 'ts',
      resolveDir: dirname(SOURCE),
      sourcefile: 'vscode-transport.ts',
    },
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    write: false,
    bundle: true,
  });
  const code = outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

/**
 * The two globals the transport reaches for, as the webview provides them. `acquireVsCodeApi`
 * may be called once per document, so every test here shares one `sent` array and reads its own
 * slice.
 */
function install() {
  const sent = [];
  const listeners = [];
  let state;
  globalThis.window = {
    addEventListener(kind, handler) {
      if (kind === 'message') listeners.push(handler);
    },
  };
  globalThis.acquireVsCodeApi = () => ({
    postMessage: (message) => sent.push(message),
    getState: () => state,
    setState: (next) => {
      state = next;
    },
  });
  return {
    sent,
    /** Deliver a host message to the page. */
    post: (data) => listeners.forEach((handler) => handler({ data })),
  };
}

const host = install();
const { Relay } = await load();
const relay = new Relay();

/** Open a connection; return its number and the pending open. */
function opening() {
  const before = host.sent.length;
  const opened = relay.open();
  const asked = host.sent.slice(before);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].tauCode, 'open');
  return { connection: asked[0].connection, opened };
}

test('open resolves when the host says the stream is open', async () => {
  const { connection, opened } = opening();
  host.post({ tauCode: 'opened', connection });
  const transport = await opened;
  assert.equal(typeof transport.send, 'function');
});

test("a refusal rejects open with the host's EdgeError kind", async () => {
  const { connection, opened } = opening();
  host.post({ tauCode: 'refused', connection, kind: 'unavailable', reason: 'No tau was found.' });
  await assert.rejects(opened, (error) => {
    assert.equal(error.name, 'EdgeError');
    assert.equal(error.kind, 'unavailable');
    assert.equal(error.retryable, false);
    assert.equal(error.message, 'No tau was found.');
    return true;
  });
});

test('a close before the stream opened rejects open as unreachable (retryable)', async () => {
  const { connection, opened } = opening();
  host.post({ tauCode: 'closed', connection, reason: 'gone', violation: false });
  await assert.rejects(opened, (error) => error.kind === 'unreachable' && error.retryable === true);
});

test('a close arriving before onClose is delivered once, not dropped', async () => {
  const { connection, opened } = opening();
  host.post({ tauCode: 'opened', connection });
  const transport = await opened;
  host.post({ tauCode: 'closed', connection, reason: 'the server ended the stream', violation: false });
  const seen = [];
  transport.onClose((reason, violation) => seen.push([reason, violation]));
  transport.onClose((reason, violation) => seen.push([reason, violation]));
  assert.deepEqual(seen, [['the server ended the stream', false]]);
  // A send after the close is dropped, as HttpTransport does; the client rejects its calls on close.
  const before = host.sent.length;
  transport.send({ jsonrpc: '2.0', id: 9, method: 'nodes' });
  assert.equal(host.sent.length, before);
});

test('messages reach only their own connection; messages before onMessage are kept', async () => {
  const a = opening();
  const b = opening();
  host.post({ tauCode: 'opened', connection: a.connection });
  host.post({ tauCode: 'opened', connection: b.connection });
  const old = await a.opened;
  const fresh = await b.opened;

  host.post({ tauCode: 'message', connection: b.connection, message: { jsonrpc: '2.0', method: 'event' } });
  const toOld = [];
  const toFresh = [];
  old.onMessage((message) => toOld.push(message));
  fresh.onMessage((message) => toFresh.push(message));
  assert.equal(toFresh.length, 1, 'a message before onMessage is handed over when it is called');

  fresh.send({ jsonrpc: '2.0', id: 1, method: 'hello' });
  assert.deepEqual(host.sent.at(-1), {
    tauCode: 'message',
    connection: b.connection,
    message: { jsonrpc: '2.0', id: 1, method: 'hello' },
  });
  host.post({ tauCode: 'message', connection: b.connection, message: { jsonrpc: '2.0', id: 1, result: {} } });
  assert.equal(toFresh.length, 2);
  assert.equal(toOld.length, 0, 'a message for one connection must never reach another');
});

test('close tells the host, runs the close handler once, and drops later messages', async () => {
  const { connection, opened } = opening();
  host.post({ tauCode: 'opened', connection });
  const transport = await opened;
  const closes = [];
  const messages = [];
  transport.onClose((reason) => closes.push(reason));
  transport.onMessage((message) => messages.push(message));
  transport.close();
  transport.close();
  assert.deepEqual(host.sent.at(-1), { tauCode: 'close', connection });
  assert.deepEqual(closes, ['closed by this client']);
  host.post({ tauCode: 'message', connection, message: { late: true } });
  assert.equal(messages.length, 0);
});

test('state is kept for the host to restore the panel', () => {
  relay.remember({ client: 'vscode@me@box:1234' });
  relay.remember({ session: '20261124-000000-abcdef' });
  assert.deepEqual(relay.state, { client: 'vscode@me@box:1234', session: '20261124-000000-abcdef' });
});
