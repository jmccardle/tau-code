/* eslint-disable */
/**
 * GENERATED FILE -- DO NOT EDIT.
 *
 * Regenerate with `npm run generate`, which reads `tau serve --schema` from the
 * installed τ. τ's protocol dataclasses are the source of truth; nothing here is
 * hand-maintained, and `npm run check:protocol` fails when this file is stale.
 *
 * tau serve protocol 0.2
 */

/** The protocol version `hello` must name. */
export const PROTOCOL_VERSION = "0.2" as const;
/** The port `tau serve` listens on when its config names none. */
export const DEFAULT_PORT = 8256 as const;

/** Abort the turn running on a cursor, and the cursors it owns. */
export interface Abort {
  cursor_id: string;
  session_id: string;
  type: "abort";
  [key: string]: unknown;
}

/** Answer an extension's form (a ``request`` event); the first answer wins. */
export interface Answer {
  request_id: string;
  session_id: string;
  type: "answer";
  value: Record<string, unknown> | null;
  [key: string]: unknown;
}

/** Answer an extension request written in the tree (docs/EXTENSION-LOCKS.md §3). */
export interface AnswerRequest {
  action: string;
  cursor_id: string;
  request_id: string;
  session_id: string;
  type: "answer_request";
  values?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Start receiving a session's events, loading it in the daemon if needed. */
export interface Attach {
  epoch?: string | null;
  session_id: string;
  since?: number | null;
  type: "attach";
  [key: string]: unknown;
}

/** The answer to :class:`Attach`. */
export interface Attached {
  cursors: CursorState[];
  cwd: string;
  entries: Record<string, unknown>[] | null;
  epoch: string;
  head_cursor_id: string;
  models: ModelRecord[];
  seq: number;
  session_id: string;
  surface: Surface;
  [key: string]: unknown;
}

/** Close a cursor this session opened; its branch stays in the tree. */
export interface CloseCursor {
  cursor_id: string;
  session_id: string;
  type: "close_cursor";
  [key: string]: unknown;
}

/** One slash command a session answers, as RPC ``get_commands`` lists it. */
export interface CommandInfo {
  description: string;
  flow: boolean;
  hidden: boolean;
  name: string;
  origin: "builtin" | "extension";
  [key: string]: unknown;
}

/** Open one cursor per model at ``leaf`` and send each the same text (docs/TAU-SERVE.md §8). */
export interface Compare {
  leaf?: string | null;
  models: string[];
  session_id: string;
  text: string;
  type: "compare";
  [key: string]: unknown;
}

/** Complete the ``@path`` at ``offset`` in ``text`` against the session's cwd. */
export interface CompletePath {
  offset: number;
  session_id: string;
  text: string;
  type: "complete_path";
  [key: string]: unknown;
}

/** Create a session in ``cwd``, a path on the daemon's machine. */
export interface CreateSession {
  cwd: string;
  model?: string | null;
  name?: string | null;
  type: "create_session";
  [key: string]: unknown;
}

/** A live cursor as clients see it; sent whenever one opens, moves, closes or changes busy. */
export interface CursorState {
  busy: boolean;
  cursor_id: string;
  label: string;
  leaf: string | null;
  model: string;
  owner_id: string | null;
  [key: string]: unknown;
}

/** Re-read a session's extension surface, after an extension was enabled or reloaded. */
export interface Describe {
  session_id: string;
  type: "describe";
  [key: string]: unknown;
}

/** Stop receiving a session's events. The session keeps running. */
export interface Detach {
  session_id: string;
  type: "detach";
  [key: string]: unknown;
}

/**
 * End a comparison: the head cursor moves onto ``keep``'s leaf, and every compare cursor
 * closes.
 */
export interface EndCompare {
  comparison_id: string;
  keep: string | null;
  session_id: string;
  type: "end_compare";
  [key: string]: unknown;
}

/** The values legal for a domain right now (RPC ``enumerate_domain``). */
export interface EnumerateDomain {
  domain: string;
  leaf?: string | null;
  limit?: number;
  query?: string;
  scope?: "in_session" | "ancestors_of_cursor" | "descendants_of_cursor" | null;
  session_id: string;
  type: "enumerate_domain";
  [key: string]: unknown;
}

/** Why a request failed. ``code`` is stable; ``message`` is for a human. */
export interface Error {
  code: "bad_request" | "unauthorized" | "protocol_mismatch" | "not_found" | "busy" | "failed";
  message: string;
  [key: string]: unknown;
}

/** A push for an attached session, numbered per session within an ``epoch``. */
export interface Event {
  data?: Record<string, unknown>;
  epoch: string;
  kind: "entry_open" | "entry_final" | "entry_append" | "agent_event" | "channel" | "cursors" | "request" | "request_closed" | "ui";
  seq: number;
  session_id: string;
  type: "event";
  [key: string]: unknown;
}

/** One loaded extension and what it registered, as RPC ``get_extension_state`` lists it. */
export interface ExtensionInfo {
  commands: string[];
  content_hash: string;
  hooks: string[];
  name: string;
  path: string;
  shortcuts: string[];
  subjects: string[];
  tools: string[];
  [key: string]: unknown;
}

/** Copy a session into a new one in the same cwd; answered with ``{session_id}``. */
export interface ForkSession {
  at: string | null;
  session_id: string;
  type: "fork_session";
  [key: string]: unknown;
}

/** Every entry of a session's tree as a browser row, seen from one cursor. */
export interface GetTree {
  cursor_id: string;
  session_id: string;
  type: "get_tree";
  [key: string]: unknown;
}

/** The first request on every connection; nothing else is served before it. */
export interface Hello {
  client: string;
  protocol: string;
  token?: string | null;
  type: "hello";
  [key: string]: unknown;
}

/** Every session in the daemon's store, across every cwd, newest first. */
export interface ListSessions {
  type: "list_sessions";
  [key: string]: unknown;
}

/** One model the daemon's config defines, as RPC ``get_models`` lists it. */
export interface ModelRecord {
  model: ModelSpec;
  name: string;
  [key: string]: unknown;
}

/** What a config model name resolves to. */
export interface ModelSpec {
  context_window: number;
  id: string;
  provider: string;
  [key: string]: unknown;
}

/** Move a cursor to ``leaf``. Writes nothing. */
export interface MoveCursor {
  cursor_id: string;
  leaf: string | null;
  session_id: string;
  type: "move_cursor";
  [key: string]: unknown;
}

/** The next argument a flow needs, or the mutation it is ready for (RPC ``next_step``). */
export interface NextStep {
  bound?: Record<string, unknown> | null;
  flow: string;
  leaf?: string | null;
  session_id: string;
  type: "next_step";
  [key: string]: unknown;
}

/** Open a cursor at ``leaf`` (an entry id, or ``None`` before the root). */
export interface OpenCursor {
  label?: string;
  leaf: string | null;
  owner_id?: string | null;
  session_id: string;
  type: "open_cursor";
  [key: string]: unknown;
}

/** Call one of the session backend's operations, acting at ``cursor_id``. */
export interface Perform {
  arguments?: Record<string, unknown>;
  cursor_id: string;
  method: string;
  session_id: string;
  type: "perform";
  [key: string]: unknown;
}

/** The one answer to a request, matched by ``id``. */
export interface Response {
  error?: Error | null;
  id: number;
  ok: boolean;
  result?: unknown;
  type: "response";
  [key: string]: unknown;
}

/** One line of :class:`ListSessions`' answer. */
export interface SessionRow {
  cwd: string;
  first_message: string;
  id: string;
  loaded: boolean;
  message_count: number;
  modified: string;
  name: string | null;
  [key: string]: unknown;
}

/** Switch the model a cursor's next turn runs, by a name from the daemon's config. */
export interface SetModel {
  cursor_id: string;
  model: string;
  session_id: string;
  type: "set_model";
  [key: string]: unknown;
}

/** Send text to a cursor: a prompt, or a ``/command`` when ``expand_commands``. */
export interface Submit {
  cursor_id: string;
  expand_commands?: boolean;
  images?: Record<string, unknown>[] | null;
  multitask_strategy?: "enqueue" | "reject" | "steer" | "follow_up";
  session_id: string;
  submission_id?: string | null;
  text: string;
  type: "submit";
  [key: string]: unknown;
}

/** How a submission ended; a refusal is an answer, not an error. */
export interface SubmitResult {
  accepted: boolean;
  command?: Record<string, unknown> | null;
  reason?: string | null;
  submission_id: string;
  [key: string]: unknown;
}

/** What a session answers beyond its tree, which a head reads without a round trip. */
export interface Surface {
  command_args: Record<string, string | null>;
  commands: CommandInfo[];
  extensions: unknown[][];
  load_errors: string[][];
  loaded: ExtensionInfo[];
  shortcuts: string[][];
  [key: string]: unknown;
}

/** One :class:`GetTree` row: RPC ``get_tree``'s node, with ``is_cursor`` named ``is_leaf``. */
export interface TreeRow {
  copyable: boolean;
  entry_id: string;
  estimated_tokens: number;
  first_kept_id: string | null;
  from_id: string | null;
  is_leaf: boolean;
  is_system: boolean;
  kind: string;
  parent_id: string | null;
  preview: string;
  role: string | null;
  timestamp: number | null;
  tool_call_id: string | null;
  tool_call_ids: string[];
  [key: string]: unknown;
}

/** Every frame a client sends. */
export type ClientFrame = Hello & {
  id?: number;
  [key: string]: unknown;
} | ListSessions & {
  id?: number;
  [key: string]: unknown;
} | CreateSession & {
  id?: number;
  [key: string]: unknown;
} | Attach & {
  id?: number;
  [key: string]: unknown;
} | Detach & {
  id?: number;
  [key: string]: unknown;
} | Submit & {
  id?: number;
  [key: string]: unknown;
} | Abort & {
  id?: number;
  [key: string]: unknown;
} | OpenCursor & {
  id?: number;
  [key: string]: unknown;
} | CloseCursor & {
  id?: number;
  [key: string]: unknown;
} | MoveCursor & {
  id?: number;
  [key: string]: unknown;
} | SetModel & {
  id?: number;
  [key: string]: unknown;
} | Answer & {
  id?: number;
  [key: string]: unknown;
} | AnswerRequest & {
  id?: number;
  [key: string]: unknown;
} | Perform & {
  id?: number;
  [key: string]: unknown;
} | Describe & {
  id?: number;
  [key: string]: unknown;
} | Compare & {
  id?: number;
  [key: string]: unknown;
} | EndCompare & {
  id?: number;
  [key: string]: unknown;
} | NextStep & {
  id?: number;
  [key: string]: unknown;
} | EnumerateDomain & {
  id?: number;
  [key: string]: unknown;
} | CompletePath & {
  id?: number;
  [key: string]: unknown;
} | GetTree & {
  id?: number;
  [key: string]: unknown;
} | ForkSession & {
  id?: number;
  [key: string]: unknown;
};

/** Every frame the daemon sends. */
export type ServerFrame = Response | Event;

/** Every request, by its `type`. */
export interface Requests {
  abort: Abort;
  answer: Answer;
  answer_request: AnswerRequest;
  attach: Attach;
  close_cursor: CloseCursor;
  compare: Compare;
  complete_path: CompletePath;
  create_session: CreateSession;
  describe: Describe;
  detach: Detach;
  end_compare: EndCompare;
  enumerate_domain: EnumerateDomain;
  fork_session: ForkSession;
  get_tree: GetTree;
  hello: Hello;
  list_sessions: ListSessions;
  move_cursor: MoveCursor;
  next_step: NextStep;
  open_cursor: OpenCursor;
  perform: Perform;
  set_model: SetModel;
  submit: Submit;
}

/** What each request answers, by its `type`. */
export interface Results {
  abort: null;
  answer: null;
  answer_request: null;
  attach: Attached;
  close_cursor: null;
  compare: null;
  complete_path: null;
  create_session: null;
  describe: null;
  detach: null;
  end_compare: null;
  enumerate_domain: null;
  fork_session: null;
  get_tree: null;
  hello: null;
  list_sessions: null;
  move_cursor: null;
  next_step: null;
  open_cursor: null;
  perform: null;
  set_model: null;
  submit: null;
}

export type RequestType = keyof Requests;
export type RequestFields<T extends RequestType> = Omit<Requests[T], 'type'>;

/** The `data` each event kind carries, by its `kind`. */
export interface EventData {
  entry_open: Record<string, unknown>;
  entry_final: Record<string, unknown>;
  entry_append: Record<string, unknown>;
  agent_event: Record<string, unknown>;
  channel: Record<string, unknown>;
  cursors: {
    cursors: CursorState[];
    [key: string]: unknown;
  };
  request: Record<string, unknown>;
  request_closed: Record<string, unknown>;
  ui: Record<string, unknown>;
}

export type EventKind = keyof EventData;

/** Every request type, in the schema's order. */
export const REQUEST_TYPES = ["abort","answer","answer_request","attach","close_cursor","compare","complete_path","create_session","describe","detach","end_compare","enumerate_domain","fork_session","get_tree","hello","list_sessions","move_cursor","next_step","open_cursor","perform","set_model","submit"] as const;
/** Every event kind, in the schema's order. */
export const EVENT_KINDS = ["entry_open","entry_final","entry_append","agent_event","channel","cursors","request","request_closed","ui"] as const;
