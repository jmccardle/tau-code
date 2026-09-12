import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';

/** The optional companion extension that ships a CPython with tau in it. */
export const RUNTIME_EXTENSION_ID = 'ffwf.tau-runtime';

/**
 * The API `ffwf.tau-runtime` returns from its `activate()`.
 *
 * Declared here as a structural type rather than imported: the two extensions
 * are separate .vsix files installed independently, so there is no build-time
 * relationship to lean on and a shared type would be a fiction. `apiVersion` is
 * what actually gates compatibility, and it is checked below.
 */
interface TauRuntimeApi {
  apiVersion: number;
  target: string;
  root: string;
  interpreter: string;
  command: string;
  args: readonly string[];
  shim: string;
  pythonVersion: string;
  tauVersion: string;
}

export type TauSourceKind = 'setting' | 'env' | 'bundled' | 'path';

export interface TauCandidate {
  kind: TauSourceKind;
  /** Where this came from, as a phrase for the log and the banner. */
  where: string;
  command: string;
  args: string[];
  /** What `--version` said, or null when it could not be read. */
  version: string | null;
}

export interface TauResolution {
  /** The tau that will be spawned, or null when there is none. */
  chosen: TauCandidate | null;
  /**
   * A tau that exists and was NOT chosen.
   *
   * This is the whole reason resolution is a value and not a string. Picking
   * silently between two installed taus is the failure this client can most
   * easily hide from a user, and a banner cannot be drawn from a decision that
   * threw its alternatives away.
   */
  other: TauCandidate | null;
  /** Why there is no tau, when `chosen` is null. */
  problem: string | null;
}

/** Expand a leading `~`. Returns undefined for empty. */
function expandHome(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return join(homedir(), value.slice(2));
  return value;
}

/**
 * Ask a candidate what version it is.
 *
 * Not optional decoration: it is the only way to tell two taus apart, and the
 * only way to find out that a configured path is not a tau at all. A candidate
 * whose `--version` does not answer is still returned with `version: null`
 * rather than dropped -- "there is something here and it would not say what it
 * is" is a different sentence from "there is nothing here", and the user needs
 * the first one to debug a path they typed.
 */
async function probe(command: string, args: string[]): Promise<string | null | 'missing'> {
  return new Promise((resolve) => {
    const child = execFile(
      command,
      [...args, '--version'],
      { timeout: 10_000, windowsHide: true },
      (error, stdout) => {
        if (error) {
          // ENOENT is "no such program", which is absence. Anything else --
          // a non-zero exit, a timeout -- is a program that is there and did
          // not answer.
          const code = (error as NodeJS.ErrnoException).code;
          resolve(code === 'ENOENT' ? 'missing' : null);
          return;
        }
        const match = /(\d+\.\d+\.\d+[^\s]*)/.exec(stdout);
        resolve(match?.[1] ?? null);
      },
    );
    child.on('error', () => resolve('missing'));
  });
}

async function candidate(
  kind: TauSourceKind,
  where: string,
  command: string,
  args: string[],
): Promise<TauCandidate | null> {
  const version = await probe(command, args);
  if (version === 'missing') return null;
  return { kind, where, command, args, version };
}

/** Look up and activate the runtime extension, if it is installed and sound. */
async function bundled(output: vscode.LogOutputChannel): Promise<TauCandidate | null> {
  const extension = vscode.extensions.getExtension<TauRuntimeApi>(RUNTIME_EXTENSION_ID);
  if (!extension) return null;

  let api: TauRuntimeApi;
  try {
    api = await extension.activate();
  } catch (error) {
    // The runtime extension throws when its payload is missing or unreadable.
    // Reported and then stepped over: an installed-but-broken runtime must not
    // stop a working system tau from being used, and must not be silent either.
    const detail = error instanceof Error ? error.message : String(error);
    output.error(`${RUNTIME_EXTENSION_ID} is installed but did not activate: ${detail}`);
    return null;
  }

  if (api.apiVersion !== 1) {
    output.warn(
      `${RUNTIME_EXTENSION_ID} offers apiVersion ${String(api.apiVersion)} and this build reads 1. ` +
        `Ignoring it; update ffwf.tau-code.`,
    );
    return null;
  }

  // The extension already stated the version from its own manifest, so this
  // trusts it rather than paying a subprocess for a number it was handed. The
  // manifest is written by reading pip's dist-info back off disk, which is a
  // better source than parsing `--version` output anyway.
  return {
    kind: 'bundled',
    where: `the tau runtime extension (${api.target}, Python ${api.pythonVersion})`,
    command: api.command,
    args: [...api.args],
    version: api.tauVersion,
  };
}

/**
 * Decide which tau to run, and remember the one that lost.
 *
 * The order is fixed and the reasoning is per step:
 *
 * 1. `tau-code.binary`, when set to anything but the default. An explicit path
 *    is an instruction, so it wins outright -- and if it does not work, that is
 *    an error and NOT a reason to quietly use a different tau. Falling back
 *    from a path the user typed is how you end up debugging the wrong process.
 * 2. `TAU_BIN`, the same instruction from the environment.
 * 3. The bundled runtime. Before PATH, because installing it is a deliberate
 *    act -- but this is exactly the pair that can differ, which is what the
 *    banner is for.
 * 4. `tau` on PATH.
 */
export async function resolveTau(output: vscode.LogOutputChannel): Promise<TauResolution> {
  const config = vscode.workspace.getConfiguration('tau-code');
  const preference = config.get<string>('runtime') ?? 'auto';
  const configured = config.get<string>('binary')?.trim();
  const fromEnv = expandHome(process.env['TAU_BIN']?.trim());

  const systemFirst = async (): Promise<TauCandidate | null> => {
    if (configured && configured !== 'tau') {
      const path = expandHome(configured) ?? configured;
      const found = await candidate('setting', `the "tau-code.binary" setting (${path})`, path, []);
      if (found) return found;
      // Fail Early: a named path that is not there is an error about that path.
      return {
        kind: 'setting',
        where: `the "tau-code.binary" setting (${path})`,
        command: path,
        args: [],
        version: null,
      };
    }
    if (fromEnv) {
      const found = await candidate('env', `TAU_BIN (${fromEnv})`, fromEnv, []);
      if (found) return found;
      return { kind: 'env', where: `TAU_BIN (${fromEnv})`, command: fromEnv, args: [], version: null };
    }
    return null;
  };

  // An explicit path short-circuits everything, including the preference: a
  // user who typed a path and set "bundled" has contradicted themselves, and
  // honouring the more specific of the two is the only reading that does not
  // ignore something they wrote.
  const explicit = await systemFirst();
  if (explicit) {
    const alternative =
      preference === 'system' ? null : await bundled(output).catch(() => null);
    return { chosen: explicit, other: alternative, problem: null };
  }

  const fromPath =
    preference === 'bundled' ? null : await candidate('path', 'tau on PATH', 'tau', []);
  const fromExtension = preference === 'system' ? null : await bundled(output);

  if (preference === 'bundled' && !fromExtension) {
    return {
      chosen: null,
      other: null,
      problem:
        '"tau-code.runtime" is set to "bundled", and the tau runtime extension is not installed ' +
        'or its payload is unusable. Install ffwf.tau-runtime, or set "tau-code.runtime" back to "auto".',
    };
  }

  const chosen = fromExtension ?? fromPath;
  if (!chosen) {
    return {
      chosen: null,
      other: null,
      problem:
        'No tau was found. Install the tau runtime extension (ffwf.tau-runtime) for a ' +
        'self-contained one, or `pip install ffwf-tau` and put its `tau` on PATH, or set ' +
        '"tau-code.binary" to its console script.',
    };
  }
  const other = chosen === fromExtension ? fromPath : fromExtension;
  return { chosen, other, problem: null };
}

/**
 * The sentence to put above the transcript when two taus disagree, or null.
 *
 * Only when BOTH are present and their versions actually differ. Two installs
 * of the same version are not a thing to interrupt anybody about, and one
 * install is a decision with no alternative to report.
 */
export function versionMismatch(resolution: TauResolution): string | null {
  const { chosen, other } = resolution;
  if (!chosen || !other) return null;
  if (chosen.version === null || other.version === null) return null;
  if (chosen.version === other.version) return null;

  return (
    `Two taus are installed and they are different versions. ` +
    `Running ${chosen.version}, from ${chosen.where}. ` +
    `Also found ${other.version}, from ${other.where}. ` +
    `The "tau-code.runtime" setting chooses between them.`
  );
}

/** One line for the log, every start, saying what was picked and what was not. */
export function describe(resolution: TauResolution): string {
  const { chosen, other } = resolution;
  if (!chosen) return resolution.problem ?? 'No tau was found.';
  const version = chosen.version ?? 'an unreadable version';
  const head = `Using tau ${version} from ${chosen.where}.`;
  if (!other) return head;
  return `${head} Not using ${other.version ?? 'an unreadable version'} from ${other.where}.`;
}

/* ------------------------------------------------------------------ cache */

let pending: Promise<TauResolution> | null = null;

/**
 * Resolution, memoised.
 *
 * Two webviews open means two sessions, and resolving costs up to two
 * subprocesses. They would both get the same answer, so they share one.
 */
export function tauRuntime(output: vscode.LogOutputChannel): Promise<TauResolution> {
  pending ??= resolveTau(output);
  return pending;
}

/**
 * Forget the memoised answer.
 *
 * Called when the settings change and on an explicit restart -- the second
 * because "I just installed the runtime extension, now restart the agent" is
 * the obvious thing to do and would otherwise keep using the old answer until
 * the window reloaded.
 */
export function invalidate(): void {
  pending = null;
}
