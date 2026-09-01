#!/usr/bin/env node
/**
 * End-to-end smoke test for the connection server.
 *
 * Starts a server on a free port, then checks: an unauthenticated request is
 * refused, an authenticated one serves the web build, and a WebSocket client
 * can negotiate with the real tau behind it. Sends no prompt.
 *
 *   TAU_BIN=/path/to/venv/bin/tau node scripts/smoke-server.mjs
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { WebSocket } from 'ws';
import { startServer } from '../packages/server/dist/index.js';
import { TauClient } from '../packages/protocol/dist/index.js';
import { LineFramer } from '../packages/protocol/dist/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const checks = [];
function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${name}${detail ? ` -- ${detail}` : ''}`);
}

const server = await startServer({
  port: 0,
  staticDir: resolve(HERE, '../packages/web/dist-web'),
  tau: { noSession: true },
  onLog: () => {},
});

const base = `http://127.0.0.1:${server.port}`;

try {
  const health = await fetch(`${base}/healthz`);
  check('healthz needs no token', health.status === 200, `status ${health.status}`);

  const denied = await fetch(`${base}/`);
  check('no token is refused', denied.status === 401, `status ${denied.status}`);

  const wrong = await fetch(`${base}/?token=not-the-token`);
  check('wrong token is refused', wrong.status === 401, `status ${wrong.status}`);

  const page = await fetch(`${base}/?token=${server.token}`);
  const html = await page.text();
  check('token serves the web build', page.status === 200 && html.includes('<div id="root">'));

  const traversal = await fetch(`${base}/../../package.json?token=${server.token}`);
  const body = await traversal.text();
  check('path traversal does not escape the root', !body.includes('"workspaces"'));

  // A WebSocket without a token must not upgrade.
  const rejected = await new Promise((resolvePromise) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    ws.on('open', () => {
      ws.close();
      resolvePromise(false);
    });
    ws.on('error', () => resolvePromise(true));
  });
  check('WebSocket without a token is refused', rejected);

  // A real client over the socket.
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws?token=${server.token}`);
  await new Promise((resolvePromise, reject) => {
    socket.on('open', resolvePromise);
    socket.on('error', reject);
  });

  let onMessage = () => {};
  let onClose = () => {};
  const framer = new LineFramer(
    (value) => onMessage(value),
    (line) => console.error('unparseable:', line),
  );
  socket.on('message', (data) => framer.push(data.toString().endsWith('\n') ? data.toString() : `${data}\n`));
  socket.on('close', () => onClose('socket closed'));

  const client = new TauClient({
    send: (message) => socket.send(JSON.stringify(message) + '\n'),
    onMessage: (handler) => {
      onMessage = handler;
    },
    onClose: (handler) => {
      onClose = handler;
    },
    close: () => socket.close(),
  });

  const caps = await client.connect();
  check('negotiated through the server', caps.protocol_version === '1.3', `protocol ${caps.protocol_version}`);

  const state = await client.call('get_state', {});
  check('get_state answers through the server', typeof state.session_id === 'string', state.session_id);

  const messages = await client.call('get_messages', {});
  check('get_messages answers', Array.isArray(messages.messages), `${messages.messages.length} messages`);

  socket.close();
} finally {
  await server.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
process.exitCode = failed.length === 0 ? 0 : 1;
