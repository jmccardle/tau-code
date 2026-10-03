import type { CommandInfo, DispatchedCommand } from '@ffwf/tau-code-protocol';
import type { Daemon } from './daemon.js';
import { messageOf } from './daemon.js';
import type { SessionStore } from './session.js';
import { stepOf, type FlowStep } from './flows.js';

/**
 * τ's slash-command vocabulary, and how this head runs each kind of it.
 *
 * The vocabulary is the attached session's `surface.commands`: every built-in
 * and every command a loaded extension registered, each with two facts --
 * `origin` (`builtin` or `extension`, where the NAME came from; built-ins
 * resolve first, so an extension cannot shadow `/compact`) and `flow` (whether
 * the command DECLARES what it takes, so `next_step` can step it and a form can
 * be built for it without knowing it exists). **Nothing in this file
 * enumerates τ's vocabulary.**
 *
 * ## The three ways a `/word` runs from here
 *
 * 1. **A flow** (`flow: true`) -- stepped through `next_step`. τ answers either
 *    `step` (an argument is still unbound: render a field for it) or `ready`
 *    (every argument is bound). A `ready` goes back to the daemon through
 *    `perform_ready`, which performs it exactly as a typed command would be
 *    performed -- so this head needs no table from mutation names to requests.
 *    `/compact`, `/model`, `/name` and an extension's `register_flow` command
 *    all arrive here, and only the last is something this file could not have
 *    known about.
 * 2. **A view** (`tree`, `extensions`) -- a named surface only a head can open.
 * 3. **Everything else** -- an extension command taking one opaque line, sent
 *    through `submit` with `expand_commands: true`, which is the one door: the
 *    input hooks and the extension lock both sit behind it.
 *
 * Whichever door, the daemon answers with the same four-armed union
 * (`DispatchedCommand`), and `followArm` is the one place it is read:
 * `Performed` is done; `FlowStep` asks for the next argument; `Ready` is a
 * mutation that moves THIS HEAD to another session (`fork`, `switch_session`),
 * which only the head can do; `View` opens a panel.
 *
 * An unknown `/word` is none of these and reaches the model as prose. That is
 * τ's rule, not a fallback added here, and the popup says so.
 */

/** What a command needs from the surrounding app. */
export interface CommandHost {
  daemon: Daemon;
  session: SessionStore;
  /** Show the session picker. */
  openSessions(): void;
  /** Open a named view; false when this head has no panel for it. */
  openView(name: string): boolean;
  /**
   * Ask the reader for a flow's next argument.
   *
   * Returns the chosen value, or null if they cancelled. A cancel performs
   * nothing -- τ is not told, because nothing was sent.
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
 * Bounded rather than `while (true)`: a flow that answered `step` for an
 * argument it had just been given would spin, and a spinning prompt is harder
 * to report than a refusal that names the flow.
 */
const MAX_FLOW_STEPS = 16;

/**
 * Run a `/word`, or say why not.
 *
 * Never returns having quietly done nothing. A command this head cannot perform
 * comes back as `refused` with the reason; a word that names nothing comes back
 * as `prose`, and the caller sends it to the model -- which is what τ would
 * have done with it anyway.
 */
export async function performCommand(
  name: string,
  args: string,
  commands: readonly CommandInfo[],
  host: CommandHost,
): Promise<CommandResult> {
  const info = commands.find((command) => command.name === name);
  if (info === undefined) return { kind: 'prose' };

  try {
    if (VIEWS.has(name)) {
      host.openView(name);
      return { kind: 'performed', notice: '' };
    }
    if (info.flow) return await runFlow(name, args, {}, host);

    const { client, session_id, cursor_id } = host.session.at();
    const result = await client.request('submit', {
      session_id,
      cursor_id,
      text: `/${name}${args ? ` ${args}` : ''}`,
      submission_id: `tau-code-cmd-${Date.now()}`,
      multitask_strategy: 'enqueue',
      expand_commands: true,
    });
    if (!result.accepted) return { kind: 'refused', notice: result.reason ?? `τ refused /${name}.` };
    if (!result.command) return { kind: 'performed', notice: `/${name} done.` };
    return await followArm(result.command, host, 0);
  } catch (raw) {
    return { kind: 'refused', notice: messageOf(raw) };
  }
}

/**
 * The flow loop: step, ask, step, perform.
 *
 * One `next_step` per bound argument. τ owns the vocabulary -- which argument
 * comes next, what values it takes, whether it is required -- and this head
 * owns only the asking.
 */
async function runFlow(
  name: string,
  args: string,
  initial: Record<string, unknown>,
  host: CommandHost,
  taken = 0,
): Promise<CommandResult> {
  const bound: Record<string, unknown> = { ...initial };
  // τ's own `bind_command_args`: a flow's first argument takes the rest of the
  // typed line, so `/model haiku` binds without asking. Which argument that is,
  // this head learns from the first step rather than assuming.
  let pending = args.trim();

  for (; taken < MAX_FLOW_STEPS; taken += 1) {
    const { client, session_id, cursor_id } = host.session.at();
    const leaf = host.session.state.cursor?.leaf ?? null;
    const answer = await client.request('next_step', { session_id, flow: name, bound, leaf });

    if (answer.status === 'ready') {
      if (!answer.ready) return { kind: 'refused', notice: `next_step said /${name} is ready and sent no mutation.` };
      const command = await client.request('perform_ready', { session_id, cursor_id, ready: answer.ready });
      return followArm(command, host, taken);
    }

    if (!answer.step) return { kind: 'refused', notice: `next_step asked for an argument of /${name} and named none.` };
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
    notice: `/${name} asked for more than ${MAX_FLOW_STEPS} arguments without becoming ready. Nothing was performed.`,
  };
}

/** Carry out whatever the daemon answered a command with. */
async function followArm(command: DispatchedCommand, host: CommandHost, taken: number): Promise<CommandResult> {
  switch (command.arm) {
    case 'Performed': {
      const output = command.data['output'];
      return {
        kind: 'performed',
        notice: typeof output === 'string' && output ? output : `/${command.flow ?? command.mutation} done.`,
      };
    }
    case 'FlowStep': {
      // A typed command missing an argument: carry on stepping from what the
      // daemon already bound, asking for the rest.
      const value = await host.askStep(stepOf(command));
      if (value === null) return { kind: 'cancelled' };
      return runFlow(command.flow, '', { ...command.bound, [command.argument.name]: value }, host, taken + 1);
    }
    case 'Ready':
      // The two mutations that move a head to another session. The daemon
      // cannot move this head, so it hands them back; anything else here is a
      // daemon that grew one, and is refused by name rather than dropped.
      if (command.mutation === 'fork') {
        await host.daemon.fork(host.session.state.cursor?.leaf ?? null);
        return { kind: 'performed', notice: 'Forked: this is the new session.' };
      }
      if (command.mutation === 'switch_session') {
        const sessionId = command.arguments['session_id'];
        if (typeof sessionId !== 'string') {
          host.openSessions();
          return { kind: 'performed', notice: '' };
        }
        await host.daemon.open(sessionId);
        return { kind: 'performed', notice: `Switched to ${sessionId.slice(0, 8)}.` };
      }
      return {
        kind: 'refused',
        notice: `The daemon handed back '${command.mutation}' for this head to perform, and this head does not know it.`,
      };
    case 'View':
      if (command.unavailable_because) return { kind: 'refused', notice: command.unavailable_because };
      if (!host.openView(command.name)) {
        return { kind: 'refused', notice: `τ asked for the '${command.name}' view, and this head has no panel for it.` };
      }
      return { kind: 'performed', notice: '' };
  }
}
