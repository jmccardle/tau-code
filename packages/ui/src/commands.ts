import type { TauClient } from '@ffwf/tau-code-protocol';
import type { CommandInfo } from './completion.js';

/**
 * tau's slash-command vocabulary, and which of it this head can perform.
 *
 * tau splits a command into a DECISION and a PERFORMANCE. The core decides what
 * a `/word` is; a `performer: "frontend"` command is then performed by whatever
 * is driving -- the TUI, or this. Over RPC there is no screen to push a panel
 * onto, so tau refuses those with COMMAND_NOT_SUPPORTED (-32001) rather than
 * silently doing nothing, and it is this head's job to implement the ones it
 * can.
 *
 * Five frontend built-ins exist today. This head performs three:
 *
 * | command       | here                                                   |
 * |---------------|--------------------------------------------------------|
 * | `/compact`    | the `compact` verb, which is on the wire                 |
 * | `/fork`       | the `fork` verb, which is on the wire                    |
 * | `/resume`     | opens the session picker                                 |
 * | `/tree`       | NOT performed -- the tree browser is not built yet       |
 * | `/extensions` | NOT performed -- no extension panel exists here          |
 *
 * The two it cannot perform are still listed in the popup, greyed. Hiding them
 * would tell the reader they do not exist, when the truth is narrower and more
 * useful: they exist, and this head has not implemented them.
 */

/** What a frontend command needs from the surrounding app. */
export interface CommandHost {
  client: TauClient;
  /** `Conversation.fork`. Returns false when an extension vetoed it. */
  fork(): Promise<boolean>;
  /** Show the session picker. */
  openSessions(): void;
}

export type CommandResult =
  | { kind: 'performed'; notice: string }
  | { kind: 'refused'; notice: string };

/** The frontend commands this head implements. Consulted by the popup. */
export const PERFORMABLE: ReadonlySet<string> = new Set(['compact', 'fork', 'resume']);

/** Why each unimplemented frontend command is unimplemented, in one sentence. */
const NOT_PERFORMED: Record<string, string> = {
  tree: 'The conversation tree browser is not built in this head yet. Use the tau TUI for /tree.',
  extensions:
    'This head has no extension panel yet. Use the tau TUI for /extensions, or check the log.',
};

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
    if (typeof record['name'] !== 'string') {
      throw new TypeError(`get_commands().commands[${index}] has no string 'name'.`);
    }
    return {
      name: record['name'],
      description: typeof record['description'] === 'string' ? record['description'] : '',
      performer: typeof record['performer'] === 'string' ? record['performer'] : 'core',
    };
  });
}

/**
 * Perform a frontend command, or say why not.
 *
 * Never returns having quietly done nothing -- that is the exact failure the
 * whole performer split exists to remove, and tau's own core says so in
 * `unsupported_command_message`. A command this head cannot perform comes back
 * as `refused` with the reason, which the composer shows.
 */
export async function performCommand(
  name: string,
  args: string,
  host: CommandHost,
): Promise<CommandResult> {
  const stray = args.trim();

  switch (name) {
    case 'compact': {
      // `compact` has two completions like `submit` does: this resolves when
      // tau ACCEPTS, and the `compaction_end` notification carries the outcome.
      // The Conversation store is already listening for it and will report what
      // actually happened, so this notice deliberately says "started".
      await host.client.call('compact', {});
      return { kind: 'performed', notice: 'Compaction started.' };
    }

    case 'fork': {
      const moved = await host.fork();
      return moved
        ? { kind: 'performed', notice: 'Forked this session.' }
        : { kind: 'refused', notice: 'An extension refused the fork. Nothing was changed.' };
    }

    case 'resume': {
      // tau's /resume takes an optional <ref>. This head opens the picker
      // instead of resolving it, and SAYS so rather than discarding the word --
      // the TUI has an unfixed Fail-Early violation of exactly this shape
      // (SLASH-COMMANDS.md section 4: `/tree extra words` runs and drops the
      // extra words), and there is no reason to reproduce it here.
      host.openSessions();
      return stray === ''
        ? { kind: 'performed', notice: '' }
        : {
            kind: 'performed',
            notice: `Opened the session picker. It does not take a name yet, so "${stray}" was not used — pick the session from the list.`,
          };
    }

    default: {
      const reason = NOT_PERFORMED[name];
      return {
        kind: 'refused',
        notice:
          reason ??
          `/${name} is a command tau expects the frontend to perform, and this one does not implement it.`,
      };
    }
  }
}
