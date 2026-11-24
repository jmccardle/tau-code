/**
 * The dev proxy (`npm run dev`) holds a token that can run commands, so it refuses what τ's own
 * Origin check would: a DNS-rebinding page (a Host that is not this server's loopback address) and
 * a foreign Origin. Here against a fake τ: what reaches it, and what does not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hostIsLoopback, isLoopbackAddress, refusal, streamProxy, tauServeDev } from '../dev/serve-record.mjs';

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

/** A fake τ that records each request; a dev server with the proxy in front of it. */
async function setup({ status = 202 } = {}) {
  const seen = [];
  const tau = createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers });
    req.resume();
    res.writeHead(status);
    res.end(status === 403 ? 'origin not allowed' : undefined);
  });
  const tauPort = await listen(tau);
  const home = mkdtempSync(join(tmpdir(), 'tau-code-proxy-'));
  mkdirSync(join(home, 'serve'));
  const record = { session: 's1', pid: process.pid, url: `http://127.0.0.1:${tauPort}/`, token: 'secret' };
  writeFileSync(join(home, 'serve', 's1.json'), JSON.stringify(record));
  const proxy = streamProxy({ home });
  const dev = createServer((req, res) =>
    proxy(req, res, () => {
      res.writeHead(404);
      res.end();
    }),
  );
  const port = await listen(dev);
  const send = (headers, method = 'POST') =>
    new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: '/stream/abc', method, headers }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('error', reject);
      req.end(method === 'GET' ? undefined : '{}');
    });
  const close = () => {
    tau.close();
    dev.close();
    rmSync(home, { recursive: true, force: true });
  };
  return { seen, port, send, close };
}

test('a request from the dev page reaches τ with the token, and its Origin', async () => {
  const { seen, port, send, close } = await setup();
  try {
    const answer = await send({ Host: `localhost:${port}`, Origin: `http://localhost:${port}` });
    assert.equal(answer.status, 202);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, '/stream/abc');
    assert.equal(seen[0].headers.authorization, 'Bearer secret');
    assert.equal(seen[0].headers.origin, `http://localhost:${port}`, 'τ checks the Origin too');
    assert.equal((await send({ Host: `127.0.0.1:${port}` }, 'GET')).status, 202, 'no Origin: a same-origin GET');
  } finally {
    close();
  }
});

test('a DNS-rebinding Host is refused before anything reaches τ', async () => {
  const { seen, port, send, close } = await setup();
  try {
    const answer = await send({ Host: `evil.example:${port}`, Origin: `http://evil.example:${port}` });
    assert.equal(answer.status, 403);
    assert.match(answer.body, /answers only to localhost/);
    assert.equal((await send({ Host: `localhost:${port + 1}` })).status, 403, 'another port is another server');
    assert.equal(seen.length, 0);
  } finally {
    close();
  }
});

test('a foreign Origin is refused, even with the right Host', async () => {
  const { seen, port, send, close } = await setup();
  try {
    const answer = await send({ Host: `localhost:${port}`, Origin: 'http://evil.example' });
    assert.equal(answer.status, 403);
    assert.match(answer.body, /refuses Origin http:\/\/evil.example/);
    assert.equal((await send({ Host: `localhost:${port}`, Origin: `https://localhost:${port}` })).status, 403);
    assert.equal(seen.length, 0);
  } finally {
    close();
  }
});

/** A request as `refusal` sees it. */
const req = (remoteAddress, host, origin) => ({
  socket: { remoteAddress, localPort: 5173 },
  headers: { host, ...(origin ? { origin } : {}) },
});

test('a peer that is not this machine is refused, whatever Host it claims', () => {
  assert.match(refusal(req('192.168.1.5', 'localhost:5173')), /serves only this machine, and 192.168.1.5 is not loopback/);
  assert.match(refusal(req('::ffff:10.0.0.2', 'localhost:5173')), /not loopback/);
  assert.equal(refusal(req('127.0.0.1', 'localhost:5173')), null);
  assert.equal(refusal(req('::ffff:127.0.0.1', '127.0.0.1:5173')), null);
  assert.equal(refusal(req('::1', '[::1]:5173', 'http://[::1]:5173')), null);
  assert.deepEqual(['127.8.0.1', '::1', '::ffff:127.0.0.1', '10.0.0.1', '::ffff:192.168.0.1', undefined].map(isLoopbackAddress), [
    true,
    true,
    true,
    false,
    false,
    false,
  ]);
});

test('a port forward that changes the port is told to keep it', () => {
  const said = refusal(req('127.0.0.1', 'localhost:8080'));
  assert.match(said, /names port 8080, but this dev server listens on 5173/);
  assert.match(said, /ssh -L 5173:localhost:5173/);
});

test('the proxy is not installed unless Vite binds loopback only, and says why', () => {
  const install = (host) => {
    const used = [];
    tauServeDev().configureServer({ config: { server: { host } }, middlewares: { use: (m) => used.push(m) } });
    return used.length;
  };
  assert.equal(install(undefined), 1);
  assert.equal(install('127.0.0.1'), 1);
  assert.equal(install('localhost'), 1);
  for (const host of [true, '0.0.0.0', '192.168.1.5', '::']) {
    assert.throws(() => install(host), /runs only on loopback.*without --host/s, String(host));
  }
  assert.equal(hostIsLoopback(false), true);
});

test("τ refusing the page's origin is explained: --allow-origin, once per address", async () => {
  const { port, send, close } = await setup({ status: 403 });
  try {
    const answer = await send({ Host: `127.0.0.1:${port}`, Origin: `http://127.0.0.1:${port}` });
    assert.equal(answer.status, 403);
    assert.match(answer.body, new RegExp(`tau serve refused Origin http://127.0.0.1:${port}: start it with --allow-origin`));
    assert.match(answer.body, /repeatable/);
  } finally {
    close();
  }
});
