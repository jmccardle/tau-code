import { ServeError } from '@ffwf/tau-code-protocol';
import type { Form, Method, Requests, Results } from '@ffwf/tau-code-protocol';

/** A call on the session: `SessionLink.call`, or a test's fake. */
export type Call = <M extends Method>(method: M, params: Requests[M]) => Promise<Results[M]>;

/**
 * What a line typed in the composer does. The server reads command lines (D21 §3: `parse_line`,
 * `complete_line`); the client only decides between the calls that follow.
 */
export type LinePlan =
  /**
   * Not a command: `send` it as input. `warning` when the line looked like a command and named
   * none (`/etc/hosts?`): say so, then send, as τ's own frontends do.
   */
  | { kind: 'send'; text: string; warning?: string }
  /** A command with every required argument: `run` it. */
  | { kind: 'run'; command: string; args: Record<string, unknown> }
  /** A command missing arguments: show its form, then `run`. */
  | { kind: 'ask'; command: string; form: Form; args: Record<string, unknown>; missing: string[] }
  /** `/config <extension> name=value...`: `configure` it. */
  | { kind: 'configure'; extension: string; values: Record<string, unknown>; save: boolean }
  /** `/config <extension>`: show its options form (from `options`), then `configure`. */
  | { kind: 'options'; extension: string; form: Form; save: boolean };

/** A command's name on the wire: `extension:name`, which the client writes from the form. */
export function qualified(form: Form): string {
  return form.extension ? `${form.extension}:${form.name}` : form.name;
}

/**
 * Read `line` with the server and say what it does. A line not starting with `/` is input. A line
 * naming no command (`UnknownCommand`) is input too, with a warning, as τ says a frontend does
 * (`commandline.UnknownCommand`; the TUI's "no command /x: sent as text"): `/etc/hosts?` is a
 * question for the model. A name with a `:` names an extension, so it cannot be text: that is
 * thrown, as are other refusals (`Refused`, an ambiguous `NotFound`), with τ's sentence.
 */
export async function planLine(call: Call, cursor: number, line: string): Promise<LinePlan> {
  if (!line.startsWith('/')) return { kind: 'send', text: line };
  let parsed: Results['parse_line'];
  try {
    parsed = await call('parse_line', { cursor, line });
  } catch (error) {
    if (error instanceof ServeError && error.is('UnknownCommand')) {
      const name = typeof error.data?.['name'] === 'string' ? (error.data['name'] as string) : line.slice(1).split(/\s/)[0];
      if (name?.includes(':')) throw new Error(`no command /${name}`);
      return { kind: 'send', text: line, warning: `no command /${name}: sent as text` };
    }
    throw error;
  }
  const save = parsed.save ?? false;
  if (parsed.extension !== null && parsed.extension !== undefined) {
    const extension = parsed.extension;
    if (Object.keys(parsed.args).length === 0) {
      return { kind: 'options', extension, save, form: await call('options', { cursor, extension }) };
    }
    return { kind: 'configure', extension, values: parsed.args, save };
  }
  const command = qualified(parsed.command);
  if (parsed.missing.length) {
    return { kind: 'ask', command, form: parsed.command, args: parsed.args, missing: parsed.missing };
  }
  return { kind: 'run', command, args: parsed.args };
}

/**
 * The line with its last word replaced by `completion`: what `complete_line` offers is "a whole
 * word to replace [the word being typed] with (quoted if it needs to be)". The word being typed
 * starts after the last space outside quotes; after a trailing space it is empty.
 */
export function complete(line: string, completion: string): string {
  let start = 0;
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string;
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (/\s/.test(c)) {
      start = i + 1;
    }
  }
  return line.slice(0, start) + completion;
}
