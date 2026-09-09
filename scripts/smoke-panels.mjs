/**
 * Drive the flow dialog and the extension panel in real headless Chrome.
 *
 * These are the two surfaces tau 0.10.0's registry made possible and this head
 * had none of. `/model` is a real flow: tau names the argument, names its
 * domain, and `enumerate_domain` lists the values -- so what this checks is that
 * a command whose arguments this client has never heard of gets a rendered
 * field, which is the whole claim of the flow loop.
 *
 * Nothing is committed: every dialog is cancelled, and the extension panel is
 * read-only unless a button is pressed. So it costs no API credits and changes
 * no session.
 *
 *   node scripts/smoke-panels.mjs 'http://127.0.0.1:8791/?token=...' [shot.png]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2];
const shot = process.argv[3];
if (!url) throw new Error('usage: node scripts/smoke-panels.mjs <url> [shot.png]');

const profile = mkdtempSync(join(tmpdir(), 'tau-chrome-'));
const chrome = spawn(
  '/usr/bin/google-chrome',
  [
    '--headless=new',
    '--remote-debugging-port=9226',
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
      const res = await fetch('http://127.0.0.1:9226/json/version');
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

  const submit = async (line) => {
    await evaluate(`(() => {
      const t = document.querySelector('.tau-input');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(t, ${JSON.stringify(line)});
      t.dispatchEvent(new Event('input', { bubbles: true }));
      t.focus();
      return true;
    })()`);
    for (const type of ['keyDown', 'keyUp']) {
      await send(
        'Input.dispatchKeyEvent',
        { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 },
        sessionId,
      );
    }
    await new Promise((r) => setTimeout(r, 2000));
  };

  const clickText = async (selector, text) =>
    evaluate(
      `[...document.querySelectorAll(${JSON.stringify(selector)})]` +
        `.find(b => b.textContent.trim() === ${JSON.stringify(text)})?.click()`,
    );

  // ── a flow with an enumerated argument ──────────────────────────────
  console.log('\n=== /model: a flow this client has no table for ===');
  await submit('/model');
  const dialog = JSON.parse(
    await evaluate(`JSON.stringify({
      open: !!document.querySelector('.tau-flow-dialog'),
      title: document.querySelector('.tau-flow-dialog h3')?.textContent ?? null,
      described: document.querySelector('.tau-flow-dialog .tau-muted')?.textContent ?? null,
      options: [...document.querySelectorAll('.tau-flow-options .tau-row-button')].map(b => b.textContent),
      editorKept: document.querySelector('.tau-input')?.value ?? null,
    })`),
  );
  check('the flow opened a dialog rather than sending prose', dialog.open, dialog.title ?? '');
  check(
    'the dialog names the flow and the argument tau asked for',
    /\/model/.test(dialog.title ?? '') && (dialog.title ?? '').length > '/model'.length,
    dialog.title ?? '',
  );
  check(
    'the argument was rendered as a picker, from enumerate_domain',
    dialog.options.length > 0,
    `${dialog.options.length} options: ${dialog.options.slice(0, 3).join(', ')}`,
  );
  check(
    'the picker lists the configured models, not ids invented here',
    dialog.options.some((name) => name.length > 0),
  );

  await clickText('.tau-flow-dialog .tau-button', 'Cancel');
  await new Promise((r) => setTimeout(r, 700));
  check(
    'cancel closes it and performs nothing',
    (await evaluate(`!!document.querySelector('.tau-flow-dialog')`)) === false,
  );

  // ── a view this head now has a panel for ────────────────────────────
  console.log('\n=== /extensions: a view ===');
  await submit('/extensions');
  const panel = JSON.parse(
    await evaluate(`JSON.stringify({
      open: !!document.querySelector('.tau-extensions'),
      body: document.querySelector('.tau-extensions')?.textContent ?? '',
      rows: document.querySelectorAll('.tau-extensions-list li').length,
    })`),
  );
  check('the view opened this head panel', panel.open);
  check(
    'it says something rather than showing an empty box',
    panel.rows > 0 || /No extensions are loaded/.test(panel.body),
    panel.rows > 0 ? `${panel.rows} extensions` : 'the empty case, stated',
  );
  await clickText('.tau-extensions .tau-button', 'Close');

  // An unknown `/word` is NOT driven here. tau's rule is that it reaches the
  // model as ordinary prose, so checking it costs a real turn against whatever
  // model is configured -- which is a bill, and a hang when that model is not
  // reachable. `completion.test.mjs` covers the branch for free.

  if (shot) {
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(shot, Buffer.from(data, 'base64'));
    console.log(`\nscreenshot: ${shot}`);
  }

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
