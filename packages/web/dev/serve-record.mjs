/**
 * Development only: find a running `tau serve` from its serve record, and proxy `/stream` to it
 * with its token. `npm run dev` uses this so the page Vite serves with live reload reaches τ on
 * the page's own origin, as it does when τ serves the page itself; the token never reaches the
 * browser.
 *
 * The proxy holds a token that can run commands, so it is the one thing standing where τ's own
 * Origin check (D29 §3) would: a request whose `Host` is not this dev server's loopback address
 * (a DNS-rebinding page), or that carries an `Origin` other than this dev server's own, is refused
 * with 403 before anything is read or forwarded. `Origin` is passed on to τ as it came, so τ checks
 * it too: run τ with `tau serve --allow-origin http://localhost:5173` (the page's origin).
 *
 * Which server: `$TAU_SERVE` (a session id, an id prefix, a name, or a record file's path), else
 * the only live one in `$TAU_HOME/serve/` (`~/.tau/serve/`). None, or several without
 * `$TAU_SERVE`, is answered 502 with a sentence saying so, which the page shows.
 *
 * Plain Node, no Vite import, so another dev host can reuse it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { request } from 'node:http';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/** The serve record to proxy to; throws a sentence when there is not exactly one. */
export function findRecord({ home = process.env.TAU_HOME ?? join(homedir(), '.tau'), pick = process.env.TAU_SERVE } = {}) {
  if (pick && (isAbsolute(pick) || pick.endsWith('.json'))) return JSON.parse(readFileSync(pick, 'utf8'));
  const dir = join(home, 'serve');
  let files;
  try {
    files = readdirSync(dir).filter((name) => name.endsWith('.json'));
  } catch {
    files = [];
  }
  const live = files
    .map((name) => {
      try {
        return JSON.parse(readFileSync(join(dir, name), 'utf8'));
      } catch {
        return null; // being written, or not a record
      }
    })
    .filter((record) => record && record.url && record.token && alive(record.pid));
  const chosen = pick
    ? live.filter((r) => r.session === pick || r.session.startsWith(pick) || r.name === pick)
    : live;
  if (chosen.length === 1) return chosen[0];
  if (chosen.length === 0) {
    throw new Error(
      pick
        ? `no live tau serve in ${dir} matches TAU_SERVE=${pick}`
        : `no tau serve with an HTTP edge is running (no live record in ${dir}): start one with \`tau serve\``,
    );
  }
  const list = chosen.map((r) => `${r.session}${r.name ? ` (${r.name})` : ''} at ${r.url}`).join('; ');
  throw new Error(`several tau serve are running; set TAU_SERVE to one of: ${list}`);
}

/** The names this dev server answers to on loopback: `localhost`, `127.0.0.1`, `[::1]`. */
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];

/** Whether a peer address is this machine: 127.0.0.0/8, ::1, or 127.x mapped into IPv6. */
export function isLoopbackAddress(address) {
  if (typeof address !== 'string') return false;
  const v4 = address.startsWith('::ffff:') ? address.slice(7) : address;
  return v4.startsWith('127.') || address === '::1';
}

/** Whether a Vite `server.host` binds loopback only: unset (Vite's default, localhost) or a loopback name. */
export function hostIsLoopback(host) {
  if (host === undefined || host === false) return true;
  if (typeof host !== 'string') return false; // true: every address
  return host === 'localhost' || host === '::1' || host === '[::1]' || host.startsWith('127.');
}

/**
 * Why a request may not use the proxy, as a sentence, or null if it may. Three things must hold,
 * since the proxy adds a token that can run commands:
 * - the peer is this machine (its address, not anything it says): a LAN client of a dev server
 *   bound wider than loopback is refused;
 * - its `Host` is this server's loopback name on the port the request arrived on (not a
 *   DNS-rebinding name; a port forward must keep the port number);
 * - its `Origin`, if any, is that address over http.
 */
export function refusal(req) {
  const peer = req.socket?.remoteAddress;
  if (!isLoopbackAddress(peer)) {
    return `the dev proxy serves only this machine, and ${peer ?? 'an unknown address'} is not loopback`;
  }
  const port = req.socket?.localPort;
  const own = LOOPBACK.map((name) => `${name}:${port}`);
  const host = (req.headers.host ?? '').toLowerCase();
  if (!port || !own.includes(host)) {
    const [name, given] = splitHost(host);
    if (port && LOOPBACK.includes(name) && given !== String(port)) {
      return (
        `Host ${host} names port ${given || '80'}, but this dev server listens on ${port}: a port forward ` +
        `must keep the port number (ssh -L ${port}:localhost:${port}, then open http://localhost:${port}/)`
      );
    }
    return `the dev proxy answers only to ${own.join(', ')}, not Host ${JSON.stringify(req.headers.host ?? null)}`;
  }
  const origin = req.headers.origin;
  if (origin !== undefined && !own.map((name) => `http://${name}`).includes(origin.toLowerCase())) {
    return `the dev proxy refuses Origin ${origin}: open the page at http://localhost:${port}/`;
  }
  return null;
}

/** `name:port` (or `[v6]:port`) as [name, port]. */
function splitHost(host) {
  const at = host.lastIndexOf(':');
  if (at === -1 || host.endsWith(']')) return [host, ''];
  return [host.slice(0, at), host.slice(at + 1)];
}

/** Connect middleware: `/stream` and `/stream/<id>` go to the record's URL with its token. */
export function streamProxy(options = {}) {
  return (req, res, next) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/stream' && !path.startsWith('/stream/')) return next();
    const refused = refusal(req);
    if (refused) {
      res.statusCode = 403;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end(refused);
      req.resume();
      return;
    }
    let record;
    try {
      record = findRecord(options);
    } catch (error) {
      res.statusCode = 502;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end(error.message);
      return;
    }
    // `Origin` goes on as it came: τ checks it too (`--allow-origin` the dev page's origin).
    const headers = { ...req.headers, authorization: `Bearer ${record.token}` };
    delete headers.referer;
    delete headers.host;
    const upstream = request(new URL(req.url.slice(1), record.url), { method: req.method, headers }, (answer) => {
      if (answer.statusCode === 403 && req.headers.origin) {
        // τ refused the page's origin. It cannot be changed from here; say what usually causes it.
        answer.resume();
        res.statusCode = 403;
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end(
          `tau serve refused Origin ${req.headers.origin}: start it with --allow-origin ${req.headers.origin} ` +
            `(repeatable: one for each address you open this page by), or open the page by an origin it allows`,
        );
        return;
      }
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    });
    upstream.on('error', (error) => {
      if (res.headersSent) return res.destroy();
      res.statusCode = 502;
      res.end(`tau serve ${record.session} at ${record.url} did not answer: ${error.message}`);
    });
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  };
}

/** The Vite plugin: the proxy, in `vite` (dev) only. */
export function tauServeDev(options = {}) {
  return {
    name: 'tau-serve-dev',
    apply: 'serve',
    configureServer(server) {
      const host = server.config.server.host;
      if (!hostIsLoopback(host)) {
        throw new Error(
          `tau-serve-dev: the dev proxy adds tau serve's token to what it forwards, so it runs only on ` +
            `loopback, and server.host is ${JSON.stringify(host)}. Run \`npm run dev\` without --host; ` +
            `to reach it from elsewhere, forward the same port (ssh -L 5173:localhost:5173).`,
        );
      }
      server.middlewares.use(streamProxy(options));
    },
  };
}
