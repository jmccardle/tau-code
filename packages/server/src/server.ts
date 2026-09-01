import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import type { TauProcessOptions } from '@tau-code/runner';
import { Hub } from './hub.js';
import { createHttpServer } from './http.js';

export interface ServerOptions {
  /** Bind address. Defaults to 127.0.0.1 -- reaching further is opt-in. */
  bind?: string;
  /** Port. 0 asks the OS for a free one. */
  port?: number;
  /** Token clients must present. Generated when omitted. */
  token?: string;
  /** Absolute directory holding the built web client. */
  staticDir: string;
  /** How to start tau. */
  tau?: TauProcessOptions;
  /** Where log lines go. */
  onLog?: (line: string) => void;
}

export interface RunningServer {
  url: string;
  token: string;
  host: string;
  port: number;
  hub: Hub;
  close(): Promise<void>;
}

/** A URL-safe token with 192 bits of entropy. */
export function generateToken(): string {
  return randomBytes(24).toString('hex');
}

/**
 * Start the connection server.
 *
 * A token is ALWAYS required, at every bind address including loopback. The
 * alternative -- no auth on 127.0.0.1 -- is defensible right up until the bind
 * address becomes a flag, and then it is a hole that opened without anyone
 * changing the auth code. One rule is easier to reason about than a rule with
 * an exception whose condition is a command-line argument.
 */
export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const bind = options.bind ?? '127.0.0.1';
  const port = options.port ?? 8791;
  const token = options.token ?? generateToken();
  const log = options.onLog ?? ((line: string) => console.log(line));

  const hub = new Hub(options.tau ?? {}, log);
  const sockets = new WebSocketServer({ noServer: true });

  const httpServer = createHttpServer({
    token,
    staticRoot: { dir: options.staticDir },
    allowedOrigins: allowedOriginsFor(bind, port),
    onUpgrade: (request, socket, head) => {
      sockets.handleUpgrade(request, socket, head, (ws) => attach(ws));
    },
  });

  function attach(ws: WebSocket): void {
    const client = hub.attach({
      send: (line: string) => {
        if (ws.readyState === ws.OPEN) ws.send(line);
      },
      close: (code: number, reason: string) => ws.close(code, reason),
    });
    ws.on('message', (data) => hub.fromClient(client.id, data.toString()));
    ws.on('close', () => hub.detach(client.id));
    ws.on('error', (error) => {
      log(`client ${client.id} socket error: ${error.message}`);
      hub.detach(client.id);
    });
  }

  await new Promise<void>((resolvePromise, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, bind, () => {
      httpServer.off('error', reject);
      resolvePromise();
    });
  });

  const address = httpServer.address() as AddressInfo;
  const host = bind === '0.0.0.0' || bind === '::' ? '127.0.0.1' : bind;
  const shown = host.includes(':') ? `[${host}]` : host;
  const url = `http://${shown}:${address.port}/?token=${token}`;

  return {
    url,
    token,
    host,
    port: address.port,
    hub,
    close: async () => {
      sockets.close();
      await hub.stop();
      await new Promise<void>((resolvePromise) => httpServer.close(() => resolvePromise()));
    },
  };
}

function allowedOriginsFor(bind: string, port: number): Set<string> {
  const hosts = new Set<string>();
  const add = (host: string): void => {
    hosts.add(`${host}:${port}`);
  };
  add('127.0.0.1');
  add('localhost');
  add('[::1]');
  if (bind !== '0.0.0.0' && bind !== '::' && bind !== '127.0.0.1') {
    add(bind.includes(':') ? `[${bind}]` : bind);
  }
  return hosts;
}
