#!/usr/bin/env node
/**
 * The web client in headless Chrome, served by a real `tau serve --web-root packages/web/dist`
 * (no Node at run time), with the mock model and three small extensions in a throwaway TAU_HOME.
 * Run after `npm run build`:
 *
 *   TAU_BIN=/path/to/venv/bin/tau npm run smoke:browser      # CHROME=/path/to/chrome to choose
 *
 * What it drives, as a person would: the paste URL (`#token=` read, kept, removed from the
 * address); a message and its reply; a question answered, and one declined; a question raced by
 * two tabs (the late tab sees it in its snapshot, and sees it close); a command (`/flood`) asked
 * for its missing argument through its form; `/config tuner` from its options form; auto-step off
 * and on; the tree, a cursor opened at a node, closed, and reopened; a label set and removed; a
 * reload (the tab's token); a page with no token. Then, against a second `tau serve` whose model is
 * a fake vision model (scripts/lib/fake-model.mjs), a tool result with an image (protocol 2): the
 * row says it holds one, and labels it as τ does. Any console error (a CSP refusal, say) fails it.
 *
 * `WEB_ROOT=installed` drives the client τ finds installed beside it (ffwf-tau-web, the package
 * `tau_web`) instead: no `--web-root`, and the build is not needed. `npm run smoke:web-wheel`
 * checks first that the installed one is this checkout's.
 */
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { fakeModel, png } from './lib/fake-model.mjs';
import { serve } from './lib/serve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
if (![undefined, 'installed'].includes(process.env['WEB_ROOT'])) throw new Error(`WEB_ROOT is 'installed' or unset`);
const INSTALLED = process.env['WEB_ROOT'] === 'installed';
const DIST = join(ROOT, 'packages/web/dist');
const WEB_ROOT = INSTALLED ? null : DIST;
const CHROME = process.env['CHROME'] ?? '/usr/bin/google-chrome';
if (!INSTALLED && !existsSync(join(DIST, 'index.html'))) throw new Error(`${DIST} has no index.html: run npm run build first`);
if (!existsSync(CHROME)) throw new Error(`no Chrome at ${CHROME}: set CHROME to a Chrome or Chromium binary`);

// A question before each sample, answered "yes" to go on.
const GATE = `
from typing import Literal

class Gate:
    name = "gate"

    async def pre_sample(self, cursor, subject):
        verdict = await cursor.ask("run the thing?", Literal["yes", "no"])
        return None if verdict == "yes" else f"verdict: {verdict}"

extensions = [Gate()]
`;
// Options, for /config.
const TUNER = `
from dataclasses import dataclass
from typing import Literal

class Tuner:
    name = "tuner"

    @dataclass(frozen=True)
    class Options:
        depth: int = 2
        loud: bool = False
        mode: Literal["fast", "slow"] = "fast"

    options = Options

extensions = [Tuner()]
`;
// A command with two arguments, which tells every client.
const FLOOD = `
from tau import Cursor

class Flood:
    name = "flood"

    def __init__(self):
        self.commands = (self.flood,)

    async def flood(self, cursor: Cursor, count: int, text: str) -> str:
        """Tell every client \`text\`, \`count\` times."""
        for _ in range(count):
            cursor.tell(text)
        return "flooded"

extensions = [Flood()]
`;

const served = await serve({ extensions: { gate: GATE, tuner: TUNER, flood: FLOOD }, webRoot: WEB_ROOT });
const { url, token } = served.record;
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const problems = [];
const steps = [];
const step = (text) => {
  steps.push(text);
  console.log(`ok: ${text}`);
};

const pages = [];
/** A page at `address`, its console errors collected. `refused`: the page is expected to get a 401. */
async function tab(context, address, { refused = false } = {}) {
  const page = await context.newPage();
  pages.push(page);
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (refused && /status of 401/.test(message.text())) return;
    problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  await page.goto(address);
  return page;
}

/** Type a line in the composer and press Enter. */
async function say(page, text) {
  const box = page.getByLabel('message');
  await box.fill(text);
  await box.press('Enter');
}

const transcript = (page) => page.getByTestId('transcript');
const question = (page) => page.getByTestId('questions').locator('.tau-question');
const stepState = (page) => page.getByTestId('step-state');

let failed = false;
try {
  const context = await browser.newContext();
  const a = await tab(context, `${url}#token=${token}`);

  // The token: read, kept in the tab, gone from the address.
  await a.locator('.tau-status-ready').waitFor();
  assert.equal(new URL(a.url()).hash, '', 'the token is gone from the address bar');
  assert.equal(await a.evaluate(() => sessionStorage.getItem('tau.token')), token);
  await a.locator('[data-cursor="0"]').waitFor();
  step('the paste URL connects; the token moved from the address to the tab');

  // A message, a question answered, the reply.
  await say(a, 'hello there');
  await question(a).waitFor();
  assert.match(await question(a).innerText(), /gate asks[\s\S]*run the thing\?/);
  await question(a).getByLabel('yes').check();
  await question(a).getByRole('button', { name: 'answer' }).click();
  await transcript(a).getByText('mock: hello there').waitFor();
  await stepState(a).getByText('at rest · done').waitFor();
  assert.equal(await question(a).count(), 0, 'the answered question closed');
  step('a message, its question answered from the choices, then the reply; at rest, done');

  // A command with a missing argument, through its form.
  await say(a, '/flood 2');
  const dialog = a.locator('.tau-dialog');
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /missing: text/);
  await dialog.locator('#args-text').fill('hi from flood');
  await dialog.getByRole('button', { name: 'run' }).click();
  await a.getByTestId('notices').getByText('/flood:flood: flooded').waitFor();
  assert.equal(await a.getByTestId('notices').getByText('hi from flood').count(), 2);
  step('/flood 2 asked for its missing text, ran, and its tells arrived as notices');

  // Tab completion of a command name.
  await a.getByLabel('message').fill('/tun');
  await a.getByLabel('message').press('Tab');
  await a.locator('.tau-completions').waitFor({ state: 'detached', timeout: 2000 }).catch(() => {});
  const completed = await a.getByLabel('message').inputValue();
  await a.getByLabel('message').fill('');
  // `/tun` finishes nothing (tuner has no command); `/flo` finishes `/flood`.
  await a.getByLabel('message').fill('/flo');
  await a.getByLabel('message').press('Tab');
  await a.waitForFunction(() => document.querySelector('[aria-label="message"]').value === '/flood ');
  await a.getByLabel('message').fill('');
  step(`Tab completes a command name ('/flo' to '/flood'; '/tun' stays '${completed}')`);

  // /config tuner: the options form, set.
  await say(a, '/config tuner');
  await dialog.waitFor();
  await dialog.locator('#options-depth').fill('4');
  await dialog.getByLabel('slow').check();
  await dialog.getByRole('button', { name: 'set' }).click();
  await a.getByTestId('notices').getByText('/config tuner: set').waitFor();
  await say(a, '/config tuner');
  await dialog.waitFor();
  assert.equal(await dialog.locator('#options-depth').inputValue(), '4', 'the form shows the value set');
  await dialog.getByRole('button', { name: 'cancel' }).click();
  step('/config tuner shows its options form; a set value reads back');

  // A second tab arrives while a question is open: it sees it, and sees it close when A answers.
  await say(a, 'second');
  await question(a).waitFor();
  const b = await tab(context, url, { refused: true }); // no fragment, and a new tab's storage is empty
  await b.locator('[data-testid="connection"]').waitFor();
  assert.match(await b.innerText('body'), /This tab has no token for this server/);
  await b.close();
  const context2 = await browser.newContext();
  const late = await tab(context2, `${url}#token=${token}`);
  await question(late).waitFor();
  step('a late tab sees the open question in its snapshot');
  await question(a).getByLabel('yes').check();
  await question(a).getByRole('button', { name: 'answer' }).click();
  await transcript(late).getByText('mock: second').waitFor();
  assert.equal(await question(late).count(), 0, 'the late tab saw it close');
  step('answered in one tab, closed in the other; both show the reply');
  step('a page with no token says how to get one');

  // Declined: the step halts.
  await say(a, 'third');
  await question(a).waitFor();
  await question(a).getByRole('button', { name: 'decline' }).click();
  await stepState(a).getByText('halted: verdict: None').waitFor();
  step('a declined question halts the step, and the controls say so');

  // Auto-step off: the cursor steps only when told (Step); Abort stops a busy step.
  // The box shows the server's state, not the click's: click, then wait for the cursor view.
  const auto = a.locator('.tau-step input[type="checkbox"]');
  const setAuto = async (on) => {
    if ((await auto.isChecked()) !== on) await auto.click();
    await a.locator('.tau-step').getByText(on ? 'auto-step on' : 'auto-step off').waitFor();
  };
  await setAuto(false);
  await a.locator('.tau-step').getByRole('button', { name: 'step' }).click();
  await question(a).waitFor();
  await stepState(a).getByText('working').waitFor();
  await a.locator('.tau-step').getByRole('button', { name: 'abort' }).click();
  await stepState(a).getByText('at rest · aborted').waitFor();
  assert.equal(await question(a).count(), 0, 'abort declined the open question');
  await setAuto(true);
  await question(a).waitFor();
  await question(a).getByRole('button', { name: 'decline' }).click();
  await stepState(a).getByText(/halted/).waitFor();
  step('auto-step off: step runs one step, abort stops it; auto-step on wakes the cursor');

  // The tree: open a cursor at the first input, close it, reopen it; label and unlabel.
  await a.getByRole('button', { name: 'tree' }).click();
  const tree = a.getByTestId('tree');
  await tree.locator('.tau-tree-line', { hasText: /#\d+\s+hello there/ }).click();
  await tree.getByRole('button', { name: 'open a cursor here' }).click();
  await a.locator('[data-cursor="1"]').waitFor();
  assert.equal(await a.locator('.tau-tab.tau-selected [data-cursor="1"]').count(), 1, 'the new cursor is followed');
  await transcript(a).getByText('hello there').waitFor();
  assert.equal(await transcript(a).getByText('mock: hello there').count(), 0, 'its walk ends at the input');
  await tree.getByLabel('label').fill('side');
  await tree.getByRole('button', { name: 'label' }).click();
  await a.locator('.tau-tab-labels', { hasText: 'side' }).waitFor();
  await tree.getByTitle('Remove the label side').click();
  await a.locator('.tau-tab-labels', { hasText: 'side' }).waitFor({ state: 'detached' });
  step('the tree opens a cursor at a node; a label is set on it and removed');
  await a.getByTitle('Close cursor 1').click();
  await a.locator('[data-cursor="1"]').waitFor({ state: 'detached' });
  await a.getByText('1 closed').click();
  await a.getByText('reopen #1').click();
  await a.locator('.tau-tab.tau-selected [data-cursor="2"]').waitFor();
  step('closing it leaves it to reopen; reopening opens cursor 2 where it ended');

  // Going to another node moves the cursor: a branch.
  await tree.locator('.tau-tree-line', { hasText: 'mock: second' }).click();
  await tree.getByRole('button', { name: /go to/ }).click();
  await transcript(a).getByText('mock: second').waitFor();
  step('go to moves the followed cursor to a picked node');

  // A reload keeps the tab's token.
  await a.reload();
  await a.locator('.tau-status-ready').waitFor();
  step('a reload connects with the tab\'s token');

  await context.close();
  await context2.close();

  // Protocol 2: a tool result with an image, from a second server with a fake vision model.
  const model = await fakeModel('pixel.png');
  const pictured = await serve({
    webRoot: WEB_ROOT,
    config: { default_model: 'v', models: { v: { model: 'm', base_url: model.url, images: true } } },
  });
  try {
    writeFileSync(join(pictured.work, 'pixel.png'), png());
    const context3 = await browser.newContext();
    const p = await tab(context3, `${pictured.record.url}#token=${pictured.record.token}`);
    await p.locator('.tau-status-ready').waitFor();
    await say(p, 'look at pixel.png');
    await transcript(p).getByText('a single pixel').waitFor();
    const result = transcript(p).locator('.tau-row-result');
    await result.locator('.tau-images-count', { hasText: '1 image' }).waitFor();
    await result.locator('summary').click();
    const label = result.locator('.tau-image');
    assert.equal(await label.innerText(), '[image 1x1 image/png]');
    assert.match(await label.getAttribute('title'), /^sha256 [0-9a-f]{64}$/);
    await context3.close();
    step('a tool result with an image says so, and labels it [image 1x1 image/png] (protocol 2)');
  } finally {
    model.close();
    await pictured.stop();
  }

  assert.deepEqual(problems, [], 'no console errors');
  step('no console errors (CSP included)');
} catch (error) {
  failed = true;
  console.error(error);
  if (problems.length) console.error(problems);
  for (const page of pages) {
    const footer = await page.innerText('footer').catch(() => null);
    if (footer) console.error(`--- ${page.url()} footer:\n${footer}`);
  }
} finally {
  await browser.close();
  await served.stop();
}
if (failed) process.exit(1);
console.log(`smoke:browser: green (${steps.length} checks)`);
