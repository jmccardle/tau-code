/**
 * A `tau serve` for a script: a throwaway TAU_HOME with the mock model (no network, no key), a
 * throwaway working directory, the HTTP edge only (`--no-unix`), and stopped when the script is
 * done. Nothing here touches `~/.tau`.
 *
 *   const served = await serve({ extensions: { gate: GATE_SOURCE } });
 *   served.record.url, served.record.token   // the serve record `-d --json` printed
 *   await served.stop();                      // `tau serve --stop`, then removes the temp dirs
 *
 * τ is `$TAU_BIN`, else `tau` on PATH; it must have the HTTP edge (τ master ≥ ea0a3dcd, 0.16.1).
 */
import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const TAU_BIN = process.env['TAU_BIN'] ?? 'tau';

/** The mock model, replying `mock: <the last input>` word by word. */
export function mockConfig(options = { delay_ms: 5 }) {
  return { default_model: 'mock', models: { mock: { model: 'mock', provider: 'mock', options } } };
}

function tau(args, { env, cwd }) {
  return new Promise((resolve, reject) => {
    execFile(TAU_BIN, args, { env, cwd, timeout: 60_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(
          new Error(
            `'${TAU_BIN} ${args.join(' ')}' failed: ${error.message}\n${stderr}` +
              (error.code === 'ENOENT' ? `\nSet TAU_BIN to τ's console script.` : ''),
          ),
        );
      } else resolve({ stdout, stderr });
    });
  });
}

/**
 * Start `tau serve -d --json --no-unix` and return its record.
 *
 * - `extensions`: `{name: python source}`, each written to a file and loaded with `-e`;
 * - `webRoot`: a directory to serve as the web client (`--web-root`);
 * - `config`: the user config (default: the mock model);
 * - `args`: anything else for `tau serve`.
 */
export async function serve({ extensions = {}, webRoot = null, config = mockConfig(), args = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'tau-code-serve-'));
  const home = join(root, 'tau-home');
  const work = join(root, 'work');
  mkdirSync(home, { recursive: true });
  chmodSync(home, 0o700);
  mkdirSync(work);
  writeFileSync(join(home, 'config.json'), JSON.stringify(config));
  const env = { ...process.env, TAU_HOME: home };
  const flags = ['--no-unix', '--port', '0', '-n', 'tau-code-smoke'];
  for (const [name, source] of Object.entries(extensions)) {
    const path = join(root, `${name}.py`);
    writeFileSync(path, source);
    flags.push('-e', path);
  }
  if (webRoot) flags.push('--web-root', webRoot);
  flags.push(...args);

  let record;
  try {
    const { stdout } = await tau(['serve', '-d', '--json', ...flags], { env, cwd: work });
    record = JSON.parse(stdout);
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
  if (!record.url || !record.token) throw new Error(`the serve record has no url or token: ${JSON.stringify(record)}`);

  let stopped = false;
  return {
    record,
    home,
    work,
    /** `tau serve --stop` for this session, then remove the temp directories. */
    async stop() {
      if (stopped) return;
      stopped = true;
      try {
        await tau(['serve', '--stop', '--session', record.session], { env, cwd: work });
      } finally {
        try {
          process.kill(record.pid, 0);
          process.kill(record.pid, 'SIGTERM');
        } catch {
          // gone, as it should be
        }
        rmSync(root, { recursive: true, force: true });
      }
    },
  };
}

/** Wait until `predicate()` is true, polling; throw `what` after `ms`. */
export async function until(predicate, what, ms = 10_000) {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
