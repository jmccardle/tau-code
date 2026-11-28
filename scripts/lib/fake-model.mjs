/**
 * A fake vision model for the smokes (protocol 2, τ's D30): an OpenAI-compatible chat-completions
 * server on loopback that answers its first request with a call to τ's `read` on a file, and every
 * later one with text, and a PNG for it to read. τ's config for it:
 *
 *   { default_model: 'v', models: { v: { model: 'm', base_url: fake.url, images: true } } }
 */
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';

/** A 1x1 PNG. */
export function png() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );
}

/** CRC-32 (PNG's), written out: `zlib.crc32` is not in every Node >= 20. */
function crc32(bytes) {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

/**
 * A `width` x `height` RGB PNG, each pixel `paint(x, y)` -> [r, g, b]: a real image τ decodes,
 * of any size, for a smoke that needs more than one distinct picture.
 */
export function pngOf(width, height, paint) {
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rows.set(paint(x, y), y * (width * 3 + 1) + 1 + x * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
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
