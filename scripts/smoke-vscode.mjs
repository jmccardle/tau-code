#!/usr/bin/env node
/**
 * The packaged extension in a real VSCodium, driven as a person would. Run after
 * `npm run package:vsix` (or `npm run package --workspace packages/vscode`):
 *
 *   npm run smoke:vscode        # CODIUM=/path/to/electron-binary, VSIX=…, TAU_BIN=… to choose
 *
 * What it does:
 *
 * 1. installs the .vsix with `codium --install-extension` into a throwaway extensions dir, with a
 *    throwaway user-data dir (no one's own profile is touched; EDITOR_DIR=… to choose where);
 * 2. starts VSCodium under Xvfb (`xvfb-run`; set `XVFB=0` to use $DISPLAY) on a throwaway folder,
 *    with TAU_HOME a throwaway τ home whose models are τ's mock and a fake vision model
 *    (scripts/lib/fake-model.mjs), and a remote-debugging port this attaches to with Playwright;
 * 3. runs "tau: Open Agent" from the command palette. The extension host starts `tau serve -d`
 *    for the folder (τ from TAU_BIN, else PATH) and relays its HTTP edge to the webview;
 * 4. in the webview: a message and its streamed reply (the chat round trip); `/model v`, then a
 *    message whose reply reads a PNG, so a tool result carries an image (protocol 2) and the row
 *    labels it `[image 1x1 image/png]`; and before that, two images (protocol 3), one picked and
 *    one pasted into the webview, sent through the relay, drawn in their row, echoed by the mock;
 * 5. "Developer: Reload Window": the tab comes back on the same session (webview state), with
 *    the conversation;
 * 6. "tau: Restart This Session's tau Server": a new server (new pid and token) for the same
 *    session, and the tab reconnects to it.
 *
 * With RUNTIME_VSIX=…/ffwf-tau-runtime-<version>-<target>.vsix it installs the runtime companion
 * too and sets `tau-code.runtime` to `bundled`, so the server is the payload's τ.
 *
 * With STALE_RUNTIME_VSIX=…/ffwf-tau-runtime-0.8.1-linux-x64.vsix (the last runtime before 0.9.0:
 * τ 0.14.1, protocol 1, which the marketplaces keep serving on the targets 0.9.0 dropped), or a 0.9.x
 * runtime (τ 0.17.1, protocol 2: what a user has installed when tau code 0.10 arrives), it checks
 * the refusal instead, and stops there: the runtime is installed beside the τ on PATH with
 * `tau-code.runtime` left at `auto`, so the stale runtime is chosen; "tau: Open Agent" must start
 * no server and say, in the page and in a notification, which τ it found, what it needs and how
 * to fix it, naming the τ on PATH that would work.
 *
 * The bearer token never reaches the page: the page's own requests are checked for it.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { fakeModel, png, pngOf } from './lib/fake-model.mjs';
import { mockConfig, TAU_BIN } from './lib/serve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const VSIX = process.env['VSIX'] ?? join(ROOT, `ffwf-tau-code-${VERSION}.vsix`);
const CODIUM_CLI = process.env['CODIUM_CLI'] ?? '/usr/bin/codium';
const CODIUM = process.env['CODIUM'] ?? '/usr/share/codium/codium';
const XVFB = process.env['XVFB'] !== '0';
// With RUNTIME_VSIX, the runtime companion (ffwf.tau-runtime) is installed too, and the extension
// is set to use only it (`tau-code.runtime: bundled`); TAU_BIN is not passed.
const RUNTIME_VSIX = process.env['RUNTIME_VSIX'] ?? null;
const STALE_RUNTIME_VSIX = process.env['STALE_RUNTIME_VSIX'] ?? null;
if (RUNTIME_VSIX && STALE_RUNTIME_VSIX) throw new Error('set RUNTIME_VSIX or STALE_RUNTIME_VSIX, not both');
for (const [what, path, hint] of [
  ['.vsix', VSIX, 'run `npm run package:vsix` first, or set VSIX'],
  ['VSCodium CLI', CODIUM_CLI, 'set CODIUM_CLI to its `codium` script'],
  ['VSCodium binary', CODIUM, 'set CODIUM to its Electron binary'],
]) {
  if (!existsSync(path)) throw new Error(`no ${what} at ${path}: ${hint}`);
}

const steps = [];
const step = (text) => {
  steps.push(text);
  console.log(`ok: ${text}`);
};

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** τ's console script, absolute, so the editor's environment finds the same one. */
function tauPath() {
  if (TAU_BIN.includes('/')) return TAU_BIN;
  return execFileSync('sh', ['-c', `command -v ${TAU_BIN}`], { encoding: 'utf8' }).trim();
}

// τ's Unix socket is `$TAU_HOME/serve/<session>.sock`, at most 107 bytes, so the τ home lives in a
// short temp dir. The editor's dirs can go elsewhere (EDITOR_DIR), as long as they are throwaway.
const root = mkdtempSync(join(tmpdir(), 'tau-code-smoke-vscode-'));
const editorRoot = process.env['EDITOR_DIR'] ? mkdtempSync(join(process.env['EDITOR_DIR'], 'smoke-vscode-')) : root;
const userData = join(editorRoot, 'user-data');
const extensions = join(editorRoot, 'extensions');
const home = join(root, 'tau-home');
const work = join(root, 'work');
for (const dir of [userData, extensions, home, work, join(userData, 'User')]) mkdirSync(dir, { recursive: true });
chmodSync(home, 0o700);
writeFileSync(join(work, 'pixel.png'), png());
writeFileSync(
  join(userData, 'User', 'settings.json'),
  JSON.stringify({
    'security.workspace.trust.enabled': false,
    'workbench.startupEditor': 'none',
    'workbench.tips.enabled': false,
    'update.mode': 'none',
    'extensions.autoCheckUpdates': false,
    'extensions.autoUpdate': false,
    'telemetry.telemetryLevel': 'off',
    'window.restoreWindows': 'all',
    // A modal in the page, where Playwright can click it, not a native GTK dialog.
    'window.dialogStyle': 'custom',
    ...(RUNTIME_VSIX ? { 'tau-code.runtime': 'bundled' } : {}),
  }),
);

const model = await fakeModel('pixel.png');
const config = mockConfig();
config.models.v = { model: 'm', base_url: model.url, images: true };
// τ's mock takes images when its model says so (D31), and echoes them: `[2 images: ...]`.
config.models.mock.images = true;
writeFileSync(join(home, 'config.json'), JSON.stringify(config));

const tau = tauPath();
const env = {
  HOME: process.env['HOME'],
  PATH: process.env['PATH'],
  USER: process.env['USER'],
  LANG: process.env['LANG'] ?? 'C.UTF-8',
  TAU_HOME: home,
  // TAU_BIN is an explicit choice and would beat any runtime; for the stale check, τ goes on PATH.
  ...(RUNTIME_VSIX || STALE_RUNTIME_VSIX ? {} : { TAU_BIN: tau }),
  ...(STALE_RUNTIME_VSIX ? { PATH: `${dirname(tau)}:${process.env['PATH']}` } : {}),
  // VSCodium puts its instance socket here when it is set, else in --user-data-dir, where a long
  // temp path passes the 107-byte socket limit. The socket's name is a hash of the user-data dir.
  ...(process.env['XDG_RUNTIME_DIR'] ? { XDG_RUNTIME_DIR: process.env['XDG_RUNTIME_DIR'] } : {}),
  ...(XVFB ? {} : { DISPLAY: process.env['DISPLAY'] }),
};

let codium = null;
let browser = null;
let failed = false;
const tokens = new Set();
const problems = [];

/** Every serve record in the throwaway τ home: `{session, pid, token, …}`. */
function records() {
  const dir = join(home, 'serve');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')));
}

/** The extension's log (its "tau" output channel), for a failure. */
function extensionLog() {
  const found = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/tau\.log$/.test(name) && path.includes('ffwf.tau-code')) found.push(path);
    }
  };
  walk(join(userData, 'logs'));
  return found.map((path) => `--- ${path}\n${readFileSync(path, 'utf8')}`).join('\n');
}

async function launch(port) {
  const args = [
    '--user-data-dir', userData,
    '--extensions-dir', extensions,
    `--remote-debugging-port=${port}`,
    '--disable-gpu',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-workspace-trust',
    '--new-window',
    work,
  ];
  const [command, all] = XVFB
    ? ['xvfb-run', ['-a', '-s', '-screen 0 1600x1000x24', CODIUM, ...args]]
    : [CODIUM, args];
  const child = spawn(command, all, { env, detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => (stderr += chunk));
  child.on('exit', (code) => {
    if (code && !failed) console.error(`VSCodium exited ${code}:\n${stderr.slice(-2000)}`);
  });
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`VSCodium did not open its debugging port:\n${stderr.slice(-2000)}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return child;
}

/** The workbench page: the one with the command palette. */
async function workbench() {
  const deadline = Date.now() + 60_000;
  for (;;) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (await page.locator('.monaco-workbench').count().catch(() => 0)) return page;
      }
    }
    if (Date.now() > deadline) throw new Error('no workbench window appeared');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * Run a command from the palette, by its title. The palette lists the commands registered when it
 * opens and does not refresh, so one opened before the extension's contributions are in never
 * shows them: it is closed and opened again until the command is there, for up to a minute.
 */
async function command(page, title) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    await page.keyboard.press('F1');
    const input = page.locator('.quick-input-widget input.input');
    await input.waitFor();
    await input.fill(`>${title}`);
    const row = page.locator('.quick-input-list .monaco-list-row', { hasText: title }).first();
    try {
      await row.waitFor({ timeout: 5_000 });
      break;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await page.keyboard.press('Escape');
    }
  }
  await page.keyboard.press('Enter');
}

/** The webview frame that holds the tau app. */
async function tauFrame(page, ms = 60_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    for (const frame of page.frames()) {
      if (!frame.url().startsWith('vscode-webview:')) continue;
      if (await frame.locator('.tau-app').count().catch(() => 0)) return frame;
    }
    if (Date.now() > deadline) throw new Error('no tau webview appeared');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function watch(page) {
  page.on('console', (message) => {
    if (message.type() === 'error' && /vscode-webview/.test(message.location().url ?? '')) {
      problems.push(`webview console: ${message.text()}`);
    }
  });
  page.on('request', (request) => {
    if (!request.url().startsWith('vscode-webview:') && !request.frame()?.url().startsWith('vscode-webview:')) return;
    const text = `${request.url()} ${JSON.stringify(request.headers())} ${request.postData() ?? ''}`;
    for (const token of tokens) if (text.includes(token)) problems.push(`the page sent the bearer token: ${request.url()}`);
  });
}

/** Thrown to end the run after the stale-runtime check. */
const STOP = Symbol('stop');

/** The stale runtime is refused: no server, and the reason in the page and a notification. */
async function stale(page) {
  const frame = await tauFrame(page);
  // Any runtime before this protocol: 0.8.1 (τ 0.14.1, protocol 1) or 0.9.x (τ 0.17.1, protocol 2).
  const stalePhrase = /speaks protocol [12]\b/;
  const said = frame.locator('.tau-app', { hasText: stalePhrase });
  await said.waitFor({ timeout: 60_000 });
  const text = await said.innerText();
  for (const expected of [
    /tau 0\.1[47]\.1 from the tau runtime extension \(linux-x64, Python [\d.]+\) speaks protocol [12]/,
    new RegExp(`tau code ${VERSION.replace(/\./g, '\\.')} speaks protocol 3, which needs tau 0\\.18\\.0 or newer`),
    /from tau on PATH does speak protocol 3/,
    /"tau-code\.runtime" to "system"/,
    // linux-x64 is a released target, so the fix includes updating the runtime.
    /Update it from the Extensions view: ffwf\.tau-runtime [\d.]+ for linux-x64/,
  ]) {
    assert.match(text, expected);
  }
  step(`the page says: ${/tau 0\.1[47]\.1[^\n]*/.exec(text)?.[0]}`);
  const toast = page.locator('.notification-toast', { hasText: stalePhrase });
  try {
    await toast.first().waitFor({ timeout: 30_000 });
  } catch (error) {
    const shown = await page.locator('.notification-toast').allInnerTexts();
    throw new Error(`no notification about the stale protocol; the toasts: ${JSON.stringify(shown)}`, { cause: error });
  }
  await toast.getByRole('button', { name: 'Choose Which tau' }).first().waitFor();
  step('a notification says the same, with "Choose Which tau"');
  assert.deepEqual(records(), [], 'no server was started');
  step('no tau serve was started');
}

async function say(frame, text) {
  const box = frame.getByLabel('message');
  await box.fill(text);
  await box.press('Enter');
}

try {
  const companion = RUNTIME_VSIX ?? STALE_RUNTIME_VSIX;
  for (const vsix of [VSIX, ...(companion ? [companion] : [])]) {
    execFileSync(CODIUM_CLI, ['--user-data-dir', userData, '--extensions-dir', extensions, '--install-extension', vsix], {
      env,
      stdio: 'pipe',
    });
  }
  const installed = readdirSync(extensions).filter((name) => name.startsWith('ffwf.tau-'));
  assert.equal(installed.length, companion ? 2 : 1, `the ffwf.tau-* extensions in ${extensions}: ${installed.join(', ')}`);
  step(`installed ${installed.join(' and ')} into a throwaway extensions dir`);

  const port = await freePort();
  codium = await launch(port);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  let page = await workbench();
  watch(page);
  step(`VSCodium ${XVFB ? 'under Xvfb ' : ''}opened ${work}`);

  await command(page, 'tau: Open Agent');
  if (STALE_RUNTIME_VSIX) {
    await stale(page);
    throw STOP;
  }
  let frame = await tauFrame(page);
  await frame.locator('.tau-status-ready').waitFor({ timeout: 60_000 });
  const [first] = records();
  assert.ok(first, 'the extension started a tau serve in the throwaway τ home');
  tokens.add(first.token);
  assert.equal(first.cwd, work, 'the server runs in the workspace folder');
  assert.equal(first.protocol, 3);
  if (RUNTIME_VSIX) {
    const command = readFileSync(`/proc/${first.pid}/cmdline`, 'utf8').split('\0').join(' ');
    assert.ok(command.startsWith(join(extensions, 'ffwf.tau-runtime-')), `the server is the runtime's: ${command}`);
    step(`the server is the runtime companion's interpreter: ${command.split(' ')[0]}`);
  }
  assert.match(await frame.locator('.tau-status').innerText(), new RegExp(`tau ${first.version.replace(/\./g, '\\.')}`));
  step(`"tau: Open Agent" started tau serve ${first.version} (protocol 3, pid ${first.pid}) in the folder; the tab is connected`);

  await say(frame, 'hello there');
  await frame.getByTestId('transcript').getByText('mock: hello there').waitFor();
  await frame.getByTestId('step-state').getByText('at rest · done').waitFor();
  step('a message and its streamed reply, through the extension host relay (chat round trip)');

  // Protocol 3: images in a message, through the relay. One picked, one pasted into the webview.
  await frame.getByTestId('image-picker').setInputFiles([{ name: 'wide.png', mimeType: 'image/png', buffer: pngOf(16, 8, (x) => [x * 16, 90, 200]) }]);
  await frame.evaluate((b64) => {
    const data = new DataTransfer();
    data.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'pixel.png'));
    document
      .querySelector('[aria-label="message"]')
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, png().toString('base64'));
  await frame.getByTestId('tray').locator('.tau-tray-item').nth(1).waitFor();
  await say(frame, 'what are these');
  await frame.getByTestId('transcript').getByText(/\[2 images: image\/png 16x8, image\/png 1x1\]/).waitFor();
  const mine = frame.getByTestId('transcript').locator('.tau-row-user', { hasText: 'what are these' });
  assert.equal(await mine.locator('img.tau-thumb').count(), 2, 'the message draws its own images');
  assert.equal(await frame.getByTestId('tray').count(), 0, 'the tray is empty');
  step('two images, picked and pasted in the webview, sent through the relay; drawn, and echoed by the mock');

  await say(frame, '/model v');
  await frame.locator('.tau-status', { hasText: 'model v' }).waitFor();
  await say(frame, 'look at pixel.png');
  await frame.getByTestId('transcript').getByText('a single pixel').waitFor();
  const result = frame.getByTestId('transcript').locator('.tau-row-result');
  await result.locator('.tau-images-count', { hasText: '1 image' }).waitFor();
  await result.locator('summary').click();
  assert.equal(await result.locator('.tau-image').innerText(), '[image 1x1 image/png]');
  assert.ok(model.bodies.some((body) => JSON.stringify(body).includes('image_url')), 'τ sent the image to the model');
  step('/model v, then a tool result with an image: labelled [image 1x1 image/png] (protocol 2)');

  await command(page, 'Developer: Reload Window');
  await new Promise((resolve) => setTimeout(resolve, 2000));
  page = await workbench();
  watch(page);
  frame = await tauFrame(page);
  await frame.locator('.tau-status-ready').waitFor({ timeout: 60_000 });
  await frame.getByTestId('transcript').getByText('a single pixel').waitFor();
  assert.equal(await frame.locator('.tau-status-session').innerText(), first.session);
  assert.equal(records().length, 1, 'no second server: the restored tab reopened the same session');
  step(`a window reload restores the tab on session ${first.session}, conversation and all`);

  await frame.locator('.tau-app').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await command(page, "tau: Restart This Session's tau Server");
  await page.locator('.monaco-dialog-box').getByRole('button', { name: 'Restart' }).click();
  const deadline = Date.now() + 30_000;
  let second;
  for (;;) {
    second = records().find((record) => record.session === first.session && record.pid !== first.pid);
    if (second) break;
    if (Date.now() > deadline) throw new Error(`no new server for ${first.session}: ${JSON.stringify(records())}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  tokens.add(second.token);
  assert.notEqual(second.token, first.token);
  frame = await tauFrame(page);
  await frame.locator('.tau-status-ready').waitFor({ timeout: 60_000 });
  await say(frame, 'after the restart');
  await frame.getByTestId('transcript').getByText('a single pixel').last().waitFor();
  await frame.getByTestId('transcript').getByText('after the restart').waitFor();
  step(`"Restart This Session's tau Server": a new server (pid ${second.pid}, a new token) for the same session; the tab reconnected`);

  for (const each of page.frames().filter((f) => f.url().startsWith('vscode-webview:'))) {
    const html = await each.evaluate(() => document.documentElement.outerHTML).catch(() => '');
    for (const token of tokens) if (html.includes(token)) problems.push(`a bearer token is in the page: ${each.url()}`);
  }
  assert.deepEqual(problems, [], 'no webview console errors, and no token in the page');
  step('no webview console errors (CSP included), and the token never reached the page');
} catch (error) {
  if (error === STOP) {
    // The stale-runtime check ends here, by design.
  } else {
  failed = true;
  console.error(error);
  if (problems.length) console.error(problems);
  console.error(extensionLog());
  }
} finally {
  await browser?.close().catch(() => {});
  if (codium) {
    try {
      process.kill(-codium.pid, 'SIGTERM');
    } catch {
      // gone
    }
  }
  for (const record of records()) {
    try {
      execFileSync(tau, ['serve', '--stop', '--session', record.session], { env, cwd: work, stdio: 'ignore' });
    } catch {
      // already stopped
    }
  }
  model.close();
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (process.env['KEEP'] !== '1') {
    rmSync(root, { recursive: true, force: true });
    rmSync(editorRoot, { recursive: true, force: true });
  } else console.log(`kept ${root} and ${editorRoot}`);
}
if (failed) process.exit(1);
console.log(`smoke:vscode${STALE_RUNTIME_VSIX ? ' (stale runtime)' : ''}: green (${steps.length} checks)`);
