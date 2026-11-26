/**
 * The composer's image tray (protocol 3, τ's D31): what a paste, a drop or the picker adds, the
 * limits checked before anything is sent, a remove, and a refused send that keeps the tray. The
 * component over them is driven in a real browser by `npm run smoke:browser`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ServeError } from '@ffwf/tau-code-protocol';
import {
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  MAX_REQUEST_BYTES,
  attach,
  base64,
  detach,
  filesOf,
  imageInputs,
  rememberedImage,
  rememberImage,
  rows,
  randomId,
  sendImages,
  sha256Hex,
  sniff,
  trayProblem,
  treeLines,
} from '../dist/index.js';
import { SessionModel } from '@ffwf/tau-code-protocol';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const GIF = Buffer.from('R0lGODlhAQABAAAAACw=', 'base64');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const file = (bytes, name) => new File([bytes], name);
/** A file that claims `size` bytes without holding them: the size check runs before any read. */
const huge = (name, size) => ({ name, size, arrayBuffer: () => Promise.reject(new Error('read a file over the limit')) });

test('sniff reads the four formats τ reads, by their bytes', () => {
  assert.equal(sniff(PNG), 'image/png');
  assert.equal(sniff(GIF), 'image/gif');
  assert.equal(sniff(JPEG), 'image/jpeg');
  assert.equal(sniff(WEBP), 'image/webp');
  assert.equal(sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
  assert.equal(sniff(Buffer.from('RIFF\0\0\0\0WAVE')), null);
  assert.equal(sniff(new Uint8Array()), null);
});

test('base64 is standard and padded, and holds up at the 20 MiB limit', () => {
  for (const bytes of [PNG, GIF, Buffer.from([1]), Buffer.from([1, 2]), Buffer.alloc(0)]) {
    assert.equal(base64(bytes), bytes.toString('base64'));
  }
  // Bytes that differ along their length, so a slice padded in the middle cannot pass.
  const big = Buffer.alloc(MAX_IMAGE_BYTES);
  for (let i = 0; i < big.length; i++) big[i] = (i * 7) & 0xff;
  assert.ok(base64(big) === big.toString('base64'), 'a 20 MiB image encodes as Buffer does');
});

test('a paste and a drop hand over their files; none for text', () => {
  const a = file(PNG, 'a.png');
  assert.deepEqual(filesOf({ files: [a] }), [a]); // clipboardData
  assert.deepEqual(filesOf({ files: { length: 1, 0: a } }), [a]); // a FileList-like dataTransfer
  assert.deepEqual(filesOf({ files: [] }), []);
  assert.deepEqual(filesOf(null), []);
});

test('attach: each image with its bytes, hash and data: URL; the tray given is not changed', async () => {
  const empty = [];
  const { tray, problems } = await attach(empty, [file(PNG, 'pixel.png'), file(GIF, '')]);
  assert.deepEqual(problems, []);
  assert.equal(empty.length, 0);
  assert.deepEqual(
    tray.map(({ name, mime, bytes, sha256 }) => ({ name, mime, bytes, sha256 })),
    [
      { name: 'pixel.png', mime: 'image/png', bytes: PNG.length, sha256: sha(PNG) },
      { name: 'pasted image', mime: 'image/gif', bytes: GIF.length, sha256: sha(GIF) },
    ],
  );
  assert.equal(tray[0].data, PNG.toString('base64'));
  assert.equal(tray[0].url, `data:image/png;base64,${PNG.toString('base64')}`);
  assert.notEqual(tray[0].id, tray[1].id);
  assert.deepEqual(imageInputs(tray), [{ data: PNG.toString('base64') }, { data: GIF.toString('base64') }]);
});

test('remove takes one image out by its id, whatever its name', async () => {
  const { tray } = await attach([], [file(PNG, 'same'), file(GIF, 'same')]);
  const left = detach(tray, tray[0].id);
  assert.deepEqual(left.map((image) => image.mime), ['image/gif']);
  assert.equal(tray.length, 2, 'the tray given is not changed');
});

test('limits: not an image, over 20 MiB, over 20 images, the same image twice', async () => {
  const notImage = await attach([], [file(Buffer.from('hello'), 'notes.txt')]);
  assert.deepEqual(notImage.problems, ['notes.txt is not a png, jpeg, gif or webp image']);
  assert.equal(notImage.tray.length, 0);

  const tooBig = await attach([], [huge('big.png', MAX_IMAGE_BYTES + 1)]);
  assert.deepEqual(tooBig.problems, ['big.png is 20.0 MiB: an image may be at most 20.0 MiB']);

  // Twenty-one different PNGs (a trailing byte each changes the hash, not the format).
  const many = Array.from({ length: MAX_IMAGES + 1 }, (_, i) => file(Buffer.concat([PNG, Buffer.from([i])]), `${i}.png`));
  const full = await attach([], many);
  assert.equal(full.tray.length, MAX_IMAGES);
  assert.deepEqual(full.problems, ['20.png not attached: a message carries at most 20 images']);

  const twice = await attach([], [file(PNG, 'a.png'), file(PNG, 'b.png')]);
  assert.equal(twice.tray.length, 1);
  assert.deepEqual(twice.problems, ['b.png is attached already']);
});

test('limits: the images together must fit one request to the HTTP edge (64 MiB, else a 413)', async () => {
  // Three 16 MiB images are 64 MiB of base64: the third does not fit.
  const big = (i) => {
    const bytes = Buffer.alloc(16 * 1024 * 1024);
    PNG.copy(bytes);
    bytes[PNG.length] = i;
    return file(bytes, `big${i}.png`);
  };
  const { tray, problems } = await attach([], [big(0), big(1), big(2)]);
  assert.equal(tray.length, 2);
  assert.match(problems[0], /^big2\.png not attached: with it the message would be over the 64\.0 MiB one request may carry/);
  assert.equal(trayProblem('hi', tray), null);
  // A line long enough to tip it over is refused at send, before the request is made.
  assert.match(trayProblem('x'.repeat(8 * 1024 * 1024), tray), /over the 64\.0 MiB one request may carry/);
  assert.ok(MAX_REQUEST_BYTES === 64 * 1024 * 1024);
});

test('images go with a message or alone, never with a /command', async () => {
  const { tray } = await attach([], [file(PNG, 'a.png')]);
  assert.equal(trayProblem('look', tray), null);
  assert.equal(trayProblem('', tray), null);
  assert.match(trayProblem('/model v', tray), /^images go with a message, not a \/command/);
  assert.equal(trayProblem('/model v', []), null, 'a command with no images is the line as ever');
});

test('a send carries the images and says which went; each is remembered by its hash', async () => {
  const { tray } = await attach([], [file(PNG, 'a.png'), file(GIF, 'b.gif')]);
  const calls = [];
  const remembered = new Map();
  const gone = await sendImages(
    async (method, params) => {
      calls.push([method, params]);
      return 7;
    },
    3,
    'what is this',
    tray,
    (sha256, url) => remembered.set(sha256, url),
  );
  assert.deepEqual(calls, [['send', { cursor: 3, text: 'what is this', images: imageInputs(tray) }]]);
  assert.deepEqual([...gone], tray.map((image) => image.id));
  assert.equal(remembered.get(sha(PNG)), tray[0].url);
});

test('a refused send throws the server\'s sentence, and the tray is kept whole', async () => {
  const { tray } = await attach([], [file(PNG, 'a.png')]);
  const before = structuredClone(tray);
  const refused = new ServeError('send', {
    code: -32009,
    message: '1 image not sent: the model mock does not take images (set images: true)',
  });
  await assert.rejects(
    sendImages(async () => Promise.reject(refused), 0, 'look', tray, () => {}),
    (error) => error === refused && /the model mock does not take images/.test(error.message) && error.is('Refused'),
  );
  assert.deepEqual(tray, before);
});

test('the page cache: an image this page sent is found by its hash', () => {
  assert.equal(rememberedImage('f'.repeat(64)), undefined);
  rememberImage('f'.repeat(64), 'data:image/png;base64,AA==');
  assert.equal(rememberedImage('f'.repeat(64)), 'data:image/png;base64,AA==');
});

test('a user message with images (protocol 3): its text and images in the row, a count in the tree', () => {
  const png = { mime: 'image/png', sha256: 'a'.repeat(64), width: 640, height: 480 };
  const node = (id, parent, body) => ({ id, parent, time: 0, by: { Frontend: 'me' }, body, delivers: [] });
  const walk = [
    node(0, null, { User: 'plain' }),
    node(1, 0, { User: { text: 'look', images: [png] } }),
    node(2, 1, { User: { text: '', images: [png, png] } }),
  ];
  const [plain, pictured, alone] = rows(walk, 'me');
  assert.equal(plain.text, 'plain');
  assert.equal('images' in plain, false);
  assert.equal(pictured.text, 'look');
  assert.deepEqual(pictured.images, [png]);
  assert.equal(alone.text, '');
  assert.equal(alone.images.length, 2);
  const model = new SessionModel();
  model.insert(walk);
  assert.deepEqual(
    treeLines(model).map((line) => line.summary),
    ['plain', 'look [1 image]', '[2 images]'],
  );
});

test('the SHA-256 is one implementation, and needs no crypto.subtle (plain http has none)', async () => {
  const digests = [new Uint8Array(0), PNG, Buffer.alloc(100_000, 7)];
  const known = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'; // SHA-256 of nothing
  assert.equal(sha256Hex(digests[0]), known);
  for (const bytes of digests) assert.equal(sha256Hex(bytes), sha(bytes));
  // A page that is not a secure context has `crypto.getRandomValues` but neither `subtle` nor
  // `randomUUID`: attaching and starting must work there.
  const crypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const { getRandomValues } = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues: getRandomValues.bind(globalThis.crypto) } });
  try {
    const { tray, problems } = await attach([], [file(PNG, 'p.png')]);
    assert.deepEqual(problems, []);
    assert.equal(tray[0].sha256, sha(PNG));
    assert.match(randomId(), /^[0-9a-f]{8}$/);
    assert.notEqual(randomId(), randomId());
  } finally {
    Object.defineProperty(globalThis, 'crypto', crypto);
  }
});
