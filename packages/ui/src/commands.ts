import type { TauClient } from '@ffwf/tau-code-protocol';
import type { CommandInfo } from './completion.js';
import { readyOf, stepOf, type FlowStep, type FlowReady } from './flows.js';

/**
 * tau's slash-command vocabulary, and how this head runs each kind of it.
 *
 * ## What changed in tau 0.10.0, and why this file is not a rename
 *
 * `get_commands` used to carry `performer: "frontend" | "core"`, and this head
 * branched on it. That field is gone. It had zero readers inside tau by the time
 * it was removed, and the fact underneath it was never about who RUNS a command:
 * a command's dispatch produces one of four things, and WHICH one is what
 * decides who does the work. The wire now carries the two facts that are real:
 *
 * | field    | says                                                          |
 * |----------|---------------------------------------------------------------|
 * | `origin` | `builtin` (tau's own word) or `extension` (one a loaded        |
 * |          | extension registered). Built-ins resolve first, so an          |
 * |          | extension cannot shadow `/compact`.                            |
 * | `flow`   | whether the command DECLARES what it takes. True means         |
 * |          | `next_step` will step it and `enumerate_domain` will list its  |
 * |          | argument's values -- so a head can build a form for it without |
 * |          | knowing the command exists.                                    |
 *
 * A previous pass reconstructed `performer` from a hardcoded list of five names.
 * That list is a copy of tau's `FRONTEND_COMMANDS` with no way to notice when
 * tau's own changes, which is the drift the registry was built to end. It is
 * gone; nothing here enumerates tau's vocabulary.
 *
 * ## The three ways a `/word` runs from here
 *
 * 1. **A flow** (`flow: true`) -- driven through `next_step`. tau answers either
 *    `step` (one argument still unbound: render a field) or `ready` (call this
 *    mutation with these arguments). The mutation is a verb on the wire, so this
 *    head performs it by name and never needs a case per command. `/compact`,
 *    `/fork`, `/model`, `/name` and an extension's `register_flow` command all
 *    arrive here, and only the last is something this file could not have known
 *    about.
 * 2. **A view** (`tree`, `extensions`) -- a named surface only a head can open.
 *    This head opens the tree browser and the extension panel itself.
 * 3. **Everything else** -- an extension command taking one opaque line. Sent
 *    through `submit` with `expand_commands: true`, which is the one door: the
 *    input-hook chain and the extension lock both sit behind it.
 *
 * An unknown `/word` is none of the three and reaches the model as prose. That
 * is tau's rule, not a fallback added here, and the popup says so.
 */

/** What a frontend command needs from the surrounding app. */
export interface CommandHost {
  client: TauClient;
  /** Re-read the transcript after a mutation changed it. */
  refresh(): Promise<void>;
  /** Show the session picker. */
  openSessions(): void;
  /** Show the conversation tree browser. */
  openTree(): void;
  /** Show the extension panel. */
  openExtensions(): void;
  /**
   * Ask the reader for a flow's next argument.
   *
   * Returns the chosen value, or null if they cancelled. A cancel performs
   * nothing -- tau is not told, because nothing was sent.
   */
  askStep(step: FlowStep): Promise<unknown | null>;
}

export type CommandResult =
  | { kind: 'performed'; notice: string }
  | { kind: 'refused'; notice: string }
  | { kind: 'cancelled' }
  /** Not a command at all. The caller sends the line to the model as prose. */
  | { kind: 'prose' };

/** The views this head can open. Head-local, and the popup greys the rest. */
export const VIEWS: ReadonlySet<string> = new Set(['tree', 'extensions']);

/**
 * A flow's mutation, performed by name.
 *
 * Every mutation `next_step` can name is a verb on this wire, so this is one
 * call and not a table. A name that is NOT on the wire is a tau that grew a
 * capability this client was not generated against; it refuses saying so rather
 * than dropping the gesture, which is the failure the whole four-arm union
 * exists to prevent.
 */
async function performReady(host: CommandHost, ready: FlowReady): Promise<CommandResult> {
  const known = host.client.capabilities;
  const names = new Set(
    Array.isArray(known?.commands)
      ? (known.commands as unknown[]).map((entry) =>
          typeof entry === 'object' && entry !== null ? String((entry as Record<string, unknown>).name) : '',
        )
      : [],
  );
  if (!names.has(ready.mutation)) {
    return {
      kind: 'refused',
      notice:
        `tau resolved /${ready.flow} to the mutation '${ready.mutation}', which is not on ` +
        `this wire. This client was generated against an older tau; run 'npm run generate'.`,
    };
  }
  // The mutation is named by tau, so the params are tau's own shape; the
  // generated union cannot narrow a runtime string, which is the one place this
  // client casts rather than checks.
  await host.client.call(ready.mutation as never, ready.arguments as never);
  await host.refresh();
  return { kind: 'performed', notice: `/${ready.flow} done.` };
}

/** Read `get_commands` into the popup's vocabulary. */
export async function loadCommands(client: TauClient): Promise<CommandInfo[]> {
  const result = await client.call('get_commands', {});
  if (!Array.isArray(result.commands)) {
    throw new TypeError('get_commands().commands is not an array.');
  }
  return result.commands.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new TypeError(`get_commands().commands[${index}] is not an object.`);
    }
    const record = entry as Record<string, unknown>;
    for (const key of ['name', 'description', 'origin', 'flow'] as const) {
      if (!(key in record)) {
        throw new TypeError(`get_commands().commands[${index}] has no '${key}'.`);
      }
    }
    if (typeof record['name'] !== 'string') {
      throw new TypeError(`get_commands().commands[${index}] has no string 'name'.`);
    }
    const origin = record['origin'];
    if (origin !== 'builtin' && origin !== 'extension') {
      throw new TypeError(
        `get_commands().commands[${index}].origin is ${JSON.stringify(origin)}, not 'builtin' or 'extension'.`,
      );
    }
    return {
      name: record['name'],
      description: typeof record['description'] === 'string' ? record['description'] : '',
      origin,
      flow: record['flow'] === true,
    };
  });
}

/**
 * Run a `/word`, or say why not.
 *
 * Never returns having quietly done nothing. A command this head cannot perform
 * comes back as `refused` with the reason, which the composer shows; a word that
 * names nothing comes back as `prose`, and the caller sends it to the model --
 * which is what tau would have done with it anyway.
 */
export async function performCommand(
  name: string,
  args: string,
  commands: CommandInfo[],
  host: CommandHost,
): Promise<CommandResult> {
  const info = commands.find((command) => command.name === name);
  if (info === undefined) return { kind: 'prose' };

  if (VIEWS.has(name)) {
    if (name === 'tree') {
      host.openTree();
      return { kind: 'performed', notice: '' };
    }
    host.openExtensions();
    return { kind: 'performed', notice: '' };
  }

  if (!info.flow) {
    // An extension command taking one opaque line. Through the one door, so the
    // input hooks run and an extension lock can refuse it.
    const result = await host.client.call('submit', {
      text: `/${name}${args ? ` ${args}` : ''}`,
      source: 'rpc',
      submitter: 'tau-code',
      submission_id: `tau-code-cmd-${Date.now()}`,
      expand_commands: true,
      allow_user_input: true,
    });
    const performed = result.command as Record<string, unknown> | undefined;
    await host.refresh();
    return {
      kind: 'performed',
      notice: typeof performed?.['output'] === 'string' ? performed['output'] : `/${name} done.`,
    };
  }

  return runFlow(name, args, host);
}

/**
 * The flow loop: step, ask, step, perform.
 *
 * One `next_step` call per bound argument. tau owns the vocabulary -- which
 * argument comes next, what values it takes, whether it is required -- and this
 * head owns only the asking. That is what lets an extension's `register_flow`
 * command get a form here with no code written for it.
 *
 * Bounded rather than `while (true)`: a flow that answered `step` for an
 * argument it had just been given would spin, and a spinning prompt is harder to
 * report than a refusal that names the flow.
 */
const MAX_FLOW_STEPS = 16;

export async function runFlow(name: string, args: string, host: CommandHost): Promise<CommandResult> {
  const bound: Record<string, unknown> = {};
  // tau's own `bind_command_args`: a flow's first argument takes the rest of the
  // typed line, so `/model haiku` binds without asking. Which argument that is,
  // this head learns from the first step rather than assuming.
  let pending = args.trim();

  for (let taken = 0; taken < MAX_FLOW_STEPS; taken += 1) {
    let answer;
    try {
      answer = await host.client.call('next_step', { flow: name, bound });
    } catch (raw) {
      return { kind: 'refused', notice: raw instanceof Error ? raw.message : String(raw) };
    }

    if (answer.status === 'ready') {
      const ready = readyOf(answer.ready);
      return performReady(host, ready);
    }

    const step = stepOf(answer.step);
    if (pending !== '') {
      bound[step.argument.name] = pending;
      pending = '';
      continue;
    }
    const value = await host.askStep(step);
    if (value === null) return { kind: 'cancelled' };
    bound[step.argument.name] = value;
  }

  return {
    kind: 'refused',
    notice:
      `/${name} asked for more than ${MAX_FLOW_STEPS} arguments without becoming ready. ` +
      `Nothing was performed.`,
  };
}
