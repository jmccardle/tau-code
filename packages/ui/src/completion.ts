import type { TauClient } from '@ffwf/tau-code-protocol';

/**
 * Tab completion for the composer: `/commands` and `@files`.
 *
 * Two sources, for one reason each.
 *
 * **`/command` is computed HERE**, from `get_commands`. The whole vocabulary is
 * already on the wire -- name, description and performer -- and the matching
 * rule is a case-sensitive prefix test on the first word, which is what tau's
 * own `resolve_command` does with the finished line. Asking tau to filter a
 * list it already handed over would be a round trip for nothing.
 *
 * **`@file` is computed BY TAU**, through `complete_path` (protocol 1.4). This
 * client cannot do it: a browser has no filesystem at all, and the VS Code
 * extension host does have one but under Remote SSH or a devcontainer it is the
 * wrong machine's. tau answers from the working directory the agent's own tools
 * resolve against, which is the only answer that cannot be wrong.
 *
 * The two share the return type below so the popup does not care which it is
 * showing, and neither does the key handler.
 */

/** One row in the popup. */
export interface Candidate {
  /** What replaces the span in the editor, WITHOUT the leading `/` or `@`. */
  value: string;
  /** Right-hand column: a description, a file size, or `dir`. */
  detail: string;
  /**
   * False for a `/command` this head cannot perform. Shown anyway, greyed:
   * tau's vocabulary is tau's, and hiding a command would tell the reader it
   * does not exist when the truth is that this head has not implemented it.
   */
  available: boolean;
}

export interface Completions {
  kind: 'command' | 'path';
  /** Character span in the editor text that a chosen `value` replaces, `@`/`/` included. */
  start: number;
  end: number;
  /** What was typed after the sigil. */
  token: string;
  candidates: Candidate[];
  /**
   * How many matched before the list was bounded. Equal to `candidates.length`
   * unless tau capped it -- in which case saying so is the difference between
   * "these are the matches" and "these are SOME of the matches".
   */
  total: number;
}

/** One `get_commands` row. */
export interface CommandInfo {
  name: string;
  description: string;
  performer: string;
}

/**
 * The `/…` at the start of the line, or null.
 *
 * Mirrors tau's `complete_command` exactly, including the case that looks like
 * an oversight and is not: an unknown first word FOLLOWED BY A SPACE returns
 * null. Once a space is typed after a word that names no command, the line is
 * committed to being prose -- someone pasted a path -- and a popup about it
 * would be noise.
 */
export function commandSpan(
  text: string,
): { start: number; end: number; token: string; hasArgs: boolean } | null {
  // tau strips BOTH ends before splitting, so `/comp ` is still a bare `/comp`
  // being typed and not a command with an empty argument. Matching that matters:
  // a trailing space is what the previous keystroke left behind.
  const leading = text.length - text.trimStart().length;
  const body = text.trim();
  if (!body.startsWith('/')) return null;
  const afterSlash = body.slice(1);
  const space = afterSlash.indexOf(' ');
  const token = space === -1 ? afterSlash : afterSlash.slice(0, space);
  return { start: leading, end: leading + 1 + token.length, token, hasArgs: space !== -1 };
}

/**
 * Candidate commands for a half-typed line.
 *
 * `matches` EMPTY is the case this exists for. An unrecognised `/…` is sent to
 * the model as ordinary prose -- correct, deliberate, and until a popup says so,
 * completely invisible. The composer renders an empty list as that sentence.
 *
 * Built-ins come first and an extension that registered a built-in's name is
 * dropped, because tau resolves in that order: such a name is unreachable, so
 * offering it would advertise a command the user cannot run.
 */
export function completeCommand(
  text: string,
  commands: CommandInfo[],
  performable: ReadonlySet<string>,
): Completions | null {
  const span = commandSpan(text);
  if (span === null) return null;

  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const pass of ['frontend', 'other'] as const) {
    for (const command of commands) {
      const isFrontend = command.performer === 'frontend';
      if ((pass === 'frontend') !== isFrontend) continue;
      if (seen.has(command.name)) continue;
      if (!command.name.startsWith(span.token)) continue;
      seen.add(command.name);
      candidates.push({
        value: command.name,
        detail: command.description,
        // A core (extension-registered) command is performed by tau itself, so
        // it works over the wire unconditionally. A frontend one only works if
        // THIS head implements it.
        available: !isFrontend || performable.has(command.name),
      });
    }
  }

  // The stray-text case, matching tau: no matches AND a space already typed
  // means the line is prose now -- someone pasted a path.
  if (candidates.length === 0 && span.hasArgs) return null;

  return {
    kind: 'command',
    start: span.start,
    end: span.end,
    token: span.token,
    candidates,
    total: candidates.length,
  };
}

/**
 * Ask tau for the paths matching the `@…` the cursor is inside.
 *
 * Returns null when the cursor is not inside a reference at all -- which is a
 * different answer from a reference that matches no file, and the caller must
 * keep them apart: the first shows no popup, the second shows the "this names
 * no file" warning.
 */
export async function completePath(
  client: TauClient,
  text: string,
  cursor: number,
): Promise<Completions | null> {
  const result = await client.call('complete_path', { text, cursor });
  const completion = result.completion;
  if (completion === null || typeof completion !== 'object') return null;

  const record = completion as Record<string, unknown>;
  // Check before narrowing, the same discipline `capabilities.ts` uses on the
  // arrays tau's schemas leave unrefined: a protocol change surfaces here, once,
  // with a message naming the field, instead of as `undefined` in the popup.
  for (const key of ['start', 'end', 'token', 'matches', 'total']) {
    if (!(key in record)) {
      throw new TypeError(`complete_path().completion has no '${key}'.`);
    }
  }
  if (!Array.isArray(record['matches'])) {
    throw new TypeError('complete_path().completion.matches is not an array.');
  }

  const candidates: Candidate[] = record['matches'].map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new TypeError(`complete_path().completion.matches[${index}] is not an object.`);
    }
    const match = entry as Record<string, unknown>;
    if (typeof match['name'] !== 'string') {
      throw new TypeError(`complete_path().completion.matches[${index}] has no string 'name'.`);
    }
    return {
      value: match['name'],
      detail: typeof match['detail'] === 'string' ? match['detail'] : '',
      available: true,
    };
  });

  return {
    kind: 'path',
    start: Number(record['start']),
    end: Number(record['end']),
    token: String(record['token']),
    candidates,
    total: Number(record['total']),
  };
}

/**
 * Put `candidate` into `text`, and say where the cursor lands.
 *
 * A directory keeps its trailing `/` and the cursor sits after it, so Tab again
 * descends -- the shell behaviour, and the reason this returns a cursor rather
 * than leaving the caller to guess. A file gets a trailing space, because the
 * reference is finished and the next thing typed is the sentence.
 */
export function applyCandidate(
  text: string,
  completions: Completions,
  candidate: Candidate,
): { text: string; cursor: number } {
  const sigil = completions.kind === 'command' ? '/' : '@';
  const descending = completions.kind === 'path' && candidate.value.endsWith('/');
  // Do not add a space in front of one that is already there. Completing in the
  // MIDDLE of a sentence is the ordinary case for `@`, and a second space every
  // time Tab is pressed accumulates.
  const alreadySpaced = text.slice(completions.end).startsWith(' ');
  const trailer = descending || alreadySpaced ? '' : ' ';
  const inserted = `${sigil}${candidate.value}${trailer}`;
  return {
    text: text.slice(0, completions.start) + inserted + text.slice(completions.end),
    cursor: completions.start + inserted.length,
  };
}

/**
 * Which candidate Tab moves to.
 *
 * Repeated Tab cycles and wraps. There is no separate "accept" key because
 * there is no separate mode: each Tab writes its candidate straight into the
 * editor, so what is on screen is always what will be sent. That is the TUI's
 * rule (SLASH-COMMANDS.md section 3) and it is right for the same reason here --
 * Escape, Enter and the arrows are already spent.
 */
export function nextIndex(current: number, count: number, backwards: boolean): number {
  if (count === 0) return 0;
  return (((backwards ? current - 1 : current + 1) % count) + count) % count;
}
