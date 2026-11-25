/**
 * Will this tau speak to this extension? Decided BEFORE anything is spawned, from what the
 * candidate said about itself.
 *
 * Kept free of `vscode` so the test can compile it alone (test/compat.test.mjs).
 *
 * ## Why this exists
 *
 * 0.9.0 releases the tau runtime for four targets (linux-x64, linux-arm64, darwin-x64,
 * darwin-arm64). On the five it dropped (linux-armhf, alpine-x64, alpine-arm64, win32-x64,
 * win32-arm64) the marketplaces keep serving the newest runtime that HAS the target: 0.8.1, which
 * carries tau 0.14.1 and speaks protocol 1. Next to tau code 0.9.0 that runtime is chosen first
 * (the bundled tau wins over PATH), and τ 0.14's `tau serve -d --json` even succeeds: it prints a
 * daemon record with no protocol, no URL and no token. Without this check the user got a sentence
 * about "protocol undefined". A system tau older than 0.17 is the same failure by another road.
 *
 * Protocol 3 (τ 0.18, tau code 0.10) makes the same failure common: the 0.9 runtime carries τ
 * 0.17.1, which speaks 2, and its runtime API names no protocol, only the version.
 *
 * Nothing falls back. A tau that cannot speak this extension's protocol is refused with what was found, what is
 * needed, and what to do -- including, when there is one, the other tau that WOULD work, so the
 * fix is one setting rather than a search.
 */

/**
 * The first τ release of each protocol since the daemon: 2 is τ 0.17.0 (the HTTP edge, D29), 3 is
 * τ 0.18.0 (images in a user's message, D31). Every τ before 0.17.0 speaks something that is not 2.
 */
export const FIRST_TAU_OF_PROTOCOL: Readonly<Record<number, string>> = { 2: '0.17.0', 3: '0.18.0' };

/** The first τ that speaks `protocol`. A protocol not in the table is this file's bug: thrown. */
export function firstTauOf(protocol: number): string {
  const first = FIRST_TAU_OF_PROTOCOL[protocol];
  if (first === undefined) throw new Error(`compat.ts names no first tau for protocol ${String(protocol)}`);
  return first;
}

/** The τ this release bundles and was tested against; named in the fix. */
export const TESTED_TAU = '0.18.0';

/**
 * The targets this release ships ffwf.tau-runtime for. The same list as build-payload.mjs's
 * `--list` (its targets minus the held ones), and test/compat.test.mjs fails if they differ.
 */
export const RELEASED_RUNTIME_TARGETS: readonly string[] = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64'];

/** What a candidate said about itself. The same shape as runtime.ts's `TauCandidate`, minus spawning. */
export interface Speaker {
  kind: 'setting' | 'env' | 'bundled' | 'path';
  /** Where it came from, as a phrase: `the tau runtime extension (linux-armhf, Python 3.11.16)`. */
  where: string;
  /** `0.14.1`, or null when it did not say. */
  version: string | null;
  /** The protocol it named (`tau 0.18.0 (protocol 3)`), or null when it named none. */
  protocol: number | null;
  /** The runtime's VS Code target (`linux-armhf`), for a bundled τ; otherwise null. */
  target: string | null;
}

/**
 * `tau --version` output to `{version, protocol}`. τ ≥ 0.17 prints `tau 0.18.0 (protocol 3)`;
 * earlier ones print `tau 0.14.1`. Either part may be missing.
 */
export function parseVersion(text: string): { version: string | null; protocol: number | null } {
  const version = /(\d+\.\d+\.\d+[^\s)]*)/.exec(text)?.[1] ?? null;
  const protocol = /\(protocol (\d+)\)/.exec(text)?.[1];
  return { version, protocol: protocol === undefined ? null : Number(protocol) };
}

/** `a < b` for dotted release numbers; a pre-release suffix sorts below its release. */
function older(a: string, b: string): boolean {
  const parse = (v: string) => {
    const core = /^\d+(?:\.\d+)*/.exec(v)?.[0] ?? '0';
    return { parts: core.split('.').map(Number), pre: v.length > core.length };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i += 1) {
    const d = (x.parts[i] ?? 0) - (y.parts[i] ?? 0);
    if (d !== 0) return d < 0;
  }
  return x.pre && !y.pre;
}

/**
 * The protocol a candidate speaks, as far as can be known without starting it: the number it
 * named, else protocol 1 for any τ before 0.17.0 (every earlier release, back to 0.11's daemon,
 * speaks something that is not 2), else 2 for a τ before 0.18.0, else unknown -- and unknown is
 * let through, because `serve.ts`'s record check reads the protocol off the running server and
 * refuses there. A named protocol wins over the version: a τ built from source between releases
 * keeps the last release's number while it speaks the next protocol.
 */
export function protocolOf(speaker: Speaker): number | null {
  if (speaker.protocol !== null) return speaker.protocol;
  if (speaker.version === null) return null;
  if (older(speaker.version, firstTauOf(2))) return 1;
  if (older(speaker.version, firstTauOf(3))) return 2;
  return null;
}

/**
 * Null when `chosen` can speak `wanted`; otherwise the message to show, which says what was found,
 * what is needed and how to fix it. `other` is the candidate that lost, offered when IT would work.
 */
export function incompatibility(chosen: Speaker, other: Speaker | null, wanted: number, extensionVersion: string): string | null {
  const speaks = protocolOf(chosen);
  if (speaks === null || speaks === wanted) return null;

  const found =
    `tau ${chosen.version ?? '(unknown version)'} from ${chosen.where} speaks protocol ${String(speaks)}. ` +
    `tau code ${extensionVersion} speaks protocol ${String(wanted)}, which needs tau ${firstTauOf(wanted)} or newer.`;

  const otherWorks = other !== null && protocolOf(other) === wanted;
  const install =
    `install tau ${TESTED_TAU} yourself (\`pipx install ffwf-tau==${TESTED_TAU}\`, or ` +
    `\`python3 -m pip install --user ffwf-tau==${TESTED_TAU}\`) and set "tau-code.binary" to the path of its \`tau\``;

  let fix: string;
  if (speaks > wanted) {
    // Newer than this extension, not older: the fix is the other way round.
    return (
      `tau ${chosen.version ?? '(unknown version)'} from ${chosen.where} speaks protocol ${String(speaks)}, ` +
      `newer than the protocol ${String(wanted)} tau code ${extensionVersion} speaks. Update tau code, or ${install}.`
    );
  } else if (chosen.kind === 'bundled') {
    const released = chosen.target !== null && RELEASED_RUNTIME_TARGETS.includes(chosen.target);
    const why = released
      ? ` This is an older tau runtime (ffwf.tau-runtime). Update it from the Extensions view: ` +
        `ffwf.tau-runtime ${extensionVersion} for ${chosen.target ?? ''} carries tau ${TESTED_TAU}.`
      : ` This is an older tau runtime (ffwf.tau-runtime): the marketplace has no newer one for ` +
        `${chosen.target ?? 'this platform'}, because tau code ${extensionVersion} ships the runtime for ` +
        `${RELEASED_RUNTIME_TARGETS.join(', ')} only.`;
    fix = otherWorks
      ? `${why} tau ${other.version ?? ''} from ${other.where} does speak protocol ${String(wanted)}: ` +
        `set "tau-code.runtime" to "system" to use it ("tau: Choose Which tau Starts the Server"), ` +
        `or uninstall ffwf.tau-runtime.`
      : `${why} To fix it, ${install}, then uninstall ffwf.tau-runtime or set "tau-code.runtime" to "system".`;
  } else if (chosen.kind === 'setting') {
    fix = ` "tau-code.binary" names this tau. Point it at a tau ${firstTauOf(wanted)} or newer: ${install}.`;
  } else if (chosen.kind === 'env') {
    fix = ` The TAU_BIN environment variable names this tau. Point it at a tau ${firstTauOf(wanted)} or newer, or unset it and ${install}.`;
  } else {
    fix = otherWorks
      ? ` tau ${other.version ?? ''} from ${other.where} does speak protocol ${String(wanted)}: ` +
        `set "tau-code.runtime" to "auto" or "bundled" to use it.`
      : ` Upgrade the tau on PATH (\`pipx upgrade ffwf-tau\` or \`python3 -m pip install --user -U ffwf-tau\`), ` +
        `or ${install}.`;
  }
  return found + fix;
}
