#!/usr/bin/env node
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { startServer } from './server.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_STATIC = resolve(HERE, '../../web/dist-web');

const USAGE = `tau-code-server -- serve a tau agent to browser clients.

Usage:
  tau-code-server [options]

Options:
  --bind <address>     Bind address (default: 127.0.0.1). 0.0.0.0 exposes the
                       server to your network; read the warning it prints.
  --port <n>           Port (default: 8791). 0 picks a free one.
  --token <t>          Token clients must present. Generated when omitted.
  --static <dir>       Directory holding the built web client.
  --cwd <dir>          Working directory for the agent's tools.
  --model <name>       Passed to tau as --model.
  --provider <name>    Passed to tau as --provider.
  --session-dir <dir>  Where session logs go. Omitted uses tau's RPC default,
                       a private <tmp>/.tau-<uid>/sessions, which does not
                       survive a reboot that clears the temp directory. Pass
                       ~/.tau/sessions to share one store with the tau TUI --
                       resume works in both directions.
  --no-session         Run tau with --no-session (nothing is persisted).
  -h, --help           This text.

Environment:
  TAU_BIN              Path to tau's console script (default: tau on PATH).

A token is always required, including on loopback. The server prints an
authenticated URL on startup; open that link and you are in.
`;

function parse(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined || !arg.startsWith('--')) {
      if (arg === '-h') out['help'] = true;
      continue;
    }
    const key = arg.slice(2);
    if (key === 'help' || key === 'no-session') {
      out[key] = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      // Fail Early: a flag that takes a value and did not get one is a mistake,
      // not a request for a default.
      console.error(`Option --${key} needs a value.`);
      process.exit(2);
    }
    out[key] = value;
    i++;
  }
  return out;
}

const args = parse(process.argv.slice(2));

if (args['help']) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const bind = typeof args['bind'] === 'string' ? args['bind'] : '127.0.0.1';
const portArg = typeof args['port'] === 'string' ? Number(args['port']) : 8791;
if (!Number.isInteger(portArg) || portArg < 0 || portArg > 65535) {
  console.error(`--port must be an integer in 0..65535 (got ${String(args['port'])}).`);
  process.exit(2);
}

const running = await startServer({
  bind,
  port: portArg,
  ...(typeof args['token'] === 'string' ? { token: args['token'] } : {}),
  staticDir: typeof args['static'] === 'string' ? resolve(args['static']) : DEFAULT_STATIC,
  tau: {
    ...(typeof args['cwd'] === 'string' ? { cwd: resolve(args['cwd']) } : {}),
    ...(typeof args['model'] === 'string' ? { model: args['model'] } : {}),
    ...(typeof args['provider'] === 'string' ? { provider: args['provider'] } : {}),
    // resolve() expands a relative path but NOT a leading `~`: tau is spawned
    // with no shell in between, so an unexpanded `~` becomes a literal
    // directory name.
    ...(typeof args['session-dir'] === 'string'
      ? { sessionDir: resolve(args['session-dir'].replace(/^~(?=$|\/)/, homedir())) }
      : {}),
    ...(args['no-session'] === true ? { noSession: true } : {}),
  },
}).catch((error: unknown) => {
  console.error(`Could not start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

const exposed = bind === '0.0.0.0' || bind === '::';

process.stdout.write(
  '\n' +
    `  tau-code server is running.\n\n` +
    `  Open this link:\n\n` +
    `      ${running.url}\n\n` +
    (exposed
      ? `  WARNING: bound to ${bind}, so anything that can reach this machine can\n` +
        `  reach this port. The agent runs shell commands with your permissions.\n` +
        `  There is no TLS here -- put a reverse proxy in front of it if the\n` +
        `  network is not one you control.\n\n`
      : '') +
    `  Press Ctrl+C to stop.\n\n`,
);

let stopping = false;
const shutdown = (signal: string): void => {
  if (stopping) return;
  stopping = true;
  process.stdout.write(`\nStopping (${signal})...\n`);
  running.close().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(error);
      process.exit(1);
    },
  );
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
