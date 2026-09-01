/**
 * Drive the composer's Tab completion in real headless Chrome.
 *
 * The pure logic has unit tests. What this checks is the part unit tests
 * cannot: that a real Tab keypress on a real textarea, in a real React tree,
 * against a real tau over a real WebSocket, produces the popup and rewrites the
 * editor. Every one of those layers has been the thing that was broken before.
 *
 * Sends no prompt, so it costs no API credits.
 *
 *   node scripts/smoke-completion.mjs 'http://127.0.0.1:8794/?token=...'
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2];
if (!url) throw new Error('usage: node scripts/smoke-completion.mjs <url>');

const profile = mkdtempSync(join(tmpdir(), 'tau-chrome-'));
const chrome = spawn(
  '/usr/bin/google-chrome',
  [
    '--headless=new',
    '--remote-debugging-port=9223',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
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
      const res = await fetch('http://127.0.0.1:9223/json/version');
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
  const events = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p?.reject(new Error(JSON.stringify(msg.error))) : p?.resolve(msg.result);
    } else {
      events.push(msg);
    }
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

  const focusEditor = () =>
    evaluate(`(() => { const t = document.querySelector('.tau-input'); t.focus(); return !!t; })()`);

  const clear = () =>
    evaluate(`(() => {
      const t = document.querySelector('.tau-input');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(t, '');
      t.dispatchEvent(new Event('input', { bubbles: true }));
      t.focus();
      return true;
    })()`);

  const type = async (text) => {
    // Real key events, not a value assignment: React's onChange is what builds
    // the state the popup reads, and a direct .value write does not fire it.
    await send('Input.insertText', { text }, sessionId);
    await new Promise((r) => setTimeout(r, 120));
  };

  const tab = async (shift = false) => {
    for (const type of ['keyDown', 'keyUp']) {
      await send(
        'Input.dispatchKeyEvent',
        {
          type,
          key: 'Tab',
          code: 'Tab',
          windowsVirtualKeyCode: 9,
          nativeVirtualKeyCode: 9,
          modifiers: shift ? 8 : 0,
        },
        sessionId,
      );
    }
    await new Promise((r) => setTimeout(r, 400));
  };

  const popup = () =>
    evaluate(`JSON.stringify({
      open: !!document.querySelector('.tau-popup, .tau-popup-empty'),
      empty: !!document.querySelector('.tau-popup-empty'),
      emptyText: document.querySelector('.tau-popup-empty')?.textContent ?? null,
      rows: [...document.querySelectorAll('.tau-popup-row')].map(r => ({
        value: r.querySelector('.tau-popup-value')?.textContent ?? '',
        detail: r.querySelector('.tau-popup-detail')?.textContent ?? '',
        selected: r.classList.contains('tau-popup-selected'),
        unavailable: r.classList.contains('tau-popup-unavailable'),
      })),
      more: document.querySelector('.tau-popup-more')?.textContent ?? null,
      editor: document.querySelector('.tau-input')?.value ?? null,
    })`);

  await focusEditor();

  // ── slash commands ──────────────────────────────────────────────────
  console.log('\n=== /command completion ===');
  await clear();
  await type('/');
  await tab();
  let view = JSON.parse(await popup());
  check('a bare slash opens the popup', view.open, `${view.rows.length} rows`);
  const names = view.rows.map((r) => r.value);
  check('the vocabulary came from get_commands', names.includes('/compact'), names.join(' '));
  const tree = view.rows.find((r) => r.value === '/tree');
  check('a command this head cannot perform is greyed, not hidden', tree?.unavailable === true,
    tree ? tree.detail : 'no /tree row');
  const compact = view.rows.find((r) => r.value === '/compact');
  check('a command it CAN perform is offered normally', compact?.unavailable === false);

  // The FIRST Tab applies candidate 0. There is no separate accept step, so the
  // editor always holds what will be sent.
  const firstPick = view.editor;
  check('the first Tab wrote candidate 0 into the editor', firstPick.trim() === names[0],
    JSON.stringify(firstPick));
  await tab();
  view = JSON.parse(await popup());
  check('a second Tab cycles to the next candidate', view.editor.trim() === names[1],
    `${JSON.stringify(firstPick)} -> ${JSON.stringify(view.editor)}`);
  await tab(true);
  view = JSON.parse(await popup());
  // Reversible only because each candidate is applied to the text as it stood
  // when the popup OPENED, not to the text the previous Tab left behind.
  check('Shift+Tab goes back to exactly the first', view.editor === firstPick,
    JSON.stringify(view.editor));

  await clear();
  await type('/comp');
  await tab();
  view = JSON.parse(await popup());
  check('a prefix narrows to one candidate', view.rows.length === 1 && view.rows[0].value === '/compact',
    view.rows.map((r) => r.value).join(' '));
  check('and completing it fills the word in', view.editor.trim() === '/compact', JSON.stringify(view.editor));

  await clear();
  await type('/zzz');
  await tab();
  view = JSON.parse(await popup());
  check('an unknown slash says it will be sent as text', view.empty, view.emptyText);

  // ── @filenames ──────────────────────────────────────────────────────
  console.log('\n=== @file completion (tau complete_path, protocol 1.4) ===');
  await clear();
  await type('look at @');
  await tab();
  view = JSON.parse(await popup());
  check('a bare @ lists the working directory', view.open && view.rows.length > 0,
    `${view.rows.length} rows, e.g. ${view.rows.slice(0, 3).map((r) => r.value).join(' ')}`);
  check('the listing is tau\'s cwd, not the browser\'s', names.length > 0 &&
    view.rows.some((r) => r.value === '@README.md' || r.value === '@docs/'),
    view.rows.map((r) => r.value).slice(0, 8).join(' '));
  check('directories are marked', view.rows.some((r) => r.detail === 'dir'));
  check('files carry a size', view.rows.some((r) => /\d/.test(r.detail) && r.detail !== 'dir'));
  check('the editor was rewritten with the first candidate', view.editor.startsWith('look at @'),
    JSON.stringify(view.editor));

  await clear();
  await type('@READ');
  await tab();
  view = JSON.parse(await popup());
  check('a prefix narrows the path list', view.rows.every((r) => r.value.startsWith('@READ')),
    view.rows.map((r) => r.value).join(' '));

  await clear();
  await type('@zzzznope');
  await tab();
  view = JSON.parse(await popup());
  check('a path naming nothing says so', view.empty, view.emptyText);

  await clear();
  await type('plain words');
  await tab();
  view = JSON.parse(await popup());
  check('Tab outside a reference opens nothing', !view.open);

  const exceptions = events
    .filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text);
  console.log('\n=== uncaught exceptions ===');
  console.log(exceptions.length ? exceptions.map((c) => '  ' + c).join('\n') : '  none');
  check('no uncaught exceptions', exceptions.length === 0);

  const shot = process.argv[3];
  if (shot) {
    await clear();
    await type('read @');
    await tab();
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(shot, Buffer.from(data, 'base64'));
    console.log(`\nscreenshot: ${shot}`);
  }

  console.log(`\n${passed}/${passed + failed} checks passed.`);
  process.exitCode = failed === 0 ? 0 : 1;
} finally {
  ws?.close();
  cleanup();
}
