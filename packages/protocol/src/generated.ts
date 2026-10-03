/* eslint-disable */
/**
 * GENERATED FILE -- DO NOT EDIT.
 *
 * Regenerate with `npm run generate`, which reads `tau serve --schema` from the
 * installed τ. τ's protocol dataclasses are the source of truth; nothing here is
 * hand-maintained, and `npm run check:protocol` fails when this file is stale.
 *
 * tau serve protocol 0.4
 */

/** The protocol version `hello` must name. */
export const PROTOCOL_VERSION = "0.4" as const;
/** The port `tau serve` listens on when its config names none. */
export const DEFAULT_PORT = 8256 as const;

/** Abort the turn running on a cursor, and the cursors it owns. */
export interface Abort {
  cursor_id: string;
  session_id: string;
  type: "abort";
}

/** A `agent_event` event. */
export interface AgentEventEvent {
  data: WireEvent;
  epoch: string;
  kind: "agent_event";
  seq: number;
  session_id: string;
  type: "event";
  [key: string]: unknown;
}

/** Answer an extension's form (a `request` event); the first answer wins. */
export interface Answer {
  request_id: string;
  session_id: string;
  type: "answer";
  /** The `{field: value}` answers, or `None` to cancel the form. */
  value: Record<string, unknown> | null;
}

/** Answer an extension request written in the tree (docs/EXTENSION-LOCKS.md §3). */
export interface AnswerRequest {
  /** The label of the pressed action. */
  action: string;
  cursor_id: string;
  /** The request entry's id. */
  request_id: string;
  session_id: string;
  type: "answer_request";
  /** The filled fields, keyed by name. */
  values?: Record<string, unknown>;
}

/** One argument a flow needs before it can run. */
export interface Argument {
  /** `"one"` for a single value, `"many"` for a list. */
  cardinality?: "one" | "many";
  /** The prompt a head shows for it. */
  description: string;
  /** The name of its `Domain`, a key of `DOMAINS`. */
  domain: string;
  /** The argument's name, as the bound-argument mapping keys it. */
  name: string;
  /** Whether the flow can run without it. An optional argument is offered as a step and may be skipped. */
  required?: boolean;
  /** For the `message_id` domain, which entries are candidates — one of `ConversationTree.complete_message_id`'s scopes. `None` everywhere else. */
  scope?: "in_session" | "ancestors_of_cursor" | "descendants_of_cursor" | null;
  [key: string]: unknown;
}

/** What an extension request asks, normalized (`extension_types.validate_ask_spec`). */
export interface Ask {
  actions: AskAction[];
  body: PanelBody | null;
  fields: FormField[];
  title: string;
  [key: string]: unknown;
}

/** An ask's button: it runs `command` with the request's id. */
export interface AskAction {
  command: string;
  label: string;
  [key: string]: unknown;
}

/**
 * An assistant message from the LLM. Reference: SUBPHASE-0.0.md, "1. Messages" section.
 * ``timestamp`` is epoch milliseconds at the moment this message stopped being written — the
 * completion's end, or the abort for a partial. ``None`` means no clock applies, which is the
 * case for a synthetic message an extension built (docs/MESSAGE-TIMESTAMPS.md §2). It is never
 * 0: τ did not run in 1970, so a 0 is legacy data and the session stores map it to ``None`` on
 * load.
 */
export interface AssistantMessage {
  api: string;
  content: (TextContent | ThinkingContent | ToolCall)[];
  error_message?: string | null;
  model: string;
  provider: string;
  response_id?: string | null;
  role: "assistant";
  stop_reason: "stop" | "length" | "toolUse" | "error" | "aborted";
  timestamp?: number | null;
  usage?: Usage;
  [key: string]: unknown;
}

/** Start receiving a session's events, loading it in the daemon if needed. */
export interface Attach {
  /** The `epoch` of an earlier attach, to resume rather than re-read. */
  epoch?: string | null;
  /** The session, or an unambiguous prefix of its id. */
  session_id: string;
  /** The last `seq` the client applied under that epoch. */
  since?: number | null;
  type: "attach";
}

/** The answer to `Attach`. */
export interface Attached {
  cursors: CursorState[];
  cwd: string;
  entries: Entry[] | null;
  /** Changes when the daemon restarts or reloads the session; a client holding another epoch must take a snapshot. */
  epoch: string;
  /** The cursor a client drives unless it opens its own. */
  head_cursor_id: string;
  /** Every model the daemon's config defines, for a picker. */
  models: ModelRecord[];
  /** The extension forms open now, which an `Answer` closes. */
  requests: RequestEventData[];
  /** The newest event number folded into this answer. */
  seq: number;
  session_id: string;
  surface: Surface;
  [key: string]: unknown;
}

/** The `@` token at the caret and what it completes to. */
export interface AttachmentCompletion {
  /** The offset after its last. */
  end: number;
  matches: PathMatch[];
  /** The token's first character offset in the text. */
  start: number;
  token: string;
  /** How many paths match, counting past the bound on `matches`. */
  total: number;
  [key: string]: unknown;
}

/** What `Submit.expand_attachments` did. */
export interface AttachmentReport {
  /** How many `@` references were sent as attachments. */
  expanded: number;
  /** One line per file that resolved and could not be read. */
  failures: string[];
  /** How many of them were images. */
  images: number;
  /** The `@` tokens that named no file, sent as written. */
  unresolved: string[];
  [key: string]: unknown;
}

/** A summary of the branch left at `fromId`, in the path where it was appended. */
export interface BranchSummaryEntry {
  fromId: string | null;
  id: string;
  parentId: string | null;
  status?: never;
  summary: string;
  timestamp: string;
  type: "branch_summary";
  [key: string]: unknown;
}

/** A `channel` event. */
export interface ChannelEvent {
  data: ChannelEventData;
  epoch: string;
  kind: "channel";
  seq: number;
  session_id: string;
  type: "event";
  [key: string]: unknown;
}

/** A session bus channel, told apart by `name`. Changes no state. */
export type ChannelEventData = SubmissionStartChannel | SubmissionEndChannel | CustomMessageChannel;

/** Close a cursor this session opened; its branch stays in the tree. */
export interface CloseCursor {
  cursor_id: string;
  session_id: string;
  type: "close_cursor";
}

/** One slash command a session answers, as RPC `get_commands` lists it. */
export interface CommandInfo {
  description: string;
  /** Whether `NextStep` steps it. */
  flow: boolean;
  /** A qualified extension name (`ext:pirate.speak`): it resolves, and a completion list leaves it out. */
  hidden: boolean;
  name: string;
  /** `builtin` for τ's own, `extension` for one an extension registered. */
  origin: "builtin" | "extension";
  [key: string]: unknown;
}

/** A `Perform` whose operation returned a `CompactionResult` (`compact`). */
export interface CompactionAnswer {
  fields: CompactionResult;
  kind: "CompactionResult";
  [key: string]: unknown;
}

/** File-operation details stored alongside a compaction (pi: CompactionDetails). */
export interface CompactionDetails {
  modified_files?: string[];
  read_files?: string[];
  [key: string]: unknown;
}

/** A summary that replaces the path before `firstKeptId` in the context. */
export interface CompactionEntry {
  configId?: string | null;
  coveredEntries?: number;
  coveredTokens?: number;
  firstKeptId: string;
  id: string;
  parentId: string | null;
  status?: never;
  summarizerModelId?: string;
  summary: string;
  summaryUsage?: Record<string, number>;
  timestamp: string;
  tokensBefore: number;
  type: "compaction";
  [key: string]: unknown;
}

/** Generated compaction data ready to persist (pi: CompactionResult). */
export interface CompactionResult {
  compacted_entry_ids?: string[];
  details?: CompactionDetails | null;
  first_kept_entry_id: string;
  summary: string;
  tokens_before: number;
  tokens_saved?: number;
  usage?: Record<string, number>;
  [key: string]: unknown;
}

/** Open one cursor per model at `leaf` and send each the same text (docs/TAU-SERVE.md §8). */
export interface Compare {
  /** The entry the cursors start from; `None` is the head cursor's leaf. */
  leaf?: string | null;
  /** Model names from the daemon's config, one cursor each; one may repeat. */
  models: string[];
  session_id: string;
  /** The prompt every cursor receives, never expanded as a command. */
  text: string;
  type: "compare";
}

/** A comparison turn's place in its comparison (`tau_agent_core.compare.COMPARE_KEY`). */
export interface CompareCorrelation {
  cursor_id: string;
  id: string;
  index: number;
  models: string[];
  [key: string]: unknown;
}

/** One column of a comparison. */
export interface CompareCursor {
  cursor_id: string;
  model: string;
  [key: string]: unknown;
}

/** The answer to `EndCompare`. */
export interface CompareEnded {
  /** The head cursor's leaf afterwards. */
  leaf: string | null;
  [key: string]: unknown;
}

/** The answer to `Compare`, sent before the turns end. */
export interface CompareStarted {
  comparison_id: string;
  cursors: CompareCursor[];
  /** One line naming the models, for a head to show. */
  message: string;
  [key: string]: unknown;
}

/** Complete the `@path` at `offset` in `text` against the session's cwd (RPC `complete_path`). */
export interface CompletePath {
  /** The caret's character offset in `text`. */
  offset: number;
  session_id: string;
  text: string;
  type: "complete_path";
}

/** The answer to `CompletePath`; `completion` is `None` outside an `@` token. */
export interface CompletePathResult {
  completion: AttachmentCompletion | null;
  [key: string]: unknown;
}

/** `Submission.correlation`: open, JSON-safe keys a submitter attached; `compare` is τ's. */
export interface Correlation {
  compare?: CompareCorrelation;
  [key: string]: unknown;
}

/** Create a session in `cwd`, a path on the daemon's machine. */
export interface CreateSession {
  /** The directory its tools run in; the create fails if it does not exist. */
  cwd: string;
  /** A model name from the daemon's config, or `None` for its default. */
  model?: string | null;
  /** A session name, or `None`. */
  name?: string | null;
  type: "create_session";
}

/** The answer to `OpenCursor`. */
export interface CursorOpened {
  cursor_id: string;
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
  /** The extension request at its leaf, or `None`. */
  request: ExtensionRequest | null;
  [key: string]: unknown;
}

/** A `cursors` event. */
export interface CursorsEvent {
  data: CursorsEventData;
  epoch: string;
  kind: "cursors";
  seq: number;
  session_id: string;
  type: "event";
  [key: string]: unknown;
}

/** The whole cursor set after a change. */
export interface CursorsEventData {
  cursors: CursorState[];
  [key: string]: unknown;
}

/** Durable data the model never sees. */
export interface CustomEntryEntry {
  customType: string;
  data: Record<string, unknown>;
  id: string;
  parentId: string | null;
  status?: never;
  timestamp: string;
  type: "customEntry";
  [key: string]: unknown;
}

/** The `custom_message` channel. */
export interface CustomMessageChannel {
  name: "custom_message";
  payload: CustomMessagePayload;
  [key: string]: unknown;
}

/** An extension's message, which reaches the model unless `visibleToModel` is false. */
export interface CustomMessageEntry {
  customType: string;
  id: string;
  message: CustomRoleMessage;
  parentId: string | null;
  status?: never;
  timestamp: string;
  type: "customMessage";
  [key: string]: unknown;
}

/** An extension message appended outside a turn. */
export interface CustomMessagePayload {
  entry_id: string;
  message: CustomRoleMessage;
  [key: string]: unknown;
}

/** An extension's message (`messages.create_custom_message`); the model sees it as `user`. */
export interface CustomRoleMessage {
  content: (TextContent | ImageContent)[];
  customType: string;
  details?: unknown;
  display: boolean;
  role: "custom";
  timestamp?: number;
  visibleToModel?: boolean;
  [key: string]: unknown;
}

/** Re-read a session's extension surface, after an extension was enabled or reloaded. */
export interface Describe {
  session_id: string;
  type: "describe";
}

/** Stop receiving a session's events. The session keeps running. */
export interface Detach {
  session_id: string;
  type: "detach";
}

/**
 * What a command resolved to, told apart by `arm`: `Performed` (it ran), `FlowStep` (an
 * argument is missing), `Ready` (a `fork` or `switch_session` for the client to perform) or
 * `View` (a surface only a head opens).
 */
export type DispatchedCommand = PerformedArm | FlowStepArm | ReadyArm | ViewArm;

/** A named type in τ's object model, and how its values are found. */
export interface Domain {
  /** What a value of this domain means, for a person reading a form. */
  description: string;
  /** The name of the `Capability` that computes the legal values, when they depend on live state. */
  enumerator?: string | null;
  /** Which of `tau_agent_core.extension_types.FORM_FIELD_KINDS` a head renders a SINGLE value of this domain as. `"select"` asserts the whole legal set can be put on screen at once; a domain whose set is unbounded or merely large says `"text"` and is completed against instead. A head may substitute a richer control than the kind names — the TUI answers `session_id` with its filtered picker — and may never substitute a poorer one. */
  field_kind?: string;
  /** Whether any value is legal. A free domain has no enumerator and no fixed values, and a head renders it as a plain field. */
  free?: boolean;
  /** The domain's name, as an argument declares it. */
  name: string;
  /** The fixed legal values, when there are few and they never change. */
  values?: string[] | null;
  [key: string]: unknown;
}

/** One legal value: `value` is what is bound, `label` what is shown. */
export interface DomainChoice {
  label: string;
  value: string;
  [key: string]: unknown;
}

/** The answer to `EnumerateDomain`. */
export interface DomainListing {
  domain: string;
  /** How many values match, counting past `limit`. */
  total: number;
  values: DomainChoice[];
  [key: string]: unknown;
}

/** A splice anchor with no summary: the path before `firstKeptId` leaves the context. */
export interface ElideEntry {
  configId?: string | null;
  coveredEntries?: number;
  coveredTokens?: number;
  firstKeptId: string;
  id: string;
  parentId: string | null;
  status?: never;
  timestamp: string;
  type: "elide";
  [key: string]: unknown;
}

/** End a comparison: the head cursor moves onto `keep`'s leaf, and every compare cursor closes. */
export interface EndCompare {
  comparison_id: string;
  keep: string | null;
  session_id: string;
  type: "end_compare";
}

/**
 * One session-log entry, told apart by `type`; an unfinished one carries `status:
 * "incomplete"`. Apply by `id`, last write wins (docs/TAU-SERVE.md §4.1).
 */
export type Entry = MessageEntry | CustomMessageEntry | CustomEntryEntry | CompactionEntry | ElideEntry | BranchSummaryEntry | SessionInfoEntry | NavigateEntry | ModelChangeEntry | ThinkingChangeEntry | ForeignEntry | IncompleteEntry;

/** A `entry_append` event. */
export interface EntryAppendEvent {
  data: EntryEventData;
  epoch: string;
  kind: "entry_append";
  seq: number;
  session_id: string;
  type: "event";
  [key: string]: unknown;
}

/** An `entry_open`, `entry_final` or `entry_append`: one log write. */
export interface EntryEventData {
  /** The cursor whose turn or request wrote it; an `entry_final` names the cursor that opened the entry. Null for a write no cursor made. A client joins `agent_event` to the entries a turn writes by it. */
  cursor_id?: string | null;
  /** The entry as the log now holds it. */
  entry: Entry;
  [key: string]: unknown;
}

/** A `entry_final` event. */
export interface EntryFinalEvent {
  data: EntryEventData;
  epoch: string;
  kind: "entry_final";
  seq: number;
  session_id: string;
  type: "event";
  [key: string]: unknown;
}

/** A `entry_open` event. */
export interface EntryOpenEvent {
  data: EntryEventData;
  epoch: string;
  kind: "entry_open";
  seq: number;
  session_id: string;
  type: "event";
  [key: string]: unknown;
}

/** The values legal for a domain right now (RPC `enumerate_domain`). */
export interface EnumerateDomain {
  /** A domain name, as a step's `domain.name` gives it. */
  domain: string;
  /** The entry a scoped `message_id` is relative to; `None` is the head cursor's leaf. */
  leaf?: string | null;
  /** The most values answered. */
  limit?: number;
  /** A prefix of the value, or a substring of the label; empty matches all. */
  query?: string;
  /** For `message_id`: which entries are candidates; `None` is `in_session`. */
  scope?: "in_session" | "ancestors_of_cursor" | "descendants_of_cursor" | null;
  session_id: string;
  type: "enumerate_domain";
}

/** Why a request failed. `code` is stable; `message` is for a human. */
export interface Error {
  code: "bad_request" | "unauthorized" | "protocol_mismatch" | "not_found" | "busy" | "failed";
  message: string;
  [key: string]: unknown;
}

/** A push for an attached session, numbered per session within an `epoch`. */
export type Event = EntryOpenEvent | EntryFinalEvent | EntryAppendEvent | AgentEventEvent | ChannelEvent | CursorsEvent | RequestEvent | RequestClosedEvent | UiEvent;

/** A `Perform` whose operation returned an `ExtensionCommandResult`. */
export interface ExtensionCommandAnswer {
  fields: ExtensionCommandResult;
  kind: "ExtensionCommandResult";
  [key: string]: unknown;
}

/** Outcome of `AgentSession.run_extension_command` (E7 §3 / S46). */
export interface ExtensionCommandResult {
  handled: boolean;
  output?: unknown | null;
  [key: string]: unknown;
}

/** One loaded extension and what it registered, as RPC `get_extension_state` lists it. */
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

/**
 * An extension request at a cursor, as RPC `get_pending_request` answers it
 * (docs/EXTENSION-LOCKS.md).
 */
export interface ExtensionRequest {
  /** What it asks, or `None` for a bare lock. */
  ask: Ask | null;
  /** The request entry's id; `AnswerRequest` names it. */
  entry_id: string;
  extension: string;
  /** The display stem of `extension`. */
  extension_name: string;
  /** τ's framing line for the request (§9). */
  label: string;
  /** Whether a submission at this cursor is refused. */
  lock: boolean;
  /** A command that clears the lock, or `None`. */
  release: string | null;
  sentence: string;
  [key: string]: unknown;
}

/** One reserved `customEntry`, read back off the tree. */
export interface ExtensionRequestRecord {
  /** The validated ask spec a head renders, or `None`. */
  ask: Record<string, unknown> | null;
  /** The tree entry's own id. */
  entry_id: string;
  /** The appending extension's path, stored rather than looked up (§4) — the case this exists for is a reload where that extension never loaded. */
  extension: string;
  /** Whether a submission at this cursor is refused. */
  lock: boolean;
  /** A command name that clears the lock, or `None`. Advisory — commands are exempt from the lock by placement (§5), not by name. */
  release: string | null;
  /** The extension's own one line. Distinct from `label`, which is τ's framing of it. */
  sentence: string;
  [key: string]: unknown;
}

/** One argument a flow still needs, and everything required to ask for it. */
export interface FlowStep {
  /** The argument being asked for. */
  argument: Argument;
  /** The arguments already bound, so a head redrawing a form has them. */
  bound: Record<string, unknown>;
  /** The entry a scoped `message_id` argument is relative to, carried through from the `next_step` call so the head hands it straight back to `enumerate_domain`. */
  cursor: string | null;
  /** That argument's `tau_agent_core.capabilities.Domain`, resolved here so a head need not look it up. */
  domain: Domain;
  /** The flow's name. */
  flow: string;
  [key: string]: unknown;
}

/** One argument a flow still needs, and everything required to ask for it. */
export interface FlowStepArm {
  /** The argument being asked for. */
  argument: Argument;
  arm: "FlowStep";
  /** The arguments already bound, so a head redrawing a form has them. */
  bound: Record<string, unknown>;
  /** The entry a scoped `message_id` argument is relative to, carried through from the `next_step` call so the head hands it straight back to `enumerate_domain`. */
  cursor: string | null;
  /** That argument's `tau_agent_core.capabilities.Domain`, resolved here so a head need not look it up. */
  domain: Domain;
  /** The flow's name. */
  flow: string;
  [key: string]: unknown;
}

/** A document another system's store put in the tree, typed `system:kind` (`jmfts:document`). */
export interface ForeignEntry {
  id: string;
  parentId: string | null;
  status?: never;
  timestamp: string;
  type: string;
  [key: string]: unknown;
}

/** Copy a session into a new one in the same cwd. */
export interface ForkSession {
  /** The entry to fork at, copying only the path to it; `None` copies the whole tree. */
  at: string | null;
  session_id: string;
  type: "fork_session";
}

/** One field of an extension form (`extension_types.validate_form_spec`). */
export interface FormField {
  default?: unknown;
  kind: "text" | "select" | "multiselect" | "confirm" | "number";
  label?: string;
  name: string;
  options?: string[];
  [key: string]: unknown;
}

/** An extension's `ui.form` spec, as the extension passed it (docs/EXTENSION-LOCKS.md §8.2). */
export interface FormSpec {
  fields: FormField[];
  title?: string;
  [key: string]: unknown;
}

/** Every entry of a session's tree as a browser row, seen from one cursor. */
export interface GetTree {
  cursor_id: string;
  session_id: string;
  type: "get_tree";
}

/** The first request on every connection; nothing else is served before it. */
export interface Hello {
  /** What the client is, for the daemon's log (`tui`, `tail`, `web`). */
  client: string;
  /** The client's `PROTOCOL_VERSION`; a different one is refused. */
  protocol: string;
  /** The shared secret, required only when the daemon's config sets `serve.token`. A client reads it from `TAUD_TOKEN`. */
  token?: string | null;
  type: "hello";
}

/** The answer to `Hello`. */
export interface HelloResult {
  /** This connection's name in the daemon's log. */
  client_id: string;
  /** The daemon's working directory at start, absolute; a default for `CreateSession`. */
  cwd: string;
  /** The daemon's process id. */
  pid: number;
  /** The daemon's `PROTOCOL_VERSION`. */
  protocol: string;
  /** τ's package version, as `tau --version` prints it. */
  version: string;
  [key: string]: unknown;
}

/** An image content block in a message. Reference: SUBPHASE-0.0.md, "1. Messages" section. */
export interface ImageContent {
  data: string;
  mime_type: string;
  type: "image";
  [key: string]: unknown;
}

/** An entry opened and not yet finalized (docs/TAU-SERVE.md §4). */
export interface IncompleteEntry {
  id: string;
  parentId: string | null;
  status: "incomplete";
  timestamp: string;
  type: string;
  [key: string]: unknown;
}

/** Every session in the daemon's store, across every cwd, newest first. */
export interface ListSessions {
  type: "list_sessions";
}

/** A message as the log stores it, told apart by `role`. */
export type Message = UserMessage | AssistantMessage | ToolResultMessage | SystemMessage | CustomRoleMessage;

/** A message on the conversation path. */
export interface MessageEntry {
  id: string;
  message: Message;
  parentId: string | null;
  status?: never;
  timestamp: string;
  type: "message";
  [key: string]: unknown;
}

/** Legacy: the config model from here on, before config entries. */
export interface ModelChangeEntry {
  backend?: string | null;
  id: string;
  model: string | null;
  parentId: string | null;
  status?: never;
  timestamp: string;
  type: "model_change";
  [key: string]: unknown;
}

/** One model the daemon's config defines, as RPC `get_models` lists it. */
export interface ModelRecord {
  model: ModelSpec;
  name: string;
  [key: string]: unknown;
}

/** The answer to `SetModel`. */
export interface ModelSet {
  /** The model id the cursor's next turn calls. */
  model: string;
  [key: string]: unknown;
}

/** What a config model name resolves to. */
export interface ModelSpec {
  context_window: number;
  id: string;
  provider: string;
  [key: string]: unknown;
}

/** Move a cursor to `leaf`. Writes nothing. */
export interface MoveCursor {
  cursor_id: string;
  leaf: string | null;
  session_id: string;
  type: "move_cursor";
}

/** Legacy: a recorded move to `targetId`, written before cursors (docs/CURSORS.md §1.1). */
export interface NavigateEntry {
  id: string;
  parentId: string | null;
  status?: never;
  targetId: string | null;
  timestamp: string;
  type: "navigate";
  [key: string]: unknown;
}

/** The next argument a flow needs, or the mutation it is ready for (RPC `next_step`). */
export interface NextStep {
  /** The arguments bound so far; `None` or `{}` is the first step. */
  bound?: Record<string, unknown> | null;
  /** A command `name` whose `flow` is true in the `Surface`. */
  flow: string;
  /** The entry a scoped `message_id` argument is relative to, echoed back as the step's `cursor` for `EnumerateDomain`. */
  leaf?: string | null;
  session_id: string;
  type: "next_step";
}

/** The answer to `NextStep`: exactly one of `step` and `ready` is set, as `status` says. */
export interface NextStepResult {
  ready: Ready | null;
  status: "step" | "ready";
  step: FlowStep | null;
  [key: string]: unknown;
}

/** Open a cursor at `leaf` (an entry id, or `None` before the root). */
export interface OpenCursor {
  label?: string;
  leaf: string | null;
  owner_id?: string | null;
  session_id: string;
  type: "open_cursor";
}

/** A panel button: it runs the extension command `command` with `args`. */
export interface PanelAction {
  args: string;
  command: string;
  label: string;
  [key: string]: unknown;
}

/** A panel's body, told apart by `kind` (`extension_types.validate_panel_spec`). */
export type PanelBody = PanelText | PanelList | PanelTable;

/** A panel body listing strings. */
export interface PanelList {
  items: string[];
  kind: "list";
  [key: string]: unknown;
}

/** A `ui.panel` spec, normalized (`extension_types.validate_panel_spec`). */
export interface PanelSpec {
  actions: PanelAction[];
  body: PanelBody;
  title: string;
  [key: string]: unknown;
}

/** A panel body of string cells; every row has one cell per column. */
export interface PanelTable {
  columns: string[];
  kind: "table";
  rows: string[][];
  [key: string]: unknown;
}

/** A panel body of text. */
export interface PanelText {
  kind: "text";
  text: string;
  [key: string]: unknown;
}

/** One path an `@` token can complete to. */
export interface PathMatch {
  detail: string;
  is_dir: boolean;
  name: string;
  [key: string]: unknown;
}

/** Call one of the session backend's operations, acting at `cursor_id`. */
export interface Perform {
  /** Its keyword arguments. */
  arguments?: Record<string, unknown>;
  /** The cursor the operation acts on: the tree edits move and append at it, and `rollback_turn` runs its turn there. */
  cursor_id: string;
  /** One of `PERFORMABLE`. */
  method: string;
  session_id: string;
  type: "perform";
}

/** Perform a flow's `Ready` at a cursor, as a submit that resolved to it would. */
export interface PerformReady {
  cursor_id: string;
  /** What `NextStep` answered once every argument was bound. Its `mutation` must be its flow's. */
  ready: Ready;
  session_id: string;
  type: "perform_ready";
}

/** The answer to `perform`, told apart by `kind`. */
export type PerformResult = PerformedAnswer | ExtensionCommandAnswer | SubmissionAnswer | CompactionAnswer | ValueAnswer;

/** What a capability produced. The past tense of `Ready`. */
export interface Performed {
  /** The session-log cursor after the call, or `None` for a session with no log. It is the promoted copy of `data["cursor"]` wherever the capability declares one, so a head reads the same field for every mutation instead of knowing which ones carry it. */
  cursor?: string | null;
  /** What it returned, keyed as its `returns` declares. JSON-able. */
  data: Record<string, unknown>;
  /** The flow that named the mutation, when a flow did. `None` when a caller performed the capability directly. */
  flow: string | null;
  /** The capability that ran. */
  mutation: string;
  [key: string]: unknown;
}

/** A `Perform` whose operation returned a `Performed`. */
export interface PerformedAnswer {
  fields: Performed;
  kind: "Performed";
  [key: string]: unknown;
}

/** What a capability produced. The past tense of `Ready`. */
export interface PerformedArm {
  arm: "Performed";
  /** The session-log cursor after the call, or `None` for a session with no log. It is the promoted copy of `data["cursor"]` wherever the capability declares one, so a head reads the same field for every mutation instead of knowing which ones carry it. */
  cursor?: string | null;
  /** What it returned, keyed as its `returns` declares. JSON-able. */
  data: Record<string, unknown>;
  /** The flow that named the mutation, when a flow did. `None` when a caller performed the capability directly. */
  flow: string | null;
  /** The capability that ran. */
  mutation: string;
  [key: string]: unknown;
}

/** A flow with every required argument bound: the mutation, and what to call it with. */
export interface Ready {
  /** What to perform it with, keyed by the mutation's own parameter names, so a caller can splat it. */
  arguments: Record<string, unknown>;
  /** The flow's name. */
  flow: string;
  /** The capability to perform — the flow's, always. Which mutation runs is a property of which flow was named, never of what was bound. */
  mutation: string;
}

/** A flow with every required argument bound: the mutation, and what to call it with. */
export interface ReadyArm {
  /** What to perform it with, keyed by the mutation's own parameter names, so a caller can splat it. */
  arguments: Record<string, unknown>;
  arm: "Ready";
  /** The flow's name. */
  flow: string;
  /** The capability to perform — the flow's, always. Which mutation runs is a property of which flow was named, never of what was bound. */
  mutation: string;
  [key: string]: unknown;
}

/** The answer to `AnswerRequest`. */
export interface RequestAnswered {
  /** Whether the action's command ran. */
  handled: boolean;
  /** What the command returned, as text, or `None`. */
  output: string | null;
  [key: string]: unknown;
}

/** A `request_closed` event. */
export interface RequestClosedEvent {
  data: RequestClosedEventData;
  epoch: string;
  kind: "request_closed";
  seq: number;
  session_id: string;
  type: "event";
  [key: string]: unknown;
}

/** A form some client answered, or its asker gave up on. */
export interface RequestClosedEventData {
  request_id: string;
  [key: string]: unknown;
}

/** A `request` event. */
export interface RequestEvent {
  data: RequestEventData;
  epoch: string;
  kind: "request";
  seq: number;
  session_id: string;
  type: "event";
  [key: string]: unknown;
}

/** An extension form open now: the `request` event's data, and one of `Attached`'s `requests`. */
export interface RequestEventData {
  /** What `Answer` names. */
  request_id: string;
  spec: FormSpec;
  [key: string]: unknown;
}

/** The one answer to a request, matched by `id`. */
export interface Response {
  error?: Error | null;
  id: number;
  ok: boolean;
  /** When `ok`, the request's result: `Results[request.type]` in the schema. `null` when not `ok`. */
  result?: unknown;
  type: "response";
  [key: string]: unknown;
}

/** What `tau serve -d --json` prints: the one daemon at `address`. */
export interface ServeStarted {
  /** `HOST:PORT` or `unix:/PATH`. */
  address: string;
  /** The background log a daemon started by `-d` writes. */
  log: string;
  /** The daemon's process id. */
  pid: number;
  /** Whether this call started it. */
  started: boolean;
  [key: string]: unknown;
}

/** The answer to `CreateSession`. */
export interface SessionCreated {
  session_id: string;
  [key: string]: unknown;
}

/** The answer to `ForkSession`. */
export interface SessionForked {
  session_id: string;
  [key: string]: unknown;
}

/** The session's display name from here on; the model never sees it. */
export interface SessionInfoEntry {
  id: string;
  name: string;
  parentId: string | null;
  status?: never;
  timestamp: string;
  type: "session_info";
  [key: string]: unknown;
}

/** The answer to `ListSessions`. */
export interface SessionList {
  sessions: SessionRow[];
  [key: string]: unknown;
}

/** One line of `ListSessions`' answer. */
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
}

/** A `Perform` whose operation returned a `SubmissionResult` (`rollback_turn`). */
export interface SubmissionAnswer {
  fields: SubmissionResult;
  kind: "SubmissionResult";
  [key: string]: unknown;
}

/** The `submission_end` channel. */
export interface SubmissionEndChannel {
  name: "submission_end";
  payload: SubmissionEndPayload;
  [key: string]: unknown;
}

/** A submission's turn ended, however it ended. */
export interface SubmissionEndPayload {
  /** Tokens its side completions (summaries) spent, by usage field. */
  side_usage: Record<string, number> | null;
  submission: SubmissionInfo;
  [key: string]: unknown;
}

/** A `Submission` as its channel events carry it (`tau_agent_core.submission`). */
export interface SubmissionInfo {
  allow_user_input: boolean;
  correlation: Correlation;
  depth: number;
  expand_commands: boolean;
  images: Record<string, unknown>[] | null;
  multitask_strategy: "reject" | "enqueue" | "steer" | "rollback" | "fork";
  silent: boolean;
  source: "interactive" | "rpc" | "extension" | "bus" | "timer" | "webhook" | "voice" | "agent";
  store_history: boolean;
  submission_id: string;
  submitter: string;
  text: string;
  [key: string]: unknown;
}

/**
 * The outcome of a `Submission` — LSP's `ApplyWorkspaceEditResult` shape: a refusal is a
 * **result**, not an exception (decision-adjacent to the spec's "Five mechanisms" point 5).
 */
export interface SubmissionResult {
  accepted: boolean;
  command?: FlowStep | Ready | Performed | View | null;
  lock?: ExtensionRequestRecord | null;
  messages?: Record<string, unknown>[];
  rejection_reason?: string | null;
  submission_id: string;
  [key: string]: unknown;
}

/** The `submission_start` channel. */
export interface SubmissionStartChannel {
  name: "submission_start";
  payload: SubmissionStartPayload;
  [key: string]: unknown;
}

/** A submission admitted to run a turn. */
export interface SubmissionStartPayload {
  /** What `expand_attachments` did, or `None` when it was not asked. */
  attachments: AttachmentReport | null;
  /** The cursor its turn extends. */
  cursor_id: string | null;
  images: Record<string, unknown>[] | null;
  /** That cursor's owner, for a sub-agent's turn. */
  owner_id: string | null;
  submission: SubmissionInfo;
  text: string;
  [key: string]: unknown;
}

/** Send text to a cursor: a prompt, or a `/command` when `expand_commands`. */
export interface Submit {
  cursor_id: string;
  /** Resolve `@path` references in `text` against the session's cwd on the daemon's machine, as the TUI's editor does (docs/FILE-ATTACHMENTS.md §2). */
  expand_attachments?: boolean;
  expand_commands?: boolean;
  /** Image content blocks to send with the text. */
  images?: Record<string, unknown>[] | null;
  /** What to do when the cursor is busy (docs/SUBMISSION-LIFECYCLE.md). */
  multitask_strategy?: "reject" | "enqueue" | "steer" | "rollback" | "fork";
  session_id: string;
  /** The id the events of this submission carry; the daemon mints one when `None`. A client that renders its own streams sends it. */
  submission_id?: string | null;
  text: string;
  type: "submit";
}

/** The answer to `Submit`: how the submission ended. A refusal is an answer, not an error. */
export interface SubmitResult {
  accepted: boolean;
  /** When the text was a command, what it resolved to. The daemon performs a `Ready` itself, except `fork` and `switch_session`. */
  command?: DispatchedCommand | null;
  reason?: string | null;
  submission_id: string;
  [key: string]: unknown;
}

/** What a session answers beyond its tree, which a head reads without a round trip. */
export interface Surface {
  /** Each extension command's argument hint, or `None`. */
  command_args: Record<string, string | null>;
  /** Every command, built-in and extension, in resolution order. */
  commands: CommandInfo[];
  /** `[path, enabled]` per managed extension. */
  extensions: unknown[][];
  /** `[path, error]` per extension file that failed to load. */
  load_errors: string[][];
  /** Every loaded extension and what it registered. */
  loaded: ExtensionInfo[];
  /** `[key, command, args, description]` per extension shortcut. */
  shortcuts: string[][];
  [key: string]: unknown;
}

/** The system prompt, which a session stores as its first message entry. */
export interface SystemMessage {
  content: string;
  role: "system";
  [key: string]: unknown;
}

/** A text content block in a message. Reference: SUBPHASE-0.0.md, "1. Messages" section. */
export interface TextContent {
  text: string;
  type: "text";
  [key: string]: unknown;
}

/** Legacy: the reasoning level from here on, before config entries. */
export interface ThinkingChangeEntry {
  id: string;
  level: string | null;
  parentId: string | null;
  status?: never;
  timestamp: string;
  type: "thinking_change";
  [key: string]: unknown;
}

/** A thinking/reasoning content block. Reference: SUBPHASE-0.0.md, "1. Messages" section. */
export interface ThinkingContent {
  cached_tokens?: number;
  thinking: string;
  thinking_signature?: string | Record<string, unknown>;
  type: "thinking";
  [key: string]: unknown;
}

/** A tool call content block in a message. Reference: SUBPHASE-0.0.md, "1. Messages" section. */
export interface ToolCall {
  arguments: Record<string, unknown>;
  id: string;
  name: string;
  provider_signature?: Record<string, unknown>;
  type: "toolCall";
  [key: string]: unknown;
}

/** A tool result message. Reference: SUBPHASE-0.0.md, "1. Messages" section. */
export interface ToolResultMessage {
  content: (TextContent | ImageContent)[];
  details?: Record<string, unknown> | null;
  is_error?: boolean;
  role: "toolResult";
  timestamp: number;
  tool_call_id: string;
  tool_name: string;
  [key: string]: unknown;
}

/** The answer to `GetTree`. */
export interface TreeResult {
  /** How many rows. */
  count: number;
  /** The cursor's leaf: the one row whose `is_leaf` is true. */
  leaf: string | null;
  nodes: TreeRow[];
  [key: string]: unknown;
}

/** One `GetTree` row: RPC `get_tree`'s node, with `is_cursor` named `is_leaf`. */
export interface TreeRow {
  /** Whether `paste_subtree` can take this entry as its source. */
  copyable: boolean;
  entry_id: string;
  /** An estimate of the entry's tokens, 0 when it holds no message. */
  estimated_tokens: number;
  /** On a `compaction` or `elide`, the oldest entry kept. */
  first_kept_id: string | null;
  /** On a `branch_summary`, the branch head it summarizes. */
  from_id: string | null;
  /** Whether this entry is the cursor's leaf. */
  is_leaf: boolean;
  /** Whether this is the system prompt. */
  is_system: boolean;
  /** The entry's `type`. */
  kind: string;
  parent_id: string | null;
  /** The entry's first line. */
  preview: string;
  /** The message role; `None` on a bookkeeping entry. */
  role: string | null;
  /** Epoch milliseconds, or `None`. */
  timestamp: number | null;
  /** The call a tool result answers. */
  tool_call_id: string | null;
  /** The tool call ids an assistant message declares. */
  tool_call_ids: string[];
  [key: string]: unknown;
}

/** A `ui` event. */
export interface UiEvent {
  data: UiEventData;
  epoch: string;
  kind: "ui";
  seq: number;
  session_id: string;
  type: "event";
  [key: string]: unknown;
}

/** An extension display call, told apart by `op`. */
export type UiEventData = UiNotify | UiStatus | UiPanel;

/** An extension's notification. */
export interface UiNotify {
  level: string;
  message: string;
  op: "notify";
  [key: string]: unknown;
}

/** An extension's panel under `key`; `None` closes it. */
export interface UiPanel {
  key: string;
  op: "panel";
  spec: PanelSpec | null;
  [key: string]: unknown;
}

/** An extension's status-line text under `key`; `None` clears it. */
export interface UiStatus {
  key: string;
  op: "status";
  text: string | null;
  [key: string]: unknown;
}

/**
 * Token usage information for an LLM response. Reference: SUBPHASE-0.0.md, "1. Messages"
 * section. Usage is immutable (frozen) — once created, its fields cannot be modified.
 * ``cache_reported`` says whether the SERVER accounted for a prompt cache on this completion
 * at all, which a 0 in the two counters cannot: llama.cpp reports no cache fields, so its 0
 * means "no cache here" where a gateway's 0 means "cached nothing". Only the second is a
 * finding (docs/PROMPT-CACHING.md §7).
 */
export interface Usage {
  cache_read_tokens?: number;
  cache_reported?: boolean;
  cache_write_tokens?: number;
  cost?: Record<string, number>;
  extra?: Record<string, unknown>;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  [key: string]: unknown;
}

/** A user message. Reference: SUBPHASE-0.0.md, "1. Messages" section. */
export interface UserMessage {
  content: string | (TextContent | ImageContent)[];
  role: "user";
  timestamp: number;
  [key: string]: unknown;
}

/** A `Perform` whose operation returned a plain value. */
export interface ValueAnswer {
  kind: "value";
  /** `navigate_tree`, `elide_span` and `commit_branch` return the context's messages; `paste_subtree` the minted ids; `list_managed_extensions` `[path, enabled]` pairs; `compact` `null` when there was nothing to compact. */
  value: unknown;
  [key: string]: unknown;
}

/** A named surface only a head can open. */
export interface View {
  /** The view's name, a key of `tau_agent_core.capabilities.VIEW_COMMANDS`. */
  name: string;
  /** What a head draws the view from. `None` everywhere today — no capability projects the session tree yet (docs/VSCODE-HEAD.md §6), and this is the spot that payload lands in when one does, with no change to the union. */
  state?: Record<string, unknown> | null;
  /** Why no `state` rides with this, in a sentence a head can print. A head that has its own view of that name ignores it and opens it; a head that has none prints it and does nothing else. Not a fallback: it is the same idiom the RPC table's seven `declined_because` entries already use. */
  unavailable_because?: string | null;
  [key: string]: unknown;
}

/** A named surface only a head can open. */
export interface ViewArm {
  arm: "View";
  /** The view's name, a key of `tau_agent_core.capabilities.VIEW_COMMANDS`. */
  name: string;
  /** What a head draws the view from. `None` everywhere today — no capability projects the session tree yet (docs/VSCODE-HEAD.md §6), and this is the spot that payload lands in when one does, with no change to the union. */
  state?: Record<string, unknown> | null;
  /** Why no `state` rides with this, in a sentence a head can print. A head that has its own view of that name ignores it and opens it; a head that has none prints it and does nothing else. Not a fallback: it is the same idiom the RPC table's seven `declined_because` entries already use. */
  unavailable_because?: string | null;
  [key: string]: unknown;
}

/**
 * The wire projection of ``AgentEvent`` (D3) — REMOTE-CONTROL.md's designed shape, and (as of
 * unit 2B) what ``rpc/handler.py`` actually sends: ``rpc/wire_events.py`` constructs instances
 * of this class rather than a hand-shaped dict. See the module docstring's Status note and the
 * field-by-field comment above this class.
 */
export interface WireEvent {
  /** Which diffable content-block kind `delta` belongs to. Set exactly when `delta` is set — 'text' on a side_completion_update, which has no other kind. */
  block_type?: "text" | "thinking" | null;
  /** Whether a tool_execution_end is an extension veto (S50), distinct from a generic errored result. */
  blocked?: boolean;
  /** The extension that vetoed the call; paired with blocked. */
  blocked_by?: string | null;
  /** One sentence saying this turn's prompt cache should have been read and was not, on agent_end. Null is the normal case and says nothing was observed: the cache was read, the server accounts for no cache, the prompt is under the minimum cacheable prefix, or a read earlier in this session already proved caching is on. A host renders it as a warning; see docs/PROMPT-CACHING.md §7 for the three gates. None for all other event types. */
  cache_notice?: string | null;
  /** The submission's free-form origin detail (E4). None alongside submission_id — an empty dict would claim a submission with no correlation data, which is a different statement. */
  correlation?: Record<string, unknown> | null;
  /** The session log's resulting cursor, on agent_end (E5/F3). Filled in by rpc/transport.py's writer immediately before this line is serialized — not by rpc/wire_events.py at event-projection time — because persistence happens strictly AFTER agent_end fires; reading it any earlier reproduces the exact stale-tip bug this field exists to close. None for all other event types. */
  cursor?: string | null;
  /** The cursor whose turn emitted this event (docs/CURSORS.md §6). Several cursors run turns on one session at once; a host routes by this. None outside a turn. */
  cursor_id?: string | null;
  /** One text fragment that arrived. On message_update (E1) it is a diffable content-block's prefix-diff against the previous message_update in the same turn, never the cumulative message; only a diffable block kind sets it (see block_type), and a non-diffable block change (e.g. a growing toolCall) produces no wire event. On side_completion_update it is the next fragment of the summary. Both are applied the same way, which is why they share a field rather than asking a client to keep two accumulators — see `replace`. None for all other event types. */
  delta?: string | null;
  /** How many tool calls this completion lost because the stream ended mid-argument, on message_end. A truncated or aborted arguments buffer is a prefix, so the provider drops the call rather than running it on a repaired or empty payload, and this is the only record that it existed. Null rather than 0 when none were dropped, so 'none lost' and 'not reported' stay distinguishable. None for all other event types. */
  dropped_tool_calls?: number | null;
  /** How an agent_end closed: 'done' (the model had nothing more to say), 'terminate' (a tool asked to stop), 'aborted', 'max_turns' (the ceiling truncated the run), 'repeat_tool_calls' (the loop stopped itself because the model kept repeating an identical, wholly-failing batch) or 'error'. None on every other event type. `error` says whether the loop raised; this says how it stopped when it did not, which is what tells a host that an answer is TRUNCATED rather than finished. */
  end_reason?: "done" | "terminate" | "aborted" | "max_turns" | "repeat_tool_calls" | "error" | null;
  /** Why an agent_end closed when the loop raised rather than finishing (e.g. 'RuntimeError: Connection refused'). None on a normal close; always paired with is_error=True when set. Without it 'the agent finished' and 'the agent died mid-turn' are the same event on the wire. */
  error?: string | null;
  /** Whether this event represents an error. */
  is_error?: boolean;
  /** Count of messages produced this turn, on agent_end (E2). The messages themselves are pulled via get_messages, never pushed. None for all other event types. */
  message_count?: number | null;
  /** Which side completion a side_completion_* event reports: 'compaction' or 'branch_summary'. Side work spends tokens and produces text outside any turn, so it stamps no submission_id and a host keys on this instead. The summary TEXT and what it cost are deliberately not on the wire — both land in the session log as a compaction or branch_summary entry, which get_entry serves with tokens_before, covered_tokens and summary_usage attached. Pushing unbounded content through an event is what WireEvent exists to avoid. None for all other event types. See docs/STREAMING-SIDE-WORK.md. */
  purpose?: "compaction" | "branch_summary" | null;
  /** What asked for a side completion: 'manual' (a person or this host), 'threshold' (the auto-trigger, which nobody asked for) or 'navigate' (the tree browser's summarising move). On all three side_completion_* events, so a host that attached mid-summary still learns whether the work was requested or imposed. None for all other event types. */
  reason?: "manual" | "threshold" | "navigate" | null;
  /** Only meaningful when delta is set. False (the common case): delta is an incremental suffix — append it to whatever was already accumulated for this block_type this turn. True: the provider replaced rather than extended the block's content — delta is the block's ENTIRE new value, and the receiver must RESET its accumulator to delta rather than appending. Mirrors event_projection.BlockDelta.replace exactly. */
  replace?: boolean;
  /** The submission's origin (E4). None alongside submission_id. */
  source?: "interactive" | "rpc" | "extension" | "bus" | "timer" | "webhook" | "voice" | "agent" | null;
  /** Why the model stopped this completion, on the message_end that carries usage. 'length' means the output cap ended it, so the content is a PREFIX and not an answer — the one value an operator has to act on. None on the content-only duplicate message_end (which carries no usage either) and on every other event type. This rides a field of its own because the message it belongs to is excluded from the wire; it is a closed enum, not unbounded content. See docs/TRUNCATED-TOOL-CALLS.md. */
  stop_reason?: "stop" | "length" | "toolUse" | "error" | "aborted" | null;
  /** The Submission that drove this turn, if any (E4/G6). None for an event from a call that never went through submit()/prompt() — never a fabricated id. */
  submission_id?: string | null;
  /** WHO submitted (E4). None alongside submission_id. */
  submitter?: string | null;
  /** Milliseconds since epoch. */
  timestamp: number;
  /** Tool call id (tool_*). */
  tool_call_id?: string | null;
  /** Tool name (tool_*). */
  tool_name?: string | null;
  /** Turn number (turn_*). */
  turn_index?: number | null;
  /** Event type discriminator. */
  type: "agent_start" | "agent_end" | "turn_start" | "turn_end" | "message_start" | "message_update" | "message_end" | "tool_execution_start" | "tool_execution_update" | "tool_execution_end" | "side_completion_start" | "side_completion_update" | "side_completion_end";
  [key: string]: unknown;
}

/** Every frame a client sends. */
export type ClientFrame = {
  /** What the client is, for the daemon's log (`tui`, `tail`, `web`). */
  client: string;
  id: number;
  /** The client's `PROTOCOL_VERSION`; a different one is refused. */
  protocol: string;
  /** The shared secret, required only when the daemon's config sets `serve.token`. A client reads it from `TAUD_TOKEN`. */
  token?: string | null;
  type: "hello";
} | {
  id: number;
  type: "list_sessions";
} | {
  /** The directory its tools run in; the create fails if it does not exist. */
  cwd: string;
  id: number;
  /** A model name from the daemon's config, or `None` for its default. */
  model?: string | null;
  /** A session name, or `None`. */
  name?: string | null;
  type: "create_session";
} | {
  /** The `epoch` of an earlier attach, to resume rather than re-read. */
  epoch?: string | null;
  id: number;
  /** The session, or an unambiguous prefix of its id. */
  session_id: string;
  /** The last `seq` the client applied under that epoch. */
  since?: number | null;
  type: "attach";
} | {
  id: number;
  session_id: string;
  type: "detach";
} | {
  cursor_id: string;
  /** Resolve `@path` references in `text` against the session's cwd on the daemon's machine, as the TUI's editor does (docs/FILE-ATTACHMENTS.md §2). */
  expand_attachments?: boolean;
  expand_commands?: boolean;
  id: number;
  /** Image content blocks to send with the text. */
  images?: Record<string, unknown>[] | null;
  /** What to do when the cursor is busy (docs/SUBMISSION-LIFECYCLE.md). */
  multitask_strategy?: "reject" | "enqueue" | "steer" | "rollback" | "fork";
  session_id: string;
  /** The id the events of this submission carry; the daemon mints one when `None`. A client that renders its own streams sends it. */
  submission_id?: string | null;
  text: string;
  type: "submit";
} | {
  cursor_id: string;
  id: number;
  session_id: string;
  type: "abort";
} | {
  id: number;
  label?: string;
  leaf: string | null;
  owner_id?: string | null;
  session_id: string;
  type: "open_cursor";
} | {
  cursor_id: string;
  id: number;
  session_id: string;
  type: "close_cursor";
} | {
  cursor_id: string;
  id: number;
  leaf: string | null;
  session_id: string;
  type: "move_cursor";
} | {
  cursor_id: string;
  id: number;
  model: string;
  session_id: string;
  type: "set_model";
} | {
  id: number;
  request_id: string;
  session_id: string;
  type: "answer";
  /** The `{field: value}` answers, or `None` to cancel the form. */
  value: Record<string, unknown> | null;
} | {
  /** The label of the pressed action. */
  action: string;
  cursor_id: string;
  id: number;
  /** The request entry's id. */
  request_id: string;
  session_id: string;
  type: "answer_request";
  /** The filled fields, keyed by name. */
  values?: Record<string, unknown>;
} | {
  /** Its keyword arguments. */
  arguments?: Record<string, unknown>;
  /** The cursor the operation acts on: the tree edits move and append at it, and `rollback_turn` runs its turn there. */
  cursor_id: string;
  id: number;
  /** One of `PERFORMABLE`. */
  method: string;
  session_id: string;
  type: "perform";
} | {
  cursor_id: string;
  id: number;
  /** What `NextStep` answered once every argument was bound. Its `mutation` must be its flow's. */
  ready: Ready;
  session_id: string;
  type: "perform_ready";
} | {
  id: number;
  session_id: string;
  type: "describe";
} | {
  id: number;
  /** The entry the cursors start from; `None` is the head cursor's leaf. */
  leaf?: string | null;
  /** Model names from the daemon's config, one cursor each; one may repeat. */
  models: string[];
  session_id: string;
  /** The prompt every cursor receives, never expanded as a command. */
  text: string;
  type: "compare";
} | {
  comparison_id: string;
  id: number;
  keep: string | null;
  session_id: string;
  type: "end_compare";
} | {
  /** The arguments bound so far; `None` or `{}` is the first step. */
  bound?: Record<string, unknown> | null;
  /** A command `name` whose `flow` is true in the `Surface`. */
  flow: string;
  id: number;
  /** The entry a scoped `message_id` argument is relative to, echoed back as the step's `cursor` for `EnumerateDomain`. */
  leaf?: string | null;
  session_id: string;
  type: "next_step";
} | {
  /** A domain name, as a step's `domain.name` gives it. */
  domain: string;
  id: number;
  /** The entry a scoped `message_id` is relative to; `None` is the head cursor's leaf. */
  leaf?: string | null;
  /** The most values answered. */
  limit?: number;
  /** A prefix of the value, or a substring of the label; empty matches all. */
  query?: string;
  /** For `message_id`: which entries are candidates; `None` is `in_session`. */
  scope?: "in_session" | "ancestors_of_cursor" | "descendants_of_cursor" | null;
  session_id: string;
  type: "enumerate_domain";
} | {
  id: number;
  /** The caret's character offset in `text`. */
  offset: number;
  session_id: string;
  text: string;
  type: "complete_path";
} | {
  cursor_id: string;
  id: number;
  session_id: string;
  type: "get_tree";
} | {
  /** The entry to fork at, copying only the path to it; `None` copies the whole tree. */
  at: string | null;
  id: number;
  session_id: string;
  type: "fork_session";
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
  perform_ready: PerformReady;
  set_model: SetModel;
  submit: Submit;
}

/** What each request answers, by its `type`. */
export interface Results {
  abort: null;
  answer: null;
  answer_request: RequestAnswered;
  attach: Attached;
  close_cursor: null;
  compare: CompareStarted;
  complete_path: CompletePathResult;
  create_session: SessionCreated;
  describe: Surface;
  detach: null;
  end_compare: CompareEnded;
  enumerate_domain: DomainListing;
  fork_session: SessionForked;
  get_tree: TreeResult;
  hello: HelloResult;
  list_sessions: SessionList;
  move_cursor: null;
  next_step: NextStepResult;
  open_cursor: CursorOpened;
  perform: PerformResult;
  perform_ready: DispatchedCommand;
  set_model: ModelSet;
  submit: SubmitResult;
}

export type RequestType = keyof Requests;
export type RequestFields<T extends RequestType> = Omit<Requests[T], 'type'>;

/** The `data` each event kind carries, by its `kind`. */
export interface EventData {
  agent_event: WireEvent;
  channel: ChannelEventData;
  cursors: CursorsEventData;
  entry_append: EntryEventData;
  entry_final: EntryEventData;
  entry_open: EntryEventData;
  request: RequestEventData;
  request_closed: RequestClosedEventData;
  ui: UiEventData;
}

export type EventKind = keyof EventData;

/** Every request type, in the schema's order. */
export const REQUEST_TYPES = ["abort","answer","answer_request","attach","close_cursor","compare","complete_path","create_session","describe","detach","end_compare","enumerate_domain","fork_session","get_tree","hello","list_sessions","move_cursor","next_step","open_cursor","perform","perform_ready","set_model","submit"] as const;
/** Every event kind, in the schema's order. */
export const EVENT_KINDS = ["agent_event","channel","cursors","entry_append","entry_final","entry_open","request","request_closed","ui"] as const;
