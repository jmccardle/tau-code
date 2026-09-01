import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import type { Duplex } from 'node:stream';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Constant-time token comparison.
 *
 * `a === b` on a secret leaks its prefix through timing. The cost of doing it
 * properly is one function, so there is no reason to accept the leak.
 */
export function tokenMatches(expected: string, supplied: string | null): boolean {
  if (supplied === null) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(supplied, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Pull a token from `?token=`, `Authorization: token <t>`, or `X-Tau-Token`. */
export function extractToken(request: IncomingMessage): string | null {
  const url = new URL(request.url ?? '/', 'http://placeholder');
  const query = url.searchParams.get('token');
  if (query) return query;

  const header = request.headers['authorization'];
  if (typeof header === 'string') {
    const match = /^(?:token|Bearer)\s+(.+)$/i.exec(header.trim());
    if (match?.[1]) return match[1];
  }

  const custom = request.headers['x-tau-token'];
  if (typeof custom === 'string' && custom) return custom;

  return null;
}

/**
 * Reject a cross-origin browser connection.
 *
 * WebSocket handshakes are NOT subject to the same-origin policy: any page the
 * user has open can open a socket to 127.0.0.1 and, without this, would only
 * need to guess the port. The token already blocks that, but a token can end up
 * in a URL that gets shared or logged, and this is one line of defence that
 * costs nothing.
 *
 * A request with no `Origin` is not a browser and is allowed through -- curl,
 * the VS Code extension host, a test. Those never had the ambient authority
 * this check exists to remove.
 */
export function originAllowed(request: IncomingMessage, allowed: Set<string>): boolean {
  const origin = request.headers['origin'];
  if (typeof origin !== 'string' || origin === '') return true;
  try {
    return allowed.has(new URL(origin).host);
  } catch {
    return false;
  }
}

export interface StaticRoot {
  /** Absolute directory served at `/`. */
  dir: string;
}

/**
 * Serve one file out of `root`, refusing anything that escapes it.
 *
 * The check is on the RESOLVED path, not on the request string: `..` can arrive
 * percent-encoded, doubled, or mixed with separators, and only resolution
 * settles where a path actually points.
 */
export function serveStatic(root: StaticRoot, urlPath: string, response: ServerResponse): void {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const relative = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const candidate = resolve(join(root.dir, relative));

  if (candidate !== root.dir && !candidate.startsWith(root.dir + sep)) {
    response.writeHead(403, { 'content-type': 'text/plain' });
    response.end('Forbidden');
    return;
  }

  let file = candidate;
  if (!existsSync(file) || statSync(file).isDirectory()) {
    file = join(root.dir, 'index.html');
  }
  if (!existsSync(file)) {
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end(
      'No web client build found.\n' +
        'Run `npm run build --workspace @tau-code/web` and start the server again.',
    );
    return;
  }

  response.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  createReadStream(file).pipe(response);
}

export interface HttpServerOptions {
  token: string;
  staticRoot: StaticRoot;
  allowedOrigins: Set<string>;
  onUpgrade: (request: IncomingMessage, socket: Duplex, head: Buffer) => void;
}

export function createHttpServer(options: HttpServerOptions): Server {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://placeholder');

    // A liveness probe that needs no token: it says the server is up and
    // nothing else. Anything that reveals state is behind the token.
    if (url.pathname === '/healthz') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (!tokenMatches(options.token, extractToken(request))) {
      response.writeHead(401, { 'content-type': 'text/plain' });
      response.end(
        'Missing or invalid token.\n\n' +
          'The server prints an authenticated URL on startup. Open that link, or pass\n' +
          '?token=... on the URL, or send an "Authorization: token <token>" header.\n',
      );
      return;
    }

    serveStatic(options.staticRoot, url.pathname, response);
  });

  server.on('upgrade', (request, socket, head) => {
    const reject = (status: string, detail: string): void => {
      socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n${detail}`);
      socket.destroy();
    };
    if (!originAllowed(request, options.allowedOrigins)) {
      reject('403 Forbidden', 'Cross-origin WebSocket connections are refused.');
      return;
    }
    if (!tokenMatches(options.token, extractToken(request))) {
      reject('401 Unauthorized', 'Missing or invalid token.');
      return;
    }
    options.onUpgrade(request, socket, head);
  });

  return server;
}
