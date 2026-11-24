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
import { streamProxy } from '../dev/serve-record.mjs';

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

/** A fake τ that records each request; a dev server with the proxy in front of it. */
async function setup() {
  const seen = [];
  const tau = createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers });
    req.resume();
    res.writeHead(202);
    res.end();
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
