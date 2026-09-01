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
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { WebSocket } from 'ws';
import { startServer } from '../packages/server/dist/index.js';
import { TauClient, BUILT_AGAINST } from '../packages/protocol/dist/index.js';
import { LineFramer } from '../packages/protocol/dist/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const checks = [];
function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${name}${detail ? ` -- ${detail}` : ''}`);
}

const server = await startServer({
  port: 0,
  // The server's own copy, not the web workspace's: that is what ships in the
  // package and in the container image, so it is what this should exercise.
  staticDir: resolve(HERE, '../packages/server/dist-web'),
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

  // The regression this file exists to catch. A browser does NOT copy the
  // query string onto sub-resource requests, so the page's own module script
  // arrives with no token. Before the cookie it came back 401 as text/plain,
  // and the browser reported a blocked MIME type rather than a refusal.
  const cookie = page.headers.get('set-cookie');
  check('an authenticated page plants a session cookie', Boolean(cookie), cookie ?? 'none');

  const assetPath = /src="([^"]*\.js)"/.exec(html)?.[1] ?? '';
  check('the page references a module asset', assetPath !== '', assetPath);

  const bare = await fetch(`${base}${assetPath}`);
  check('an asset with no credential is still refused', bare.status === 401, `status ${bare.status}`);

  const withCookie = await fetch(`${base}${assetPath}`, {
    headers: { cookie: (cookie ?? '').split(';')[0] ?? '' },
  });
  check(
    'the cookie authenticates the module script',
    withCookie.status === 200,
    `status ${withCookie.status}`,
  );
  check(
    'the module script is served as JavaScript',
    (withCookie.headers.get('content-type') ?? '').startsWith('text/javascript'),
    withCookie.headers.get('content-type') ?? 'none',
  );

  const missing = await fetch(`${base}/assets/does-not-exist.js?token=${server.token}`);
  check(
    'a missing asset 404s instead of falling back to HTML',
    missing.status === 404,
    `status ${missing.status}, type ${missing.headers.get('content-type')}`,
  );

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
  // BUILT_AGAINST, not a literal: this asserts the client and the tau on PATH
  // agree, which is what the check is for. A literal here goes stale at every
  // protocol bump and fails for a reason that has nothing to do with the server.
  check(
    'negotiated through the server',
    caps.protocol_version === BUILT_AGAINST,
    `protocol ${caps.protocol_version}, client built against ${BUILT_AGAINST}`,
  );

  const state = await client.call('get_state', {});
  check('get_state answers through the server', typeof state.session_id === 'string', state.session_id);

  const messages = await client.call('get_messages', {});
  check('get_messages answers', Array.isArray(messages.messages), `${messages.messages.length} messages`);

  // --- @file expansion, end to end (protocol 1.4) -------------------------
  //
  // The turn itself is aborted immediately: what is being checked is that the
  // PROMPT tau built carries the file's content, which is decided before
  // admission and is therefore already true when the acceptance arrives. No
  // model has to answer, so this costs no API credits.
  //
  // The attached file is written here rather than being an existing one. This
  // check used to read README.md and started failing the day the README grew
  // past tau's `attachment_inline_limit` (10240 bytes by default), because tau
  // then correctly emits `<reference>` instead of `<attachment>`. That was the
  // test measuring the README's size, which is nobody's contract.
  const fixture = resolve(HERE, '../smoke-attachment.txt');
  writeFileSync(fixture, 'The seventh sea is called Corandel.\n');

  const accepted = await client.call('submit', {
    text: 'read @smoke-attachment.txt',
    source: 'rpc',
    submitter: 'smoke',
    submission_id: 'smoke-attachment-1',
    expand_attachments: true,
  });
  const report = accepted.attachments;
  check(
    'submit reports what expand_attachments did',
    report !== undefined && report.expanded === 1 && report.failures.length === 0,
    JSON.stringify(report),
  );

  // The turn is aborted, and then this WAITS for agent_end before reading.
  // `get_messages` answers from the persisted path, which tau writes when the
  // turn closes -- measured: reading mid-turn returns 0 messages, which is a
  // fact about when tau persists rather than about the expansion.
  let ended = false;
  const offEnd = client.on('event', (event) => {
    if (event.type === 'agent_end') ended = true;
  });
  await client.call('abort', {});
  for (let i = 0; i < 60 && !ended; i++) await new Promise((r) => setTimeout(r, 200));
  offEnd();
  check('the aborted turn closed', ended);
  await new Promise((r) => setTimeout(r, 400));

  const after = await client.call('get_messages', {});
  const sent = JSON.stringify(after.messages);
  check(
    'the model was given the file, not the @word',
    sent.includes('<attachment filename=\\"smoke-attachment.txt\\">') &&
      sent.includes('The seventh sea is called Corandel.'),
    `${after.messages.length} messages, ${sent.length} bytes`,
  );
  check(
    'and the @word stays where it was typed',
    sent.includes('read @smoke-attachment.txt'),
    'the instruction still names the file the way the human did',
  );

  socket.close();
} finally {
  rmSync(resolve(HERE, '../smoke-attachment.txt'), { force: true });
  await server.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
process.exitCode = failed.length === 0 ? 0 : 1;
