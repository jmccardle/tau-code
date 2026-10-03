/**
 * A `tau serve` for a script: started in a throwaway HOME, on a free port, and
 * stopped when the script is done.
 *
 * Every smoke script needs the same three things -- a daemon that is not the
 * user's, a config τ will start with, and a client -- and none of them should
 * touch `~/.tau`. The HOME is a temp directory; the user's sessions are never
 * opened, only copied in when a script asks for one.
 *
 *   const daemon = await startDaemon({ config: { models: ... } });
 *   const client = await connect(daemon.url, 'smoke');
 *   ...
 *   await daemon.stop();
 */
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import WebSocket from 'ws';
import { ServeClient } from '../../packages/protocol/dist/index.js';

/**
 * A model τ will start with and that nothing calls: an address nothing listens
 * on. Honest for a script that sends no prompt, which is most of them.
 */
export const UNUSED_MODEL = {
  models: {
    unused: { backend: 'openai', model: 'unused', base_url: 'http://127.0.0.1:1/v1', api_key: 'not-needed' },
  },
  default_model: 'unused',
};

/** A port nothing is listening on right now. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * τ's session-store key for a cwd: `--` + the absolute path with its leading
 * separator stripped and `/`, `\` and `:` flattened to `-` + `--`
 * (`session_dir_for_cwd`).
 */
export function scopeName(cwd) {
  return `--${cwd.replace(/^[/\\]+/, '').replace(/[/\\:]/g, '-')}--`;
}

/**
 * Start a daemon.
 *
 * @param {object} options
 * @param {string} [options.bin]       τ's console script; TAU_BIN, else `tau`.
 * @param {string[]} [options.baseArgs] arguments before `serve` (a payload's `-I -m ...`).
 * @param {object} [options.config]    ~/.tau/config.json; UNUSED_MODEL by default.
 * @param {string} [options.cwd]       the daemon's working directory.
 * @param {string} [options.webRoot]   serve this directory as the web client.
 * @param {{path: string, cwd: string}[]} [options.sessions] session logs to copy into the store.
 * @param {Record<string,string>} [options.env] the whole environment, for isolation checks.
 */
export async function startDaemon(options = {}) {
  // A path is resolved against THIS process's cwd now, because the daemon runs
  // in another one; a bare name is left for PATH.
  const named = options.bin ?? process.env.TAU_BIN ?? 'tau';
  const bin = /[/\\]/.test(named) ? resolve(named) : named;
  const home = mkdtempSync(join(tmpdir(), 'tau-code-daemon-'));
  mkdirSync(join(home, '.tau'), { recursive: true });
  writeFileSync(join(home, '.tau', 'config.json'), JSON.stringify(options.config ?? UNUSED_MODEL, null, 2));
  for (const session of options.sessions ?? []) {
    const dir = join(home, '.tau', 'sessions', scopeName(session.cwd));
    mkdirSync(dir, { recursive: true });
    cpSync(session.path, join(dir, basename(session.path)));
  }

  const port = await freePort();
  const address = `127.0.0.1:${port}`;
  const args = [...(options.baseArgs ?? []), 'serve', '--listen', address];
  if (options.webRoot) args.push('--web-root', options.webRoot);
  const child = spawn(bin, args, {
    cwd: options.cwd ?? home,
    env: options.env ? { ...options.env, HOME: home } : { ...process.env, HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  child.once('error', (error) => (output += `\nspawn failed: ${error.message}`));

  // Ready when it accepts a WebSocket; the `listening` line could be reworded.
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (await accepts(`ws://${address}/`)) break;
    if (child.exitCode !== null || Date.now() > deadline) {
      child.kill('SIGKILL');
      rmSync(home, { recursive: true, force: true });
      throw new Error(`tau serve did not come up on ${address}. Output:\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return {
    address,
    url: `ws://${address}/`,
    http: `http://${address}/`,
    home,
    get output() {
      return output;
    },
    async stop() {
      if (child.exitCode === null) child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
      await exited;
      clearTimeout(timer);
      rmSync(home, { recursive: true, force: true });
    },
  };
}

function accepts(url) {
  return new Promise((resolve) => {
    const socket = new WebSocket(url);
    socket.once('open', () => {
      socket.close();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

/** A transport over Node's `ws`, as the VS Code extension host dials. */
export function wsTransport(url) {
  const socket = new WebSocket(url, { maxPayload: 0 });
  let onMessage = () => {};
  let onClose = () => {};
  const queue = [];
  socket.on('open', () => {
    for (const frame of queue.splice(0)) socket.send(frame);
  });
  socket.on('message', (data) => onMessage(JSON.parse(data.toString())));
  socket.on('close', (code, reason) => onClose(reason.toString() || `closed (${code})`, code));
  socket.on('error', () => {});
  return {
    send(frame) {
      const text = JSON.stringify(frame);
      if (socket.readyState === WebSocket.OPEN) socket.send(text);
      else queue.push(text);
    },
    onMessage: (handler) => (onMessage = handler),
    onClose: (handler) => (onClose = handler),
    close: () => socket.close(),
  };
}

/** A client that has said hello. */
export async function connect(url, name, token = null) {
  const client = new ServeClient(wsTransport(url));
  const hello = await client.hello(name, token);
  return Object.assign(client, { helloResult: hello });
}

/** Print a claim and its verdict; a failed claim fails the script. */
export function check(claim, ok) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${claim}`);
  if (!ok) process.exitCode = 1;
}
