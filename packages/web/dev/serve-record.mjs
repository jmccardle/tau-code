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

/**
 * Why a request may not use the proxy, or null if it may: its `Host` must be this server's own
 * loopback address on the port it arrived on, and an `Origin`, if any, that address over http.
 */
export function refusal(req) {
  const port = req.socket?.localPort;
  const own = LOOPBACK.map((host) => `${host}:${port}`);
  const host = req.headers.host;
  if (!port || !host || !own.includes(host.toLowerCase())) {
    return `the dev proxy answers only to ${own.join(', ')}, not Host ${JSON.stringify(host ?? null)}`;
  }
  const origin = req.headers.origin;
  if (origin !== undefined && !own.map((name) => `http://${name}`).includes(origin.toLowerCase())) {
    return `the dev proxy refuses Origin ${origin}`;
  }
  return null;
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
      server.middlewares.use(streamProxy(options));
    },
  };
}
