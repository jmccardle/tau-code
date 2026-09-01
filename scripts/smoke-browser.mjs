/**
 * Load the tau web client in real headless Chrome and report what the browser
 * saw: console errors, failed requests, and whether the app actually rendered.
 *
 *   node chrome-check.mjs <url>
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2];
if (!url) throw new Error('usage: node chrome-check.mjs <url>');

const profile = mkdtempSync(join(tmpdir(), 'tau-chrome-'));
const chrome = spawn(
  '/usr/bin/google-chrome',
  [
    '--headless=new',
    '--remote-debugging-port=9222',
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

async function waitForDevtools() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9222/json/version');
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
  await send('Log.enable', {}, sessionId);
  await send('Network.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);

  await send('Page.navigate', { url }, sessionId);
  await new Promise((r) => setTimeout(r, 4000));

  const { result } = await send(
    'Runtime.evaluate',
    {
      expression: `JSON.stringify({
        title: document.title,
        rootChildren: document.getElementById('root')?.children.length ?? -1,
        hasApp: !!document.querySelector('.tau-app'),
        status: document.querySelector('.tau-status')?.textContent ?? null,
        statusClass: document.querySelector('.tau-status')?.className ?? null,
        entries: document.querySelectorAll('.tau-entry').length,
        hasComposer: !!document.querySelector('.tau-input'),
        buttons: [...document.querySelectorAll('.tau-button')].map(b => b.textContent),
        bodyText: document.body.innerText.slice(0, 300)
      })`,
      returnByValue: true,
    },
    sessionId,
  );

  const consoleErrors = events
    .filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
    .map((e) => e.params.entry.text);
  const exceptions = events
    .filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text);
  const failed = events
    .filter((e) => e.method === 'Network.loadingFailed')
    .map((e) => e.params.errorText);
  const responses = events
    .filter((e) => e.method === 'Network.responseReceived')
    .map((e) => ({
      status: e.params.response.status,
      type: e.params.response.headers['content-type'] ?? e.params.response.headers['Content-Type'],
      url: e.params.response.url.replace(/\?token=[^&]*/, '?token=REDACTED'),
    }));

  console.log('=== network ===');
  for (const r of responses) console.log(`  ${r.status}  ${r.type ?? '?'}  ${r.url}`);
  console.log('\n=== failed loads ===');
  console.log(failed.length ? failed.map((f) => '  ' + f).join('\n') : '  none');
  console.log('\n=== console errors ===');
  console.log(consoleErrors.length ? consoleErrors.map((c) => '  ' + c).join('\n') : '  none');
  console.log('\n=== uncaught exceptions ===');
  console.log(exceptions.length ? exceptions.map((c) => '  ' + c).join('\n') : '  none');
  console.log('\n=== rendered DOM ===');
  console.log(JSON.stringify(JSON.parse(result.value), null, 2));

  const shot = process.argv[3];
  if (shot) {
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(shot, Buffer.from(data, 'base64'));
    console.log(`\nscreenshot: ${shot}`);
  }

  const ok =
    failed.length === 0 &&
    exceptions.length === 0 &&
    JSON.parse(result.value).hasApp &&
    responses.every((r) => r.status < 400);
  console.log(`\n${ok ? 'PASS' : 'FAIL'}`);
  process.exitCode = ok ? 0 : 1;
} finally {
  ws?.close();
  cleanup();
}
