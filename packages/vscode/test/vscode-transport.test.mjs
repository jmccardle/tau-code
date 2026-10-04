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
 * The client waits on a request with no deadline, so a request the relay can
 * no longer deliver must be REJECTED, never left pending: a close arriving
 * before anyone listens is held and delivered, a send after a close throws,
 * and frames for a connection the page has moved on from are dropped rather
 * than handed to its replacement.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, '..', 'src', 'webview', 'vscode-transport.ts');

/** Compile the transport alone, with its type-only imports erased. */
async function load() {
  const { outputFiles } = await build({
    stdin: {
      contents: readFileSync(SOURCE, 'utf8'),
      loader: 'ts',
      resolveDir: dirname(SOURCE),
      sourcefile: 'vscode-transport.ts',
    },
    format: 'esm',
    write: false,
    bundle: true,
    // Both are type-only in the source, so nothing of them survives erasure.
    external: ['@ffwf/tau-code-protocol', '@ffwf/tau-code-ui'],
  });
  const code = outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

/**
 * The two globals the transport reaches for, as the webview provides them.
 *
 * `acquireVsCodeApi` may be called once per document, which the transport caches
 * around -- and that cache is module-level, so every test here shares one `sent`
 * array and reads its own slice.
 */
function install() {
  const sent = [];
  const listeners = [];
  globalThis.window = {
    addEventListener(kind, handler) {
      if (kind === 'message') listeners.push(handler);
    },
  };
  globalThis.acquireVsCodeApi = () => ({
    postMessage: (message) => sent.push(message),
    getState: () => undefined,
    setState: () => {},
  });
  return {
    sent,
    /** Deliver a host message to every transport listening. */
    post: (data) => listeners.forEach((handler) => handler({ data })),
  };
}

const host = install();
const { Relay } = await load();
/** One per page, as in the webview: `acquireVsCodeApi()` may be called once. */
const relay = new Relay();

test('opening asks the host for a numbered connection', () => {
  const before = host.sent.length;
  relay.open();
  const asked = host.sent.slice(before);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].tauCode, 'open');
  assert.equal(typeof asked[0].connection, 'number');
});

test('a close arriving before onClose is delivered, not dropped', () => {
  // The relay can learn there is nothing to dial before the client has
  // registered its close handler.
  const before = host.sent.length;
  const transport = relay.open();
  const { connection } = host.sent[before];
  host.post({ tauCode: 'closed', connection, reason: 'No tau was found.', code: 4900 });

  let seen = null;
  transport.onClose((reason, code) => {
    seen = [reason, code];
  });
  assert.deepEqual(seen, ['No tau was found.', 4900]);
});

test('the held close is delivered once, not on every registration', () => {
  const before = host.sent.length;
  const transport = relay.open();
  host.post({ tauCode: 'closed', connection: host.sent[before].connection, reason: 'gone', code: 1006 });

  let count = 0;
  transport.onClose(() => {
    count += 1;
  });
  transport.onClose(() => {
    count += 1;
  });
  // A close is a fact about the connection, not a queued message.
  assert.equal(count, 1);
});

test('sending after a close throws instead of vanishing', () => {
  // A silent return here would leave the request pending forever; a throw
  // rejects it with a sentence.
  const before = host.sent.length;
  const transport = relay.open();
  host.post({ tauCode: 'closed', connection: host.sent[before].connection, reason: 'gone', code: 1006 });
  assert.throws(() => transport.send({ type: 'list_sessions', id: 1 }), /closed/);
});

test('frames reach only their own connection, and a notice is not a frame', () => {
  const before = host.sent.length;
  const old = relay.open();
  const fresh = relay.open();
  const [oldId, freshId] = host.sent.slice(before).map((message) => message.connection);
  const toOld = [];
  const toFresh = [];
  old.onMessage((frame) => toOld.push(frame));
  fresh.onMessage((frame) => toFresh.push(frame));

  fresh.send({ jsonrpc: '2.0', id: 1, method: 'hello' });
  assert.deepEqual(host.sent.at(-1), {
    tauCode: 'frame',
    connection: freshId,
    frame: { jsonrpc: '2.0', id: 1, method: 'hello' },
  });

  host.post({ tauCode: 'frame', connection: freshId, frame: { jsonrpc: '2.0', id: 1, result: null } });
  assert.equal(toFresh.length, 1);
  assert.equal(toOld.length, 0, 'a frame for one connection must never reach another');

  // The host talking about τ must not reach the protocol client as if τ said it.
  const notices = [];
  relay.onNotice((notice) => notices.push(notice));
  host.post({ tauCode: 'notice', notice: { id: 'x', level: 'warn', text: 'two taus' } });
  assert.equal(notices.length, 1);
  assert.equal(toFresh.length, 1);
  assert.ok(oldId !== freshId);
});
