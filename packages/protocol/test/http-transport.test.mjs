import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EdgeError, HttpTransport, SseParser } from '../dist/index.js';

test('the SSE parser joins data lines, drops comments, and survives any chunking', () => {
  const text =
    'event: connection\r\ndata: abc\r\n\r\n: ping\n\ndata: {"a":\ndata: 1}\n\nid: 7\ndata: x\n\n';
  const whole = new SseParser().feed(text);
  assert.deepEqual(whole, [
    { event: 'connection', data: 'abc' },
    { event: 'message', data: '{"a":\n1}' },
    { event: 'message', data: 'x' },
  ]);
  for (let size = 1; size < 8; size++) {
    const parser = new SseParser();
    const events = [];
    for (let i = 0; i < text.length; i += size) events.push(...parser.feed(text.slice(i, i + size)));
    assert.deepEqual(events, whole, `chunks of ${size}`);
  }
});

/**
 * A fake edge behind a `fetch`: the stream is a ReadableStream this test writes to, and every POST
 * is recorded and answered with `post(body)`'s status.
 */
function edge({ status = 200, type = 'text/event-stream', post = () => 202 } = {}) {
  const encoder = new TextEncoder();
  let controller;
  const posts = [];
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    seen.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {} });
    if ((init.method ?? 'GET') === 'GET') {
      if (status !== 200) return new Response('no', { status });
      const body = new ReadableStream({ start: (c) => (controller = c) });
      return new Response(body, { status, headers: { 'content-type': type } });
    }
    posts.push(JSON.parse(init.body));
    return new Response(null, { status: post(JSON.parse(init.body)) });
  };
  return {
    fetch: fetchImpl,
    posts,
    seen,
    write: (text) => controller.enqueue(encoder.encode(text)),
    end: () => controller.close(),
  };
}

test('open reads the connection id, sends the token, and posts to the stream', async () => {
  const server = edge();
  const opening = HttpTransport.open({ url: 'http://edge.test:3393', token: 't0k', fetch: server.fetch });
  server.write('event: connection\ndata: c1\n\n');
  const transport = await opening;
  assert.equal(transport.id, 'c1');
  assert.equal(server.seen[0].url, 'http://edge.test:3393/stream');
  assert.equal(server.seen[0].headers.Authorization, 'Bearer t0k');

  const messages = [];
  transport.onMessage((message) => messages.push(message));
  server.write('data: {"jsonrpc":"2.0","id":0,"result":null}\n\n: ping\n\n');
  transport.send({ one: 1 });
  transport.send({ two: 2 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(messages, [{ jsonrpc: '2.0', id: 0, result: null }]);
  assert.deepEqual(server.posts, [{ one: 1 }, { two: 2 }], 'in the order sent');
  assert.equal(server.seen[1].url, 'http://edge.test:3393/stream/c1');
  transport.close();
});

test('no token sends no Authorization header (a same-origin proxy adds it)', async () => {
  const server = edge();
  const opening = HttpTransport.open({ url: 'http://edge.test/', token: null, fetch: server.fetch });
  server.write('event: connection\ndata: c1\n\n');
  (await opening).close();
  assert.equal('Authorization' in server.seen[0].headers, false);
});

for (const [status, kind] of [
  [401, 'unauthorized'],
  [403, 'forbidden'],
  [404, 'not-an-edge'],
  [502, 'unreachable'],
]) {
  test(`HTTP ${status} on the stream is EdgeError ${kind}`, async () => {
    const server = edge({ status });
    await assert.rejects(
      HttpTransport.open({ url: 'http://edge.test/', token: 'x', fetch: server.fetch }),
      (error) => error instanceof EdgeError && error.kind === kind && error.retryable === (kind === 'unreachable'),
    );
  });
}

test('a page that is not an event stream is not an edge', async () => {
  const server = edge({ type: 'text/html' });
  await assert.rejects(
    HttpTransport.open({ url: 'http://edge.test/', token: 'x', fetch: server.fetch }),
    (error) => error instanceof EdgeError && error.kind === 'not-an-edge',
  );
});

test('a refused connection is unreachable, and so is silence past the deadline', async () => {
  const refuse = async () => {
    throw new TypeError('fetch failed');
  };
  await assert.rejects(
    HttpTransport.open({ url: 'http://edge.test/', token: 'x', fetch: refuse }),
    (error) => error instanceof EdgeError && error.kind === 'unreachable',
  );
  const server = edge();
  await assert.rejects(
    HttpTransport.open({ url: 'http://edge.test/', token: 'x', fetch: server.fetch, connectMs: 30 }),
    (error) => error instanceof EdgeError && error.kind === 'unreachable' && /connection id/.test(error.message),
  );
});

test('a stream that does not begin with its connection id is not an edge', async () => {
  const server = edge();
  const opening = HttpTransport.open({ url: 'http://edge.test/', token: 'x', fetch: server.fetch });
  server.write('data: {}\n\n');
  await assert.rejects(opening, (error) => error instanceof EdgeError && error.kind === 'not-an-edge');
});

test('the stream ending, a 404 POST, or a bad message each close it once, saying why', async () => {
  const reasons = async (act, options = {}) => {
    const server = edge(options);
    const opening = HttpTransport.open({ url: 'http://edge.test/', token: 'x', fetch: server.fetch });
    server.write('event: connection\ndata: c1\n\n');
    const transport = await opening;
    const closed = [];
    transport.onClose((reason) => closed.push(reason));
    transport.onMessage(() => {});
    act(server, transport);
    await new Promise((resolve) => setTimeout(resolve, 20));
    return closed;
  };
  assert.deepEqual(await reasons((server) => server.end()), ['the server ended the stream']);
  assert.deepEqual(await reasons((_, t) => t.send({}), { post: () => 404 }), [
    'the server has no stream with this id any more',
  ]);
  const [bad] = await reasons((server) => server.write('data: not json\n\n'));
  assert.match(bad, /protocol violation: .*not JSON/);
  const [other] = await reasons((_, t) => t.send({}), { post: () => 500 });
  assert.match(other, /HTTP 500/);
});
