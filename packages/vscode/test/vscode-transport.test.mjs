import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/**
 * `VsCodeTransport`, and the restart that used to hang the panel forever.
 *
 * ## Why this file compiles its subject
 *
 * The transport is TypeScript that only ever reaches a bundle: `tsc` emits
 * declarations for this package and esbuild emits one `extension.js` plus one
 * webview bundle, so there is no module on disk to import. Rather than leave the
 * one class that can silently strand the UI untested, this compiles the single
 * file in memory and imports the result. It costs about 30ms.
 *
 * ## The bug these pin
 *
 * A restart stops the old tau and replaces the page. The old process's exit
 * arrives as `tau_code/process_exit` at the NEW page, during the window after
 * the transport's `window` listener exists and before `TauClient` has registered
 * `onClose`. Three things then went wrong in sequence:
 *
 *   1. `#fire` dropped the close, because no handler was attached.
 *   2. `#closed` was set anyway.
 *   3. `send` saw `#closed` and returned, silently, so `get_capabilities` never
 *      left the page.
 *
 * `connect()` neither resolved nor rejected. The panel read "connecting" until
 * the window was reloaded -- the one failure a UI cannot render, because nothing
 * ever happened. The host no longer sends that stale exit at all (see
 * `session.ts`), and these keep the transport honest if it ever does again.
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
const { VsCodeTransport } = await load();

test('a close arriving before onClose is delivered, not dropped', () => {
  // The restart window: the page is up, the client is not built yet.
  const transport = new VsCodeTransport();
  host.post({ jsonrpc: '2.0', method: 'tau_code/process_exit', params: { reason: 'tau exited with code 0.' } });

  let reason = null;
  transport.onClose((value) => {
    reason = value;
  });
  assert.equal(reason, 'tau exited with code 0.');
});

test('the held close is delivered once, not on every registration', () => {
  const transport = new VsCodeTransport();
  host.post({ jsonrpc: '2.0', method: 'tau_code/process_exit', params: { reason: 'gone' } });

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
  // This is the assertion that would have caught the hang. A silent return here
  // leaves `TauClient.call` pending forever; a throw rejects it with a sentence.
  const transport = new VsCodeTransport();
  host.post({ jsonrpc: '2.0', method: 'tau_code/process_exit', params: { reason: 'gone' } });

  assert.throws(
    () => transport.send({ jsonrpc: '2.0', id: 1, method: 'get_capabilities', params: {} }),
    /not running/,
  );
});

test('a live transport sends, and a notice is not a protocol message', () => {
  const transport = new VsCodeTransport();
  const before = host.sent.length;

  const notices = [];
  transport.onNotice((notice) => notices.push(notice));
  const messages = [];
  transport.onMessage((message) => messages.push(message));

  transport.send({ jsonrpc: '2.0', id: 1, method: 'get_capabilities', params: {} });
  assert.equal(host.sent.length - before, 1);

  // `tau_code/notice` is the host talking about tau, so it must not reach the
  // JSON-RPC client as if tau had said it.
  host.post({ jsonrpc: '2.0', method: 'tau_code/notice', params: { id: 'x', level: 'warn', text: 'two taus' } });
  assert.equal(notices.length, 1);
  assert.equal(messages.length, 0);

  host.post({ jsonrpc: '2.0', id: 1, result: {} });
  assert.equal(messages.length, 1);
});
