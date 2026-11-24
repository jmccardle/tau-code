/* eslint-disable */
/**
 * GENERATED FILE -- DO NOT EDIT.
 *
 * From packages/protocol/schema/protocol.schema.json, the pinned copy of `tau serve --schema`.
 * Regenerate with `npm run generate`; `npm run check:protocol` fails when either is stale.
 *
 * τ wire protocol: JSON-RPC 2.0, one message per WebSocket text message (D21).
 */

/** The protocol `hello` names. The server refuses any other number (`ProtocolMismatch`). */
export const PROTOCOL = 2 as const;

/** Nodes added to the tree, in id order, bodies included. */
export interface Appended {
  kind: "Appended";
  nodes: Node[];
  [key: string]: unknown;
}

export type Author = "Provider" | "Tools" | "Core" | {
  Frontend: string;
} | {
  Extension: string;
};

export type Body = {
  System: string;
} | {
  User: string;
} | {
  Assistant: {
    /**
     * The provider's own finish string, verbatim; `None` when it sent none (an interrupted reply,
     * a failed sample).
     */
    finish_reason?: string | null;
    /**
     * What the response carried besides its parts (model, id, usage...), as JSON object text.
     * Opaque to core; `None` when the provider sent none.
     */
    meta?: string | null;
    parts: Part[];
    stop: Stop;
    [key: string]: unknown;
  };
} | {
  Results: [string, Outcome, Author][];
} | {
  Config: Config;
} | {
  Custom: {
    data: string;
    kind: string;
    [key: string]: unknown;
  };
};

/** More of call `index`'s argument text (`args_raw`). */
export interface CallArgs {
  kind: "CallArgs";
  index: number;
  text: string;
  [key: string]: unknown;
}

/** A call begins forming: call number `index` in this reply, with its `id` and tool. */
export interface CallNamed {
  kind: "CallNamed";
  index: number;
  id: string;
  tool: string;
  [key: string]: unknown;
}

/** A config snapshot. `data` is opaque to core and typed by the driver. */
export interface Config {
  data: string;
  [key: string]: unknown;
}

/**
 * Cursor `cursor` is closed (D17): a client drops its view of it. `at` is the node it was last at,
 * for restarting (`reopen`). A cursor has one state event at a time: its `CursorView` while open,
 * this after it closes. Labels may still name it: they are its restart record.
 */
export interface CursorGone {
  kind: "CursorGone";
  cursor: number;
  at: number;
  [key: string]: unknown;
}

/**
 * One cursor as a client sees it, whole: where it is (`at`), whether a step is running (`busy`),
 * `auto`-step, its open `questions` (oldest first), its pending `items` (an `ItemData.Input` says
 * who wrote it: its `by`), and how its last step ended (`ending`) with the `hook_error` that ended
 * it, if a cursor hook failed in it. Both are `None` from the start of a step until it ends, and
 * after a reload. `model` is the qualified name of the model the cursor's branch is on (what its
 * next sample uses), `None` if no `Config` on the branch names one or one is unreadable (a sample
 * says which). `shown` is what each extension shows on the cursor (`Cursor.show`), as `(extension,
 * text)` pairs in extension-name order; it is not in the log, so it is empty after a reload.
 */
export interface CursorView {
  kind: "CursorView";
  cursor: number;
  at: number;
  busy: boolean;
  auto: boolean;
  questions: OpenQuestion[];
  items: Item[];
  ending: Ending | null;
  hook_error: HookFailure | null;
  model: string | null;
  shown: [string, string][];
  [key: string]: unknown;
}

/**
 * The params of the last message: the notification `end`. `error` is null when the driver stopped,
 * else `CutOff` or `Stopped`.
 */
export interface End {
  error: null | Error;
  [key: string]: unknown;
}

/** How a step ended. Serde-encoded as the nodes are: it crosses the wire in a `CursorView`. */
export type Ending = "Done" | "Aborted" | {
  Halted: string;
} | {
  Failed: string;
};

/**
 * A JSON-RPC error object; `data` holds what a row needs to rebuild its exception
 * (`ProtocolMismatch`: `server`; `UnknownCommand`: `name`).
 */
export interface Error {
  code: ErrorCode;
  message: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

/** The error table (D21 section 5). */
export type ErrorCode = -32700 | -32600 | -32601 | -32602 | -32603 | -32001 | -32002 | -32003 | -32004 | -32005 | -32006 | -32007 | -32008 | -32009 | -32010 | -32011 | -32012 | -32013 | -32014;

/** The params of the notification `event`. */
export type Event = Live | CursorView | CursorGone | Labels | Appended | Notice;

/**
 * What a client knows of something it fills in: a command (its `name`, typed as `/name`, its
 * `description` and the `schema` of its arguments, with the named types' `"format"` and each
 * default, and the `extension` that owns it) or an extension's options (the `name` of the
 * extension, and a `schema` whose defaults are the values now; `extension` is `None`, as it is for
 * `/config`). A command is called by its `qualified` name, `extension:name`, which on the wire a
 * client writes itself from the two fields. A command that `yields` gives its bare name up to any
 * other command that has it (`/model` stays the built-in's; the yielding one is only
 * `/skills:model`). Frozen, compared by value, and not hashable: the schema is a dict.
 */
export interface Form {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  extension?: string | null;
  yields?: boolean;
  [key: string]: unknown;
}

/**
 * A cursor hook of `extension` raised, or broke its contract, at hook `point` (`"pre_step"`,
 * `"post_step"`, ...). `error` is `"Type: msg"`, the text a `post_step` hook sees in
 * `Ending.Failed`.
 */
export interface HookFailure {
  extension: string;
  point: string;
  error: string;
  [key: string]: unknown;
}

/**
 * One image in a tool result (D30): its type, its identity and its size. The bytes are not in this
 * encoding: the session keeps them beside its log, named by `sha256`.
 */
export interface Image {
  /** Height in pixels. */
  height: number;
  /** `image/png`, `image/jpeg`, `image/gif` or `image/webp`. */
  mime: string;
  /**
   * Lowercase hex of the SHA-256 of the bytes: the image's identity. Exactly 64 of `0-9a-f`: a
   * decode refuses anything else, so the name is safe to use as a file name.
   */
  sha256: string;
  /** Width in pixels. */
  width: number;
  [key: string]: unknown;
}

export interface Item {
  data: ItemData;
  id: number;
  to: number;
  [key: string]: unknown;
}

export type ItemData = {
  Input: {
    by: Author;
    text: string;
    [key: string]: unknown;
  };
} | {
  Extension: {
    data: string;
    name: string;
    [key: string]: unknown;
  };
};

/** Every label and the cursor it is on, in label order. */
export interface Labels {
  kind: "Labels";
  labels: [string, number][];
  [key: string]: unknown;
}

/**
 * A delta, on the cursor whose sample or tool call produced it. Never in the tree: a client draws
 * it as a layer over the cursor. Only a client watching the cursor hears it.
 */
export interface Live {
  kind: "Live";
  cursor: number;
  delta: TextDelta | ThinkingDelta | CallNamed | CallArgs | Retrying | ToolProgress;
  [key: string]: unknown;
}

export interface Node {
  body: Body;
  by: Author;
  /**
   * The node this one repeats verbatim (a compaction or prune copy). A log written before this
   * field existed has none.
   */
  copied_from?: number | null;
  delivers: number[];
  /**
   * The node whose walk this one's content was computed from (a summary, a pruned transcript). A
   * log written before this field existed has none.
   */
  derived_from?: number | null;
  id: number;
  parent?: number | null;
  time: number;
  /**
   * What a person typed, for a `User` node whose text a `pre_input` hook changed (the attachments
   * extension inlines files). Set only when it differs from the text: the node's `body` is what
   * the model sees, this is what to put back in an editor. A log written before this field existed
   * has none.
   */
  typed?: string | null;
  [key: string]: unknown;
}

/**
 * A message for one client, or for all of them: `cursor.tell` (to every client unless it names
 * one), or an input a hook refused (to its author).
 */
export interface Notice {
  kind: "Notice";
  text: string;
  [key: string]: unknown;
}

/**
 * A question an extension asked and nobody has answered: `id` (what `answer` names), whom it is
 * for (`to`: a client id, `None` for anyone), the `extension` that asked, what it asks, and the
 * JSON Schema of the answer.
 */
export interface OpenQuestion {
  id: number;
  to: string | null;
  extension: string;
  text: string;
  schema: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * `Outcome` as the log and the wire encode it: `Ok` without images is a string, as before D30, so
 * a log written before images loads unchanged.
 */
export type Outcome = "Interrupted" | {
  /** `Outcome::Ok`'s two encodings: the text alone, or the text with its images. */
  Ok: string | {
    images: Image[];
    value: string;
    [key: string]: unknown;
  };
} | {
  Err: string;
};

/**
 * A command line, read: the `command` form, its `args` (decoded JSON), and the `missing` required
 * parameters, in order, which a frontend asks for. For `/config <extension>` the `command` is the
 * extension's options form, `args` the options to change and `extension` its name; with no `args`
 * the line asks for the form, which a frontend shows from `Client.options`. `save` is whether
 * `--save` was typed. `run` makes the call.
 */
export interface Parsed {
  command: Form;
  args: Record<string, unknown>;
  missing: string[];
  extension?: string | null;
  save?: boolean;
  [key: string]: unknown;
}

/**
 * One piece of a reply. `replay` is `None` unless the provider kept data to send back. Logs
 * written before replay existed load as `None`.
 */
export type Part = {
  Text: Prose;
} | {
  Thinking: Prose;
} | {
  Call: {
    args_raw: string;
    id: string;
    replay?: Replay;
    tool: string;
    [key: string]: unknown;
  };
};

/**
 * A string is plain; an object is signed. Deserialized by hand because `untagged` would drop the
 * reason a bad replay was refused.
 */
export type Prose = string | {
  replay: Replay;
  text: string;
  [key: string]: unknown;
};

/**
 * Data only the provider that wrote a part can send back (a signature, a redacted block). `data`
 * is the text of a JSON object with no repeated key, kept exactly as given and opaque to core
 * beyond that; `provider` names who may send it back.
 */
export interface Replay {
  data: string;
  provider: string;
  [key: string]: unknown;
}

/**
 * A provider is waiting to try the sample again (D24 section 4): this is retry `attempt` of
 * `attempts`, after `seconds`, because the last try failed with `reason`. It is no part of the
 * reply: it says what the sample is doing now, and the next delta (or the end of the sample)
 * replaces it. A client that starts watching during the wait is told it, with the seconds left.
 */
export interface Retrying {
  kind: "Retrying";
  attempt: number;
  attempts: number;
  seconds: number;
  reason: string;
  [key: string]: unknown;
}

export type Stop = "End" | "Tools" | "Length" | "Interrupted" | "Error" | "Refused";

/** Text of the reply arriving. */
export interface TextDelta {
  kind: "TextDelta";
  text: string;
  [key: string]: unknown;
}

/** Thinking text arriving. */
export interface ThinkingDelta {
  kind: "ThinkingDelta";
  text: string;
  [key: string]: unknown;
}

/**
 * A running call showing partial output: `text` is new output since the last `ToolProgress` of the
 * same call, not the whole so far. The call is named by `node`, the batch's node (the `Assistant`
 * node holding the call), and `call_id`: a server may reuse ids across batches, so the id alone
 * does not say which call. Only the driver makes one (a tool calls its `progress`); a provider
 * cannot yield one. What the call saves is its `Outcome`, never this.
 */
export interface ToolProgress {
  kind: "ToolProgress";
  node: number;
  call_id: string;
  text: string;
  [key: string]: unknown;
}

/**
 * What `hello` answers: the `protocol` the server speaks, its τ `version`, the `session` id it
 * serves, the `cwd` that session runs in (paths complete there), and its `pid`.
 */
export interface Welcome {
  protocol: number;
  version: string;
  session: string;
  cwd: string;
  pid: number;
  [key: string]: unknown;
}

/** Abort the cursor's step and decline its open questions. */
export interface AbortParams {
  cursor: number;
}
/** What `abort` answers. */
export type AbortResult = null;

/**
 * Answer an open question with a decoded JSON value; `None` declines. `ValueError` if the value is
 * wrong (the question stays open), `LookupError` if the question is closed or unknown (the first
 * good answer wins), `PermissionError` if it is for another client.
 */
export interface AnswerParams {
  question: number;
  value: unknown;
}
/** What `answer` answers. */
export type AnswerResult = null;

/** The ids of the children of node `id`, in append order. */
export interface ChildrenParams {
  id: number;
}
/** What `children` answers. */
export type ChildrenResult = number[];

/**
 * Close the cursor (D17): abort its step as `abort` does, wait for it to rest, drop its pending
 * items, and close it. Clients are sent a `CursorGone`. Its id, last node and labels stay;
 * `reopen` restarts from them. `CursorClosed` if it is already closed.
 */
export interface CloseCursorParams {
  cursor: number;
}
/** What `close_cursor` answers. */
export type CloseCursorResult = null;

/**
 * Each command's form: its name, description and argument schema (named types with their
 * `"format"`, each default), fixed until the driver reloads. If some extension has options there
 * is one more, `config`, whose one argument is the extension; it is changed with `configure`, not
 * `run`.
 */
export type CommandsParams = Record<string, never>;
/** What `commands` answers. */
export type CommandsResult = Form[];

/**
 * The values of a named type (`"path"`, `"model"`, `"cursor"`, `"label"`, `"node"`; the `"format"`
 * of a schema) that start with `prefix`, as `cursor` sees them. Paths are the driver's machine's,
 * relative to its working directory.
 */
export interface CompleteParams {
  cursor: number;
  named: string;
  prefix: string;
}
/** What `complete` answers. */
export type CompleteResult = string[];

/** `commandline.completions` of `line` on the driver: what could finish its last word, in one call. */
export interface CompleteLineParams {
  cursor: number;
  line: string;
}
/** What `complete_line` answers. */
export type CompleteLineResult = string[];

/**
 * Change the options named in `values` (decoded JSON) of `extension` on `cursor`'s branch: a step
 * of the cursor writes a `Config` node. With `save`, the server also writes the user's config file
 * (`extensions.<name>`), which every session reads: the options in `values` and those a `Config`
 * node on the branch set, wherever they differ from the file's (options equal to the file's stay
 * untouched; `values` may be `{}`; options only the user, project or command-line layers set are
 * not copied). A client needs no access to that file. `ConfigError` for an extension without
 * options, or values its options type refuses (or, with `save`, a driver with no user config),
 * `Busy` unless the cursor is at rest; nothing is written then, neither node nor file.
 */
export interface ConfigureParams {
  cursor: number;
  extension: string;
  values: Record<string, unknown>;
  save?: boolean;
}
/** What `configure` answers. */
export type ConfigureResult = null;

/** Move the cursor to node `to`, aborting a busy step (which declines its open questions). */
export interface GoToParams {
  cursor: number;
  to: number;
}
/** What `go_to` answers. */
export type GoToResult = null;

/**
 * The first message of a connection: the protocol the client speaks, its stable `client` id
 * (`john@laptop:vscode`) and the `buffer` of its event stream (the server's default if left out).
 * A different protocol is `ProtocolMismatch`. The server answers `Welcome`.
 */
export interface HelloParams {
  protocol: number;
  client: string;
  buffer?: number | null;
}
/** What `hello` answers. */
export type HelloResult = Welcome;

/** Add `text` to the cursor's scratchpad as this client's input; returns the item. */
export interface InputParams {
  cursor: number;
  text: string;
}
/** What `input` answers. */
export type InputResult = number;

/** The node with this id; `NoSuchNode` if there is none. */
export interface NodeParams {
  id: number;
}
/** What `node` answers. */
export type NodeResult = Node;

/**
 * Up to `limit` nodes from id `start`, in id order; none past the end. Ids are dense and a node
 * never changes, so a tree is read in ranges. `ValueError` for a negative `start` or `limit`.
 */
export interface NodesParams {
  start: number;
  limit: number;
}
/** What `nodes` answers. */
export type NodesResult = Node[];

/** Open a cursor at node `at`; it wakes. Returns its id. */
export interface OpenParams {
  at: number;
}
/** What `open` answers. */
export type OpenResult = number;

/**
 * `extension`'s options as they stand at `cursor`: a form whose schema has every option, each
 * default the value now. `ConfigError` if it has no options.
 */
export interface OptionsParams {
  cursor: number;
  extension: string;
}
/** What `options` answers. */
export type OptionsResult = Form;

/**
 * `commandline.parse` of `line` with this driver's forms and the options forms `cursor` sees: the
 * command, its arguments, and the required parameters still `missing`. `UnknownCommand` if no
 * command has the name (send the line as text), `ValueError` for a line that cannot be read, plain
 * `LookupError` for a bare name two extensions share.
 */
export interface ParseLineParams {
  cursor: number;
  line: string;
}
/** What `parse_line` answers. */
export type ParseLineResult = Parsed;

/**
 * Take back a pending input this client added to `cursor` (`input` or `send`): it is removed from
 * the scratchpad before the cursor delivers it. `LookupError` once it is delivered, or if there is
 * no such item on the cursor; `PermissionError` for an item another client or an extension added.
 * Wakes nothing and does not turn auto-step off.
 */
export interface RemoveItemParams {
  cursor: number;
  item: number;
}
/** What `remove_item` answers. */
export type RemoveItemResult = null;

/** Remove `label`; `NoSuchLabel` if there is none. */
export interface RemoveLabelParams {
  label: string;
}
/** What `remove_label` answers. */
export type RemoveLabelResult = null;

/**
 * Open a new cursor at the closed `cursor`'s last node, and move each of its labels onto it.
 * Returns the new id. `ValueError` if `cursor` is open, `NoSuchCursor` if it was never opened.
 */
export interface ReopenParams {
  cursor: number;
}
/** What `reopen` answers. */
export type ReopenResult = number;

/**
 * Run `/command` (`"note"`, or `"a:note"`, the extension's qualified name) with decoded JSON
 * `args` on `cursor`; returns the command's result (`None` if it has none) once it has finished.
 * `CommandFailed` (its message is the failure as `"Type: msg"`) if it raised, or was aborted; it
 * is raised as soon as the command raises, even when the command's step has not yet ended: the
 * cursor may still be busy for a moment while the step ends, and a retry then gets `Busy`. A
 * command's `progress` and `cursor.tell` arrive as `Notice`s. `LookupError` for an unknown command
 * or a bare name two extensions share (`"/note is two commands: /a:note, /b:note"`), `ValueError`
 * naming the problem for arguments that fit no parameter (the values are checked with the session,
 * `"new"` last), `Busy` for a command that runs as a step of the cursor when it is not at rest.
 */
export interface RunParams {
  cursor: number;
  command: string;
  args: Record<string, unknown>;
}
/** What `run` answers. */
export type RunResult = string | null;

/** `input` with auto-step on. */
export interface SendParams {
  cursor: number;
  text: string;
}
/** What `send` answers. */
export type SendResult = number;

/** Turn `cursor`'s auto-step on or off; on wakes it. */
export interface SetAutoParams {
  cursor: number;
  on: boolean;
}
/** What `set_auto` answers. */
export type SetAutoResult = null;

/** Put `label` on `cursor`; a label set elsewhere moves. */
export interface SetLabelParams {
  cursor: number;
  label: string;
}
/** What `set_label` answers. */
export type SetLabelResult = null;

/** Start a step on a cursor at rest; `Busy` otherwise. */
export interface StepParams {
  cursor: number;
}
/** What `step` answers. */
export type StepResult = null;

/** The nodes from the root to `id`. */
export interface WalkParams {
  id: number;
}
/** What `walk` answers. */
export type WalkResult = Node[];

/**
 * Hear the `Live` of exactly these cursors from now on (a call replaces the last), starting with
 * what each sample in flight has streamed that is not in the tree yet.
 */
export interface WatchParams {
  cursors: number[];
}
/** What `watch` answers. */
export type WatchResult = null;

/** Every method's params, by its name. */
export interface Requests {
  abort: AbortParams;
  answer: AnswerParams;
  children: ChildrenParams;
  close_cursor: CloseCursorParams;
  commands: CommandsParams;
  complete: CompleteParams;
  complete_line: CompleteLineParams;
  configure: ConfigureParams;
  go_to: GoToParams;
  hello: HelloParams;
  input: InputParams;
  node: NodeParams;
  nodes: NodesParams;
  open: OpenParams;
  options: OptionsParams;
  parse_line: ParseLineParams;
  remove_item: RemoveItemParams;
  remove_label: RemoveLabelParams;
  reopen: ReopenParams;
  run: RunParams;
  send: SendParams;
  set_auto: SetAutoParams;
  set_label: SetLabelParams;
  step: StepParams;
  walk: WalkParams;
  watch: WatchParams;
}

/** What each method answers, by its name. */
export interface Results {
  abort: AbortResult;
  answer: AnswerResult;
  children: ChildrenResult;
  close_cursor: CloseCursorResult;
  commands: CommandsResult;
  complete: CompleteResult;
  complete_line: CompleteLineResult;
  configure: ConfigureResult;
  go_to: GoToResult;
  hello: HelloResult;
  input: InputResult;
  node: NodeResult;
  nodes: NodesResult;
  open: OpenResult;
  options: OptionsResult;
  parse_line: ParseLineResult;
  remove_item: RemoveItemResult;
  remove_label: RemoveLabelResult;
  reopen: ReopenResult;
  run: RunResult;
  send: SendResult;
  set_auto: SetAutoResult;
  set_label: SetLabelResult;
  step: StepResult;
  walk: WalkResult;
  watch: WatchResult;
}

export type Method = keyof Requests;

/** A `Live` event's `delta`. */
export type Delta = TextDelta | ThinkingDelta | CallNamed | CallArgs | Retrying | ToolProgress;

/** Every method, in the schema's order. */
export const METHODS = ["abort","answer","children","close_cursor","commands","complete","complete_line","configure","go_to","hello","input","node","nodes","open","options","parse_line","remove_item","remove_label","reopen","run","send","set_auto","set_label","step","walk","watch"] as const;
/** Every event `kind`, in the schema's order. */
export const EVENT_KINDS = ["Live","CursorView","CursorGone","Labels","Appended","Notice"] as const;
/** Every delta `kind`, in the schema's order. */
export const DELTA_KINDS = ["TextDelta","ThinkingDelta","CallNamed","CallArgs","Retrying","ToolProgress"] as const;

/** Each `ErrorCode` by its name (`x-names`). */
export const ERROR_CODES = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  Internal: -32603,
  Busy: -32001,
  NoSuchCursor: -32002,
  CursorClosed: -32003,
  NoSuchNode: -32004,
  NoSuchLabel: -32005,
  ProtocolMismatch: -32006,
  NotFound: -32007,
  UnknownCommand: -32008,
  Refused: -32009,
  NotYours: -32010,
  CommandFailed: -32011,
  ConfigError: -32012,
  Stopped: -32013,
  CutOff: -32014,
} as const;
/** The Python exception τ's `RemoteClient` raises for each `ErrorCode` (`x-raises`). */
export const ERROR_CODE_RAISES = {
  ParseError: "ProtocolError",
  InvalidRequest: "ProtocolError",
  MethodNotFound: "ProtocolError",
  InvalidParams: "TypeError",
  Internal: "RuntimeError",
  Busy: "Busy",
  NoSuchCursor: "NoSuchCursor",
  CursorClosed: "CursorClosed",
  NoSuchNode: "NoSuchNode",
  NoSuchLabel: "NoSuchLabel",
  ProtocolMismatch: "ProtocolMismatch",
  NotFound: "LookupError",
  UnknownCommand: "UnknownCommand",
  Refused: "ValueError",
  NotYours: "PermissionError",
  CommandFailed: "CommandFailed",
  ConfigError: "ConfigError",
  Stopped: "ConnectionError",
  CutOff: "CutOff",
} as const;
