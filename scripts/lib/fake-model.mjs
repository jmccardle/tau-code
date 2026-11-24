/**
 * A fake vision model for the smokes (protocol 2, τ's D30): an OpenAI-compatible chat-completions
 * server on loopback that answers its first request with a call to τ's `read` on a file, and every
 * later one with text, and a PNG for it to read. τ's config for it:
 *
 *   { default_model: 'v', models: { v: { model: 'm', base_url: fake.url, images: true } } }
 */
import { createServer } from 'node:http';

/** A 1x1 PNG. */
export function png() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );
}

/**
 * A chat-completions server that answers its first request with a call to `read` on `path`, and
 * every later one with text. It keeps the bodies it is sent.
 */
export async function fakeModel(path) {
  const bodies = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
        // τ may probe the server (e.g. GET /v1/models); this fake has nothing to say.
        res.writeHead(404).end();
        return;
      }
      bodies.push(JSON.parse(raw));
      const first = bodies.length === 1;
      const delta = first
        ? { tool_calls: [{ index: 0, id: 'c0', type: 'function', function: { name: 'read', arguments: JSON.stringify({ path }) } }] }
        : { role: 'assistant', content: 'a single pixel' };
      const chunk = { id: 'x', model: 'm', choices: [{ index: 0, delta, finish_reason: first ? 'tool_calls' : 'stop' }] };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/v1`, bodies, close: () => server.close() };
}
