#!/usr/bin/env node
/**
 * TC-04: the protocol package against a real `tau serve --no-unix` (the HTTP edge alone), with
 * the mock model in a throwaway TAU_HOME. Run after `npm run build`:
 *
 *   TAU_BIN=/path/to/venv/bin/tau npm run smoke
 *
 * It checks, in order: the edge refuses a wrong token (401) and a foreign origin (403); `hello`'s
 * snapshot arrives before its answer; `watch` then `send` streams `Live` text, then `Appended`,
 * then the cursor at rest with `ending` Done; `walk` holds the reply; a second client, through
 * `SessionLink`, sees the same session and can read the whole tree; and `tau serve --stop` ends
 * the first client's stream with `end {error: null}`.
 *
 * Then, protocol 3 (τ 0.18, D31): the mock model, which takes no images, refuses a `send` with one
 * (`Refused`, nothing queued); a `tau serve` whose mock model has `images: true` takes a `send` with
 * an image's bytes, appends a `User {text, images}`, echoes the image, gives its bytes back with
 * `image`, takes it again by `sha256`, and refuses bad base64, too many images and an unknown name.
 *
 * Then, protocol 2's images (τ 0.17, D30): a `tau serve` whose model is a fake OpenAI-compatible
 * server here, with `images: true`. It answers the first request with a call to τ's `read` on a
 * PNG, and the next with text. The `Results` node must reach the client as `Ok {value, images}`,
 * and `outcomeOf` must give its text and its image (type, size, sha256).
 */
import assert from 'node:assert/strict';
import {
  EdgeError,
  HttpTransport,
  PROTOCOL,
  ServeClient,
  SessionLink,
  ServeError,
  SessionModel,
  bodyKind,
  imageLabel,
  outcomeOf,
  proseText,
  userOf,
} from '../packages/protocol/dist/index.js';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeModel, png } from './lib/fake-model.mjs';
import { serve, until } from './lib/serve.mjs';

const served = await serve();
const { url, token, session } = served.record;
let failed = false;
try {
  assert.equal(served.record.socket, undefined, '--no-unix: the record names no socket');
  console.log(`τ ${served.record.version} serving ${session} at ${url}`);

  // Refusals.
  await assert.rejects(HttpTransport.open({ url, token: 'wrong' }), (e) => e instanceof EdgeError && e.kind === 'unauthorized');
  const foreign = await fetch(new URL('stream', url), {
    headers: { Authorization: `Bearer ${token}`, Origin: 'http://evil.example' },
  });
  assert.equal(foreign.status, 403, 'a foreign Origin is refused');
  console.log('ok: a wrong token is 401, a foreign origin 403');

  // Client A, by hand: hello's snapshot first.
  const a = new ServeClient(await HttpTransport.open({ url, token }));
  const order = [];
  const events = [];
  const model = new SessionModel();
  a.on('event', (event) => {
    order.push(`event:${event.kind}`);
    events.push(event);
    model.hear(event);
  });
  let closedA = null;
  a.on('closed', (reason, end) => (closedA = { reason, end }));
  const welcome = await a.hello('smoke@tau-code:a');
  order.push('hello');
  model.welcome = welcome;
  assert.equal(welcome.protocol, PROTOCOL);
  assert.equal(welcome.session, session);
  assert.deepEqual(
    order,
    ['event:Commands', 'event:CursorView', 'event:Labels', 'hello'],
    'the snapshot comes before hello answers, Commands first and Labels last',
  );
  const cursor = model.openCursors()[0].cursor;
  console.log(`ok: hello after its snapshot (Commands first); cursor ${cursor} at node ${model.views.get(cursor).at}`);

  // D32: the stream's Commands is what commands() answers, so a client never polls it.
  assert.deepEqual(model.commands, await a.call('commands', {}), 'Commands holds exactly what commands() returns');
  assert.ok(model.commands.some((form) => form.name === 'model'), 'and it names the built-in commands');
  console.log(`ok: Commands holds the ${model.commands.length} command forms commands() returns`);

  // D32 section 8: models() answers the catalog, and the followed cursor's model is one of it.
  const catalog = await a.call('models', {});
  const current = catalog.find((m) => m.name === model.views.get(cursor).model);
  assert.ok(current, 'the cursor\'s model is in the catalog');
  assert.ok(catalog.every((m) => 'images' in m && 'context_window' in m && 'price' in m), 'every field is sent');
  console.log(`ok: models() lists ${catalog.length} (${current.name}: context ${current.context_window}, images ${current.images === null ? 'no' : 'yes'})`);

  // D32: completions are items, `{value, label?, detail?}`, not strings.
  const items = await a.call('complete_line', { cursor, line: '/mo' });
  assert.ok(items.length > 0 && items.every((item) => typeof item.value === 'string'), 'complete_line answers items');
  assert.ok(items.some((item) => item.value === '/model' && typeof item.detail === 'string'), '/model, with its detail');
  const cursors = await a.call('complete', { cursor, named: 'cursor', prefix: '' });
  assert.ok(cursors.length > 0 && cursors.every((item) => typeof item.value === 'string'), 'complete answers items');
  assert.ok(cursors.some((item) => typeof item.detail === 'string'), 'a cursor says where it is, in its detail');
  console.log(`ok: complete_line('/mo') and complete(cursor) answer items (${JSON.stringify(cursors[0])})`);

  // A turn, watched.
  await a.call('watch', { cursors: [cursor] });
  events.length = 0;
  const item = await a.call('send', { cursor, text: 'hello from the smoke' });
  assert.equal(typeof item, 'number');
  let sawBusy = false;
  await until(() => {
    const view = model.views.get(cursor);
    sawBusy ||= view.busy;
    return sawBusy && !view.busy;
  }, 'the step to end');
  const text = events
    .filter((e) => e.kind === 'Live' && e.delta.kind === 'TextDelta')
    .map((e) => e.delta.text)
    .join('');
  assert.equal(text, 'mock: hello from the smoke', 'Live streamed the reply');
  const firstLive = events.findIndex((e) => e.kind === 'Live');
  const reply = events.findIndex(
    (e) => e.kind === 'Appended' && e.nodes.some((n) => bodyKind(n.body) === 'Assistant'),
  );
  assert.ok(firstLive >= 0 && reply > firstLive, 'Live came before the Appended reply');
  const view = model.views.get(cursor);
  assert.equal(view.ending, 'Done');
  assert.equal(model.layers.has(cursor), false, 'at rest: no live layer');
  console.log(`ok: Live "${text}", then Appended, then at rest (ending Done, at ${view.at})`);

  const walk = await a.call('walk', { id: view.at });
  const last = walk.at(-1);
  assert.equal(bodyKind(last.body), 'Assistant');
  assert.equal(proseText(last.body.Assistant.parts[0].Text), 'mock: hello from the smoke');
  assert.ok(walk.some((n) => n.body.User === 'hello from the smoke'));
  console.log(`ok: walk(${view.at}) holds the input and the reply (${walk.length} nodes)`);

  // Protocol 3: the mock model takes no images, so a send with one is refused, and queues nothing.
  await assert.rejects(
    a.call('send', { cursor, text: 'look', images: [{ data: png().toString('base64') }] }),
    (error) => error instanceof ServeError && error.is('Refused') && /image/.test(error.detail),
  );
  assert.equal(model.views.get(cursor).items.length, 0, 'a refused send queued nothing');
  assert.equal(model.views.get(cursor).at, view.at, 'and moved nothing');
  console.log('ok: a send with an image to a model that takes none is Refused, and queues nothing');

  // Client B, through the link: the same session.
  const b = new SessionLink({ open: () => HttpTransport.open({ url, token }), client: 'smoke@tau-code:b' });
  b.start();
  await until(() => b.state.phase === 'ready', 'client b to be ready');
  assert.equal(b.state.welcome.session, session);
  assert.deepEqual(b.state.model.views.get(cursor).at, view.at, 'b sees the same cursor');
  await until(() => b.state.model.walk(view.at) !== null, 'b to read its walk');
  await b.loadTree();
  assert.equal(b.state.model.nodes.size, view.at + 1, 'the whole tree, read in pages');
  console.log(`ok: a second client sees cursor ${cursor} at ${view.at} and reads ${b.state.model.nodes.size} nodes`);

  // The server stops: a's stream ends with end {error: null}.
  b.dispose();
  await served.stop();
  await until(() => closedA !== null, "a's stream to end");
  assert.deepEqual(closedA.end, { error: null });
  assert.equal(closedA.reason, 'the server stopped');
  console.log('ok: tau serve --stop ends the stream with end {error: null}');
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  await served.stop().catch((error) => {
    failed = true;
    console.error(error);
  });
}
if (!failed) failed = !(await userImages());
if (!failed) failed = !(await images());
if (failed) process.exit(1);
console.log('smoke: green');

/**
 * Protocol 3: a user's images. The mock model with `images: true` takes them and echoes them as
 * `[1 image: image/png 1x1]`. True when green.
 */
async function userImages() {
  const picture = png();
  const data = picture.toString('base64');
  const sha256 = createHash('sha256').update(picture).digest('hex');
  let served = null;
  try {
    served = await serve({
      config: { default_model: 'mock', models: { mock: { model: 'mock', provider: 'mock', images: true, options: { delay_ms: 1 } } } },
    });
    const { url, token } = served.record;
    const client = new ServeClient(await HttpTransport.open({ url, token }));
    const sessionModel = new SessionModel();
    const appended = [];
    client.on('event', (event) => {
      sessionModel.hear(event);
      if (event.kind === 'Appended') appended.push(...event.nodes);
    });
    sessionModel.welcome = await client.hello('smoke@tau-code:user-images');
    const cursor = sessionModel.openCursors()[0].cursor;
    const replies = () => appended.filter((n) => bodyKind(n.body) === 'Assistant' && n.body.Assistant.stop === 'End');

    // The bytes, sent: a User node with its text and image, and the mock's echo of it.
    await client.call('send', { cursor, text: 'what is this', images: [{ data }] });
    await until(() => replies().length === 1, 'the reply to an image', 20_000);
    const user = appended.find((n) => bodyKind(n.body) === 'User');
    const image = { mime: 'image/png', sha256, width: 1, height: 1 };
    assert.deepEqual(user.body.User, { text: 'what is this', images: [image] });
    assert.deepEqual(userOf(user.body.User), { text: 'what is this', images: [image] });
    assert.equal(proseText(replies()[0].body.Assistant.parts[0].Text), 'mock: what is this\n[1 image: image/png 1x1]');
    console.log(`ok: send with an image: User {text, images: [${imageLabel(image)}]}, echoed by the mock`);

    // Its bytes back, by name; and sent again by name alone, with no text.
    assert.equal(await client.call('image', { sha256 }), data, 'image(sha256) gives the bytes back');
    await client.call('send', { cursor, text: '', images: [{ sha256 }] });
    await until(() => replies().length === 2, 'the reply to an image by name', 20_000);
    assert.equal(proseText(replies()[1].body.Assistant.parts[0].Text), 'mock: \n[1 image: image/png 1x1]');
    const walk = await client.call('walk', { id: sessionModel.views.get(cursor).at });
    assert.equal(walk.filter((n) => bodyKind(n.body) === 'User' && userOf(n.body.User).images.length === 1).length, 2, 'walk agrees');
    console.log('ok: image(sha256) gives the bytes back; an image sent again by sha256, alone');

    // Refusals: each one queues nothing.
    const refused = async (images, name, why) => {
      await assert.rejects(
        client.call('send', { cursor, text: 'x', images }),
        (error) => error instanceof ServeError && error.is(name),
        why,
      );
      assert.equal(sessionModel.views.get(cursor).items.length, 0, `${why}: nothing queued`);
    };
    await refused([{ data: data.replace(/=+$/, '') }], 'InvalidParams', 'base64 without its padding');
    await refused([{ data: Buffer.from('not an image').toString('base64') }], 'InvalidParams', 'bytes that are no image');
    await refused([{ data, sha256 }], 'InvalidParams', 'both data and sha256');
    await refused(Array.from({ length: 21 }, () => ({ sha256 })), 'InvalidParams', '21 images');
    await refused([{ sha256: 'f'.repeat(64) }], 'NotFound', 'an unknown sha256');
    await assert.rejects(client.call('image', { sha256: 'f'.repeat(64) }), (error) => error instanceof ServeError && error.is('NotFound'));
    console.log('ok: bad base64, no image, both fields, 21 images: InvalidParams; an unknown sha256: NotFound');
    client.close();
    return true;
  } catch (error) {
    console.error(error);
    return false;
  } finally {
    if (served) await served.stop().catch((error) => console.error(error));
  }
}

/** Protocol 2: a tool result with an image reaches the client whole. True when green. */
async function images() {
  const picture = png();
  const sha256 = createHash('sha256').update(picture).digest('hex');
  const model = await fakeModel('pixel.png');
  let served = null;
  try {
    served = await serve({
      config: { default_model: 'v', models: { v: { model: 'm', base_url: model.url, images: true } } },
    });
    writeFileSync(join(served.work, 'pixel.png'), picture);
    const { url, token } = served.record;
    const client = new ServeClient(await HttpTransport.open({ url, token }));
    const sessionModel = new SessionModel();
    const appended = [];
    client.on('event', (event) => {
      sessionModel.hear(event);
      if (event.kind === 'Appended') appended.push(...event.nodes);
    });
    sessionModel.welcome = await client.hello('smoke@tau-code:images');
    const cursor = sessionModel.openCursors()[0].cursor;
    await client.call('watch', { cursors: [cursor] });
    await client.call('send', { cursor, text: 'look at pixel.png' });
    await until(() => appended.some((n) => bodyKind(n.body) === 'Assistant' && n.body.Assistant.stop === 'End'), 'the reply after the read', 20_000);

    const results = appended.find((n) => bodyKind(n.body) === 'Results');
    assert.ok(results, 'a Results node was appended');
    const [callId, outcome] = results.body.Results[0];
    assert.equal(callId, 'c0');
    assert.equal(typeof outcome.Ok, 'object', `Ok carries images: ${JSON.stringify(outcome)}`);
    const { ok, text, images: got } = outcomeOf(outcome);
    assert.equal(ok, true);
    assert.match(text, /^\[image .*pixel\.png: image\/png 1x1, \d+ bytes\]$/);
    assert.deepEqual(got, [{ mime: 'image/png', sha256, width: 1, height: 1 }]);
    assert.equal(imageLabel(got[0]), '[image 1x1 image/png]');
    const sent = JSON.stringify(model.bodies[1]);
    assert.ok(sent.includes('image_url'), 'τ sent the image on to the model');
    const walk = await client.call('walk', { id: sessionModel.views.get(cursor).at });
    assert.deepEqual(outcomeOf(walk.find((n) => bodyKind(n.body) === 'Results').body.Results[0][1]).images, got, 'walk agrees');
    console.log(`ok: protocol 2 image in a tool result: "${text}" + ${imageLabel(got[0])} sha256 ${sha256.slice(0, 12)}…`);
    client.close();
    return true;
  } catch (error) {
    console.error(error);
    return false;
  } finally {
    model.close();
    if (served) await served.stop().catch((error) => console.error(error));
  }
}
