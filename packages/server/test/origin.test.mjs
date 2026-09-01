import { test } from 'node:test';
import assert from 'node:assert/strict';

import { originAllowed } from '../dist/http.js';

/** The parts of an IncomingMessage this check reads. */
const request = (headers) => ({ headers });

test('a same-origin browser connection is allowed', () => {
  assert.equal(
    originAllowed(request({ host: '127.0.0.1:8791', origin: 'http://127.0.0.1:8791' })),
    true,
  );
});

test('a published container port is same-origin, whatever the server listens on', () => {
  // `docker run -p 8799:8791` -- the browser dialled 8799, the server listens on
  // 8791, and the Host header carries the port the browser used. Comparing the
  // origin to the LISTEN port refused the page the server had just served.
  assert.equal(
    originAllowed(request({ host: '127.0.0.1:8799', origin: 'http://127.0.0.1:8799' })),
    true,
  );
});

test('a reverse proxy that preserves Host is same-origin', () => {
  assert.equal(
    originAllowed(request({ host: 'tau.example.com', origin: 'https://tau.example.com' })),
    true,
  );
});

test('another site is refused', () => {
  assert.equal(
    originAllowed(request({ host: '127.0.0.1:8791', origin: 'https://evil.example' })),
    false,
  );
});

test('the same host on another port is refused', () => {
  assert.equal(
    originAllowed(request({ host: '127.0.0.1:8791', origin: 'http://127.0.0.1:9999' })),
    false,
  );
});

test('no Origin is not a browser, and is allowed', () => {
  // curl, the VS Code extension host, a test. None of them had the ambient
  // authority this check exists to remove.
  assert.equal(originAllowed(request({ host: '127.0.0.1:8791' })), true);
});

test('an unparseable Origin is refused', () => {
  assert.equal(originAllowed(request({ host: '127.0.0.1:8791', origin: 'not a url' })), false);
});

test('an Origin with no Host to compare against is refused', () => {
  assert.equal(originAllowed(request({ origin: 'http://127.0.0.1:8791' })), false);
});
