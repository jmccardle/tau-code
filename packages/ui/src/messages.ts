import type {
  Entry,
  ImageContent,
  Message,
  TextContent,
  ThinkingContent,
  ToolCall,
} from '@ffwf/tau-code-protocol';

/**
 * Turning a session's path into what the transcript draws.
 *
 * The path is root→leaf entries (`Replica.path`), typed by the schema, so
 * nothing here checks shapes. What it decides is which entries a reader of the
 * conversation sees, and as what:
 *
 * - **Messages** are the conversation: user, agent, tool results, the system
 *   prompt (folded), and an extension's custom message when it asked to be
 *   displayed. τ's own `turn_error` message is the one custom message drawn as
 *   what it is: every turn that raised ends with one (tau docs/TURN-FAILURES.md).
 * - **Compaction, elision and branch summaries** change what the MODEL sees
 *   from here on, so they are drawn where they happen, with the summary. The
 *   transcript keeps everything before them: it shows the conversation, and
 *   the tree browser shows the splice.
 * - **An incomplete entry** is a message being written, or one that never
 *   finished. Which, the caller knows (is this cursor running?), so this only
 *   marks it.
 * - Bookkeeping (`navigate`, `session_info`, `customEntry`, model and thinking
 *   changes, foreign entries) has no place in a reading of the conversation and
 *   is left to the tree browser, which shows every entry.
 */

export type ContentBlock = TextContent | ThinkingContent | ImageContent | ToolCall;

export type Item =
  | { kind: 'user'; id: string; blocks: ContentBlock[] }
  | { kind: 'assistant'; id: string; blocks: ContentBlock[]; stopReason: string; error: string | null }
  | {
      kind: 'toolResult';
      id: string;
      toolName: string;
      blocks: ContentBlock[];
      isError: boolean;
      /** What the tool raised, which the model was not shown (tau docs/TURN-FAILURES.md §3). */
      exception: string | null;
      /** Everything else in `details`; the exception is drawn on its own. */
      details: Record<string, unknown> | null;
    }
  | { kind: 'system'; id: string; text: string }
  | { kind: 'custom'; id: string; customType: string; blocks: ContentBlock[] }
  | { kind: 'turnError'; id: string; blocks: ContentBlock[] }
  | { kind: 'marker'; id: string; label: string; text: string }
  | { kind: 'incomplete'; id: string; entryType: string; blocks: ContentBlock[] };

function messageItem(id: string, message: Message): Item | null {
  switch (message.role) {
    case 'user':
      return {
        kind: 'user',
        id,
        blocks: typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content,
      };
    case 'assistant':
      return {
        kind: 'assistant',
        id,
        blocks: message.content,
        stopReason: message.stop_reason,
        error: message.error_message ?? null,
      };
    case 'toolResult': {
      const { exception, ...rest } = message.details ?? {};
      return {
        kind: 'toolResult',
        id,
        toolName: message.tool_name,
        blocks: message.content,
        isError: message.is_error === true,
        exception: typeof exception === 'string' && exception ? exception : null,
        details: Object.keys(rest).length > 0 ? rest : null,
      };
    }
    case 'system':
      return { kind: 'system', id, text: message.content };
    case 'custom':
      if (!message.display) return null;
      if (message.customType === 'turn_error') return { kind: 'turnError', id, blocks: message.content };
      return { kind: 'custom', id, customType: message.customType, blocks: message.content };
  }
}

/** The blocks an unfinished entry carries so far, when it is a message at all. */
function partialBlocks(entry: Entry): ContentBlock[] {
  const message = (entry as { message?: unknown }).message;
  if (typeof message !== 'object' || message === null) return [];
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? (content as ContentBlock[]) : [];
}

export function itemOf(entry: Entry): Item | null {
  if (entry.status === 'incomplete') {
    return { kind: 'incomplete', id: entry.id, entryType: entry.type, blocks: partialBlocks(entry) };
  }
  switch (entry.type) {
    case 'message':
      return messageItem(entry.id, (entry as Extract<Entry, { type: 'message' }>).message);
    case 'customMessage':
      return messageItem(entry.id, (entry as Extract<Entry, { type: 'customMessage' }>).message);
    case 'compaction': {
      const compaction = entry as Extract<Entry, { type: 'compaction' }>;
      return {
        kind: 'marker',
        id: entry.id,
        label: `Compacted ${compaction.tokensBefore.toLocaleString()} tokens. The model reads this summary from here on:`,
        text: compaction.summary,
      };
    }
    case 'branch_summary':
      return {
        kind: 'marker',
        id: entry.id,
        label: 'Summary of the branch this one left:',
        text: (entry as Extract<Entry, { type: 'branch_summary' }>).summary,
      };
    case 'elide':
      return {
        kind: 'marker',
        id: entry.id,
        label: 'Elided: the model no longer reads the span above this point.',
        text: '',
      };
    default:
      return null;
  }
}

export function itemsOf(path: readonly Entry[]): Item[] {
  const items: Item[] = [];
  for (const entry of path) {
    const item = itemOf(entry);
    if (item) items.push(item);
  }
  return items;
}

/** Flatten a content block list to plain text, for a collapsed preview. */
export function blocksToText(blocks: readonly ContentBlock[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case 'text':
          return block.text;
        case 'thinking':
          return block.thinking;
        case 'image':
          return `[image: ${block.mime_type}]`;
        case 'toolCall':
          return `[tool call: ${block.name}]`;
      }
    })
    .join('\n');
}

/** True once the path holds a message the user wrote; an empty session lands on the picker. */
export function hasUserMessage(path: readonly Entry[]): boolean {
  return path.some(
    (entry) => entry.type === 'message' && (entry as Extract<Entry, { type: 'message' }>).message.role === 'user',
  );
}
