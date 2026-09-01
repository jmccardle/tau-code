/**
 * Reading tau's message array.
 *
 * `get_messages` is typed `unknown[]` on the wire -- tau's schemas carry no
 * `items`, so the element shape genuinely is not declared. These readers narrow
 * it, and they CHECK rather than cast: a message whose shape is not recognized
 * becomes an `unknown` entry the UI renders as "a message this client could not
 * read", instead of a blank space or a crash.
 *
 * Shapes are from tau's own types (`tau_llm/types.py`).
 */

export interface TextBlock {
  type: 'text';
  text: string;
}
export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
}
export interface ImageBlock {
  type: 'image';
  data: string;
  mime_type: string;
}
export interface ToolCallBlock {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}
export type ContentBlock = TextBlock | ThinkingBlock | ImageBlock | ToolCallBlock;

export interface UserEntry {
  kind: 'user';
  blocks: ContentBlock[];
  timestamp: number | null;
}
export interface AssistantEntry {
  kind: 'assistant';
  blocks: ContentBlock[];
  timestamp: number | null;
}
export interface ToolResultEntry {
  kind: 'toolResult';
  toolCallId: string;
  toolName: string;
  blocks: ContentBlock[];
  isError: boolean;
  /**
   * The tool's structured detail.
   *
   * `ToolResultMessage.details` exists on tau's model and is always `null`
   * today: `AgentToolResult` -- the type the loop actually carries -- has no
   * `details` field, so every tool's detail dict is dropped at
   * `agent_loop.py:_execute_single_tool` before a message is ever built. This
   * is read here because the slot is real and the day it is populated, the
   * file-change data for jump-to-edit and diffs arrives through it.
   */
  details: Record<string, unknown> | null;
  timestamp: number | null;
}
export interface SystemEntry {
  kind: 'system';
  text: string;
}
export interface UnknownEntry {
  kind: 'unknown';
  raw: unknown;
}

export type Entry = UserEntry | AssistantEntry | ToolResultEntry | SystemEntry | UnknownEntry;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function readBlocks(content: unknown): ContentBlock[] {
  // A user message's content may be a bare string.
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [];
  const blocks: ContentBlock[] = [];
  for (const item of content) {
    const record = asRecord(item);
    if (!record) continue;
    switch (record['type']) {
      case 'text':
        blocks.push({ type: 'text', text: String(record['text'] ?? '') });
        break;
      case 'thinking':
        blocks.push({ type: 'thinking', thinking: String(record['thinking'] ?? '') });
        break;
      case 'image':
        blocks.push({
          type: 'image',
          data: String(record['data'] ?? ''),
          mime_type: String(record['mime_type'] ?? 'application/octet-stream'),
        });
        break;
      case 'toolCall':
        blocks.push({
          type: 'toolCall',
          id: String(record['id'] ?? ''),
          name: String(record['name'] ?? ''),
          arguments: asRecord(record['arguments']) ?? {},
        });
        break;
      default:
        // An unrecognized block kind is skipped, not rendered as noise. MINOR
        // protocol bumps are additive, so this is expected rather than broken.
        break;
    }
  }
  return blocks;
}

function readTimestamp(record: Record<string, unknown>): number | null {
  const value = record['timestamp'];
  return typeof value === 'number' ? value : null;
}

export function readEntry(raw: unknown): Entry {
  const record = asRecord(raw);
  if (!record) return { kind: 'unknown', raw };

  switch (record['role']) {
    case 'user':
      return { kind: 'user', blocks: readBlocks(record['content']), timestamp: readTimestamp(record) };
    case 'assistant':
      return { kind: 'assistant', blocks: readBlocks(record['content']), timestamp: readTimestamp(record) };
    case 'toolResult':
      return {
        kind: 'toolResult',
        toolCallId: String(record['tool_call_id'] ?? ''),
        toolName: String(record['tool_name'] ?? ''),
        blocks: readBlocks(record['content']),
        isError: record['is_error'] === true,
        details: asRecord(record['details']),
        timestamp: readTimestamp(record),
      };
    case 'system': {
      const blocks = readBlocks(record['content']);
      const text = blocks
        .filter((b): b is TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      return { kind: 'system', text };
    }
    default:
      return { kind: 'unknown', raw };
  }
}

export function readEntries(messages: unknown[]): Entry[] {
  return messages.map(readEntry);
}

/** Flatten a content block list to plain text, for a collapsed preview. */
export function blocksToText(blocks: ContentBlock[]): string {
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
