/**
 * Drive the tree browser in real headless Chrome, against a real session.
 *
 * The planner, the fold reader and the mark expansion have unit tests, and
 * `smoke-tree.mjs` drives them over the real wire. What this checks is the layer
 * neither of those reaches: that the rows actually MOUNT, that the keys are
 * bound, that a zone reaches an element's class list, and that the detail pane
 * fills from `get_entry`. Every one of those has been the thing that was broken
 * while the logic underneath was right.
 *
 * Reads only -- no verb that appends is called -- so it costs no API credits and
 * cannot damage the session it is pointed at.
 *
 *   node scripts/smoke-tree-ui.mjs 'http://127.0.0.1:8791/?token=...' [shot.png]
 *
 * Start the server with `--session-dir` pointing at a directory holding a COPY
 * of a real session, filed under this cwd's dashed-path key.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2];
const shot = process.argv[3];
if (!url) throw new Error('usage: node scripts/smoke-tree-ui.mjs <url> [shot.png]');

const profile = mkdtempSync(join(tmpdir(), 'tau-chrome-'));
const chrome = spawn(
  '/usr/bin/google-chrome',
  [
    '--headless=new',
    '--remote-debugging-port=9224',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=1400,1000',
    'about:blank',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);

const cleanup = () => {
  try {
    chrome.kill('SIGKILL');
  } catch {}
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
};

let passed = 0;
let failed = 0;
function check(label, ok, detail = '') {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
}

async function waitForDevtools() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9224/json/version');
      if (res.ok) return (await res.json()).webSocketDebuggerUrl;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Chrome did not open a DevTools endpoint.');
}

let ws;
try {
  const browserWs = await waitForDevtools();
  const { WebSocket } = await import('ws');
  ws = new WebSocket(browserWs, { maxPayload: 256 * 1024 * 1024 });
  await new Promise((res, rej) => {
    ws.on('open', res);
    ws.on('error', rej);
  });

  let id = 0;
  const pending = new Map();
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id === undefined) return;
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? p?.reject(new Error(JSON.stringify(msg.error))) : p?.resolve(msg.result);
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Page.navigate', { url }, sessionId);
  await new Promise((r) => setTimeout(r, 4000));

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      sessionId,
    );
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? 'threw');
    return result.value;
  };

  const click = async (selector) => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);
    await new Promise((r) => setTimeout(r, 900));
  };

  const key = async (name, code, vk, modifiers = 0) => {
    for (const type of ['keyDown', 'keyUp']) {
      await send(
        'Input.dispatchKeyEvent',
        { type, key: name, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers },
        sessionId,
      );
    }
    await new Promise((r) => setTimeout(r, 350));
  };

  // ── land on a real session ──────────────────────────────────────────
  console.log('\n=== opening a session ===');
  // The BIGGEST session, not the first: the server creates a fresh empty one at
  // startup and it sorts to the top. Landing on it and reporting OK is exactly
  // what this script did on its first run -- every check passed against a
  // one-entry tree, which is the failure a picked-by-position fixture always
  // eventually becomes.
  // The picker opens on its own only when the session is empty. This server
  // keeps one tau child across connections, so a previous run may have left it
  // on a real session -- open the picker rather than depending on the landing.
  if (!(await evaluate(`!!document.querySelector('.tau-session-row')`))) {
    await evaluate(
      `[...document.querySelectorAll('.tau-status-button')].find(b => b.textContent === 'Sessions')?.click()`,
    );
    await new Promise((r) => setTimeout(r, 1500));
  }
  const rows = JSON.parse(
    await evaluate(`JSON.stringify([...document.querySelectorAll('.tau-session-row')]
      .map((r, index) => ({
        index,
        text: r.textContent,
        messages: Number((r.textContent.match(/(\\d+) msg/) ?? [0, 0])[1]),
      })))`),
  );
  const biggest = rows.slice().sort((a, b) => b.messages - a.messages)[0];
  if (!biggest || biggest.messages === 0) {
    throw new Error(
      `no session in the picker has any messages: ${JSON.stringify(rows.map((r) => r.text))}. ` +
        `Point the server's --session-dir at a directory holding a COPY of a real session, ` +
        `filed under this cwd's dashed-path key.`,
    );
  }
  console.log(`  picking row ${biggest.index}: ${biggest.messages} messages`);
  await evaluate(
    `document.querySelectorAll('.tau-session-row')[${biggest.index}].click()`,
  );
  await new Promise((r) => setTimeout(r, 2500));

  const entries = await evaluate(`document.querySelectorAll('.tau-entry').length`);
  check('the transcript filled from get_messages', entries > 0, `${entries} entries`);

  // ── open the tree ───────────────────────────────────────────────────
  console.log('\n=== the tree browser ===');
  const treeButton = await evaluate(
    `!![...document.querySelectorAll('.tau-status-button')].find(b => b.textContent === 'Tree')`,
  );
  check('the status bar offers a Tree control', treeButton === true);
  await evaluate(
    `[...document.querySelectorAll('.tau-status-button')].find(b => b.textContent === 'Tree')?.click()`,
  );
  await new Promise((r) => setTimeout(r, 1500));

  const view = JSON.parse(
    await evaluate(`JSON.stringify({
      open: !!document.querySelector('.tau-tree'),
      head: document.querySelector('.tau-tree .tau-panel-head .tau-muted')?.textContent ?? null,
      rows: document.querySelectorAll('.tau-tree-row').length,
      cursorRows: document.querySelectorAll('.tau-tree-row-cursor').length,
      current: document.querySelectorAll('.tau-tree-current').length,
      tags: [...new Set([...document.querySelectorAll('.tau-tree-tag')].map(t => t.textContent))],
      zones: [...new Set([...document.querySelectorAll('.tau-tree-row')]
        .flatMap(r => [...r.classList].filter(c => c.startsWith('tau-zone-'))))],
      twists: [...document.querySelectorAll('.tau-tree-twist')].filter(t => t.textContent.trim() !== '').length,
      keys: document.querySelector('.tau-tree-keys')?.textContent ?? null,
      pane: !!document.querySelector('.tau-tree-pane'),
      paneBoxes: document.querySelectorAll('.tau-tree-detail').length,
      notice: document.querySelector('.tau-tree .tau-notice')?.textContent ?? null,
    })`),
  );

  check('the browser opened', view.open, view.notice ?? '');
  check('it says how many entries it read', /entries/.test(view.head ?? ''), view.head ?? '');
  check('rows mounted', view.rows > 0, `${view.rows} rows`);
  check('exactly one row is the cursor', view.cursorRows === 1);
  check('the current row is marked as such', view.current === 1);
  check('the type tag is drawn per row', view.tags.length > 1, view.tags.join(' '));
  check('a zone class reached the rows', view.zones.length > 0, view.zones.join(' '));
  check('folds have a twist control', view.twists > 0, `${view.twists} foldable rows`);
  check('the key line is one row', (view.keys ?? '').includes('Space mark'), view.keys ?? '');

  // ── the detail pane ─────────────────────────────────────────────────
  console.log('\n=== the detail pane ===');
  check('the pane is beside the tree', view.pane === true);
  check('it filled from get_entry', view.paneBoxes > 0, `${view.paneBoxes} boxes`);
  const paneText = await evaluate(
    `document.querySelector('.tau-tree-detail-selected .tau-pre')?.textContent ?? ''`,
  );
  check('the selected node has a body, not an ellipsis', paneText.length > 1 && paneText !== '…',
    JSON.stringify(paneText.slice(0, 60)));

  // ── keys ────────────────────────────────────────────────────────────
  console.log('\n=== keys ===');
  check(
    'the panel takes focus as it opens, so the arrows work without a click first',
    (await evaluate(`document.activeElement?.classList.contains('tau-tree') === true`)) === true,
  );
  const before = await evaluate(
    `document.querySelector('.tau-tree-row-cursor')?.textContent ?? ''`,
  );
  // UP, not down: the browser opens on the session cursor, which is the tip of
  // the conversation and therefore the LAST visible row. Pressing down there
  // correctly does nothing, and a test that pressed it would be asserting the
  // clamp rather than the movement.
  await key('ArrowUp', 'ArrowUp', 38);
  const after = await evaluate(
    `document.querySelector('.tau-tree-row-cursor')?.textContent ?? ''`,
  );
  check('up moves the cursor', before !== after, `${before.slice(0, 30)} -> ${after.slice(0, 30)}`);
  await key('ArrowDown', 'ArrowDown', 40);
  check(
    'and down comes back to it',
    (await evaluate(`document.querySelector('.tau-tree-row-cursor')?.textContent ?? ''`)) === before,
  );

  await key(' ', 'Space', 32);
  const marks = JSON.parse(
    await evaluate(`JSON.stringify({
      marked: document.querySelectorAll('.tau-zone-marked').length,
      readout: document.querySelector('.tau-tree-readout div')?.textContent ?? '',
      offer: document.querySelector('.tau-tree-offer')?.textContent ?? '',
    })`),
  );
  check('space marks the row', marks.marked > 0, `${marks.marked} marked`);
  check('the readout counts them and says estimate', /estimate/.test(marks.readout), marks.readout);
  check('the offer line says what the next key would do', marks.offer.length > 0, marks.offer);

  await key('d', 'KeyD', 68, 2);
  const folded = await evaluate(`!!document.querySelector('.tau-tree-pane-marker')`);
  check('ctrl+D folds the detail pane away', folded === true);
  await key('d', 'KeyD', 68, 2);
  check('and brings it back', (await evaluate(`!!document.querySelector('.tau-tree-pane')`)) === true);

  if (shot) {
    const { data } = await send(
      'Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: false },
      sessionId,
    );
    writeFileSync(shot, Buffer.from(data, 'base64'));
    console.log(`\nscreenshot: ${shot}`);
  }

  // ── escape closes without changing anything ─────────────────────────
  await key('Escape', 'Escape', 27);
  check('escape closes the browser', (await evaluate(`!!document.querySelector('.tau-tree')`)) === false);

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}  ${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
} catch (error) {
  console.error('\nFAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  try {
    ws?.close();
  } catch {}
  cleanup();
}
