/* eslint-disable */
/**
 * GENERATED FILE -- DO NOT EDIT.
 *
 * Regenerate with `npm run generate`, which reads `tau serve --schema` from the
 * installed τ. τ's protocol dataclasses are the source of truth; nothing here is
 * hand-maintained, and `npm run check:protocol` fails when this file is stale.
 *
 * tau serve protocol 0.11
 */

/** The protocol version `hello` must name. */
export const PROTOCOL_VERSION = "0.11" as const;
/** The port `tau serve` listens on when its config names none. */
export const DEFAULT_PORT = 8256 as const;

/**
 * RPC `abort` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's own handler at
 * `cursor_id`.
 */
export interface Abort {
  /** The cursor the verb acts at. */
  cursor_id: string;
  session_id: string;
}

export interface AbortResult {
  /** The compaction this abort's signal was delivered to, or null when none was in flight (finding 5, Tier B review). Present so a host knows to expect a compaction_end carrying cancelled: true for that id. Whether the compaction actually stopped is reported THERE and not here — same signal-vs-outcome split that keeps `leaf` off this response. */
  compaction_id: string | null;
  /** Always 'aborted'. */
  status: "aborted";
  [key: string]: unknown;
}

/** A `agent_event` event. */
export interface AgentEventEvent {
  data: WireEvent;
  epoch: string;
  kind: "agent_event";
  seq: number;
  session_id: string;
  [key: string]: unknown;
}

/** Answer an extension's form (a `request` event); the first answer wins. */
export interface Answer {
  request_id: string;
  session_id: string;
  /** The `{field: value}` answers, or `None` to cancel the form. */
  value: Record<string, unknown> | null;
}

/**
 * RPC `answer_request` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's own handler
 * at `cursor_id`.
 */
export interface AnswerRequest {
  /** The pressed action's `label` — one of the labels in the ask's `actions`. The label, not the command it names: the label is what a person chose and what the ask's own table is keyed by. */
  action: string;
  /** The cursor the verb acts at. */
  cursor_id: string;
  /** The request's `entry_id`, as get_pending_request reported it or as a SUBMISSION_REJECTED refusal carried it. */
  request_id: string;
  session_id: string;
  /** The filled fields, keyed by field name. Omitted is the empty dict, which is what an ask declaring no fields takes. Checked against the ask's declared fields before anything is appended: nothing is coerced and no partial answer is persisted. */
  values?: Record<string, unknown>;
}

export interface AnswerRequestResult {
  /** Whether the extension that raised the request was loaded and ran its action. FALSE still means the response was appended and the lock released — a lock whose owner cannot answer must not become a session nobody can continue — so a host reports it as a warning and carries on, rather than as a failure to retry. */
  handled: boolean;
  /** cursor.leaf after the response was appended (E5 rule 1). The append is what RELEASES the lock — appending moves the cursor and a lock is read at the cursor — so this value is the evidence the session is answerable again. */
  leaf: string | null;
  /** What the dispatched command produced, or null. */
  output: string | null;
  [key: string]: unknown;
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
  scope?: "in_session" | "ancestors_of_leaf" | "descendants_of_leaf" | null;
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
 * load. Attributes: role: Discriminator, always ``"assistant"``. content: Thinking, text and
 * tool-call blocks. api: The wire protocol that produced it, e.g. ``"openai-completions"``.
 * provider: The provider id the request went to. model: The model id the request named.
 * response_id: The server's id for the completion, when it sent one. usage: Token counts for
 * this completion. stop_reason: Why generation ended. error_message: The failure text when
 * ``stop_reason`` is ``"error"``. reasoning_level: The thinking level whose wire form this
 * completion was requested with, after clamping; ``None`` when no reasoning control was sent
 * (docs/REASONING-WIRE.md §3). timestamp: See above.
 */
export interface AssistantMessage {
  api: string;
  content: (TextContent | ThinkingContent | ToolCall)[];
  error_message?: string | null;
  model: string;
  provider: string;
  reasoning_level?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | null;
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

/** What a submission's `expand_attachments` did. */
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
  copiedFrom?: string;
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
  [key: string]: unknown;
}

/** A session bus channel, told apart by `name`. Changes no state. */
export type ChannelEventData = SubmissionStartChannel | SubmissionEndChannel | CustomMessageChannel;

/** Close a cursor this session opened; its branch stays in the tree. */
export interface CloseCursor {
  cursor_id: string;
  session_id: string;
}

/** One slash command a session answers, as RPC `get_commands` lists it. */
export interface CommandInfo {
  description: string;
  /** Whether `NextStep` steps it. */
  flow: boolean;
  /** A qualified extension name (`ext:pirate:speak`): it resolves, and a completion list leaves it out. */
  hidden: boolean;
  name: string;
  /** `builtin` for τ's own, `extension` for one an extension registered, `template` or `skill` for one the session expands into a prompt (docs/PROMPT-TEMPLATES-AND-SKILLS.md). */
  origin: "builtin" | "extension" | "template" | "skill";
  [key: string]: unknown;
}

/** An extension command's completion, as `submit`'s answer names it. */
export interface CommandOutput {
  /** The command that ran, which an input hook may have rewritten. */
  name: string | null;
  /** What it returned, as display text, or `None`. */
  output: string | null;
  [key: string]: unknown;
}

/**
 * RPC `commit_branch` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's own handler
 * at `cursor_id`.
 */
export interface CommitBranch {
  /** The cursor the verb acts at. */
  cursor_id: string;
  /** Whether the branch keeps ONLY the selection. true appends an elide resuming at the root-most mark, so the context becomes the system prompt plus the branch; false leaves everything above the attach point in context. */
  drop_context: boolean;
  /** The marked entry ids, in any order — tree_surgery puts them into tree order. The longest run that is already an ancestor chain is kept in place; the rest are minted as copies parented under it, so nothing is re-parented and nothing is erased. */
  ids: string[];
  session_id: string;
}

export interface CommitBranchResult {
  /** cursor.leaf after the mutation (E5 rule 1). */
  leaf: string | null;
  /** ConversationTree.context_for(cursor) after the mutation — the same flat message array get_messages returns, for the path this call just produced. Returned rather than left for a follow-up get_messages because the mutation's whole product is a different context, and a host that had to fetch it separately could render the old one in between. */
  messages: ContextMessage[];
  [key: string]: unknown;
}

/**
 * RPC `compact` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's own handler at
 * `cursor_id`.
 */
export interface Compact {
  /** The cursor the verb acts at. */
  cursor_id: string;
  /** Optional extra focus for the generated summary, threaded unchanged to AgentSession.compact(custom_instructions=...). */
  custom_instructions?: string;
  session_id: string;
}

export interface CompactResult {
  /** Always true — the compaction was admitted and is now running in the background. A refusal is an error response instead (TURN_STILL_RUNNING), never accepted: false. */
  accepted: boolean;
  /** Correlates this acknowledgement to the compaction_end notification that reports the outcome. Server-generated; a host does not supply it. */
  compaction_id: string;
  [key: string]: unknown;
}

export interface CompactionEnd {
  /** True when a host's `abort` stopped this compaction part-way (finding 5, Tier B review). Nothing was written — the summary is generated before the entry is appended — so `performed` is ABSENT, exactly as it is when is_error is true, and `leaf` is the unchanged tip. False on every other outcome rather than omitted: absence is not this tier's way of saying anything (E5 rule 3). A compaction cancelled by SHUTDOWN never reaches this notification at all — that one reports on stderr (D-5, T4). */
  cancelled: boolean;
  /** Session-log entry ids folded into the summary. */
  compacted_entry_ids?: string[];
  /** The id the compact acknowledgement returned (correlation). */
  compaction_id: string;
  /** The exception's repr when is_error, else null. */
  error?: string | null;
  /** Session-log entry id of the first entry kept verbatim after the cut. */
  first_kept_entry_id?: string;
  /** True when AgentSession.compact() raised (e.g. CompactionError — summary generation failed and, Fail-Early, nothing was written). `error` carries the detail and `performed` is absent. */
  is_error: boolean;
  /** cursor.leaf once the compaction finished (E5/F3): the post-compaction tip when performed is true, else the unchanged tip. */
  leaf: string | null;
  /** CompactionDetails.modified_files ([] when details is None). */
  modified_files?: string[];
  /** False when AgentSession.compact() returned None — a real outcome (nothing to compact), not an error, and the expected answer under the shipped keep_recent_tokens for any conversation smaller than it, because the cut then removes nothing. Absent entirely when is_error or cancelled is true. Every CompactionResult field below is absent unless this is true. */
  performed?: boolean;
  /** CompactionDetails.read_files ([] when details is None). */
  read_files?: string[];
  /** The JSON-RPC id of the compact request that started this compaction — null when that request was a notification (no id), which is the one case compaction_id is the only correlation handle. */
  request_id: number | null;
  /** CompactionResult.summary — the generated text. */
  summary?: string;
  /** Estimated context tokens before this compaction. */
  tokens_before?: number;
  /** Estimated context tokens this compaction removed: the summarized prefix, less the summary that replaces it. NOT tokens_before less the summary — tokens_before includes the recent context the cut keeps. May be negative when the summary is larger than the prefix it replaced; that is reported rather than clamped to 0. */
  tokens_saved?: number;
  /** What GENERATING this summary cost (CompactionResult.usage) — routinely the priciest single call in a session; distinct from tokens_saved, which is what compaction bought. */
  usage?: Usage;
  [key: string]: unknown;
}

/** A `compaction_end` event. */
export interface CompactionEndEvent {
  data: CompactionEnd;
  epoch: string;
  kind: "compaction_end";
  seq: number;
  session_id: string;
  [key: string]: unknown;
}

/** A summary that replaces the path before `firstKeptId` in the context. */
export interface CompactionEntry {
  configId?: string | null;
  copiedFrom?: string;
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

/** When compaction runs (`compaction.CompactionSettings`). */
export interface CompactionSettingsRecord {
  auto: boolean;
  keep_recent_tokens: number;
  reserve_tokens: number;
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

/**
 * RPC `complete_message_id` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's own
 * handler at `cursor_id`.
 */
export interface CompleteMessageId {
  /** The cursor the verb acts at. */
  cursor_id: string;
  /** The entry the two scoped variants are relative to. Omitted uses the session cursor's leaf (get_state's `leaf`). An id that names no entry is INVALID_PARAMS, never an empty match list. */
  leaf?: string;
  /** How many matches to return at most. Omitted means 50. */
  limit?: number;
  /** Filter text. Matches a case-sensitive PREFIX of an entry id, or a case-insensitive SUBSTRING of its preview — completion and search in one field. Omitted or empty matches everything in scope. */
  query?: string;
  /** Which entries are candidates. 'in_session' is every entry in the log; 'ancestors_of_leaf' is the parent chain from the root to `leaf` inclusive; 'descendants_of_leaf' is the subtree below it, excluding `leaf` itself. Omitted means 'in_session'. */
  scope?: "in_session" | "ancestors_of_leaf" | "descendants_of_leaf";
  session_id: string;
}

export interface CompleteMessageIdResult {
  /** The candidates in tree order (root-most first), as [{entry_id, preview}]: `entry_id` is the value every message_id argument takes, and `preview` is the entry's first line — the row the tree browser draws. Bounded by `limit`. */
  matches: MessageMatch[];
  /** How many entries matched BEFORE `limit` was applied, so a host is told it is seeing a prefix rather than shown one silently (G3, the rule complete_path already follows). */
  total: number;
  [key: string]: unknown;
}

/**
 * RPC `complete_path` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's own handler
 * at `cursor_id`.
 */
export interface CompletePath {
  /** The cursor the verb acts at. */
  cursor_id: string;
  /** The caret's character offset into `text`. Which @reference is being completed is decided from this, so a host that sends the @word alone with offset 0 gets `completion: null` rather than a listing — the offset is not optional and is not defaulted. */
  offset: number;
  session_id: string;
  /** The editor's contents as typed, NOT just the @word. */
  text: string;
}

export interface CompletePathResult {
  /** `null` when `offset` is not inside an @reference at all — the host shows no popup. Otherwise {start, end, token, matches, total}: `start`/`end` are the character span of the whole @word, so a host replaces that span rather than guessing where the token began; `matches` is a list of {name, detail, is_dir}, `name` being the text that goes AFTER the @ (directories end in '/'); `total` is how many entries matched before the list was bounded, so a host can say '12 of 340' instead of implying it showed everything. An EMPTY `matches` with a non-null completion is the 'this names no file' warning, not an absence of information. */
  completion: AttachmentCompletion | null;
  [key: string]: unknown;
}

/** The context's size, as `get_session_stats` measures it (`compaction.ContextUsageEstimate`). */
export interface ContextEstimate {
  last_usage_index: number | null;
  tokens: number;
  trailing_tokens: number;
  usage_tokens: number;
  [key: string]: unknown;
}

/**
 * A message of model input: a stored message, or a summary rendered as a user message, which
 * alone has no `timestamp`.
 */
export type ContextMessage = UserMessage | SummaryMessage | AssistantMessage | ToolResultMessage | SystemMessage | CustomRoleMessage;

/** `Submission.correlation`: open, JSON-safe keys a submitter attached; `compare` is τ's. */
export interface Correlation {
  compare?: CompareCorrelation;
  [key: string]: unknown;
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
  /** The config name of the model its next turn calls, as `set_model` takes it and `get_models` lists it; not the model id, which two names may share. */
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
  [key: string]: unknown;
}

/** The whole cursor set after a change. */
export interface CursorsEventData {
  cursors: CursorState[];
  [key: string]: unknown;
}

/** Durable data the model never sees. */
export interface CustomEntryEntry {
  copiedFrom?: string;
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
  copiedFrom?: string;
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
}

/** Stop receiving a session's events. The session keeps running. */
export interface Detach {
  session_id: string;
}

/**
 * RPC `disable_extension` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's own
 * handler at `cursor_id`.
 */
export interface DisableExtension {
  /** The cursor the verb acts at. */
  cursor_id: string;
  /** The managed extension to disable — a `path` from list_managed_extensions, or a unique file stem. */
  path: string;
  session_id: string;
}

export interface DisableExtensionResult {
  /** Which action ran — echoes the verb. */
  action: "enable" | "disable" | "reload" | "configure";
  /** cursor.leaf — E5 rule 1 on a mutator whose whole product is runtime state. It is the live tip reported as a READ, not a claim that this call wrote anything; the same reading set_auto_compaction's cursor already has. */
  leaf: string | null;
  /** The human-readable line, the same one the TUI listing shows. */
  message: string;
  /** Whether the action changed anything. false is a reportable no-op, never an error: an unknown target, an already-enabled extension, an already-disabled one. A hard failure — a file that no longer imports, which only reload can hit — RAISES instead and reaches the host as INTERNAL_ERROR, with the extension left torn down. */
  ok: boolean;
  /** The managed path the action resolved to. NOT always what was sent: `path` accepts a file stem as well as a full path, and this is the full path it matched. On a failed resolution it is the unresolved string, so a host can quote back what it asked for. */
  path: string;
  [key: string]: unknown;
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

/** One legal value of a domain: `value` is what is bound, `label` what is shown. */
export interface DomainChoice {
  label: string;
  value: string;
  [key: string]: unknown;
}

/** A splice anchor with no summary: the path before `firstKeptId` leaves the context. */
export interface ElideEntry {
  configId?: string | null;
  copiedFrom?: string;
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

/**
 * RPC `elide_span` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's own handler at
 * `cursor_id`.
 */
export interface ElideSpan {
  /** The entry the fold jumps FROM. The elide entry is appended as its child, so the anchor becomes the end of the kept region and the new tip. */
  anchor_id: string;
  /** The cursor the verb acts at. */
  cursor_id: string;
  /** The entry the fold resumes at — the anchor itself or one of its ANCESTORS, never a descendant. Everything on the path before it is the elided span. A resume point the fold's scan cannot reach would empty the context silently, which is why the wrong direction is refused rather than tolerated. */
  first_kept_id: string;
  session_id: string;
}

export interface ElideSpanResult {
  /** cursor.leaf after the mutation (E5 rule 1). */
  leaf: string | null;
  /** ConversationTree.context_for(cursor) after the mutation — the same flat message array get_messages returns, for the path this call just produced. Returned rather than left for a follow-up get_messages because the mutation's whole product is a different context, and a host that had to fetch it separately could render the old one in between. */
  messages: ContextMessage[];
  [key: string]: unknown;
}

/**
 * RPC `enable_extension` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's own
 * handler at `cursor_id`.
 */
export interface EnableExtension {
  /** The cursor the verb acts at. */
  cursor_id: string;
  /** The managed extension to enable — a `path` from list_managed_extensions, or a unique file stem. */
  path: string;
  session_id: string;
}

export interface EnableExtensionResult {
  /** Which action ran — echoes the verb. */
  action: "enable" | "disable" | "reload" | "configure";
  /** cursor.leaf — E5 rule 1 on a mutator whose whole product is runtime state. It is the live tip reported as a READ, not a claim that this call wrote anything; the same reading set_auto_compaction's cursor already has. */
  leaf: string | null;
  /** The human-readable line, the same one the TUI listing shows. */
  message: string;
  /** Whether the action changed anything. false is a reportable no-op, never an error: an unknown target, an already-enabled extension, an already-disabled one. A hard failure — a file that no longer imports, which only reload can hit — RAISES instead and reaches the host as INTERNAL_ERROR, with the extension left torn down. */
  ok: boolean;
  /** The managed path the action resolved to. NOT always what was sent: `path` accepts a file stem as well as a full path, and this is the full path it matched. On a failed resolution it is the unresolved string, so a host can quote back what it asked for. */
  path: string;
  [key: string]: unknown;
}

/** End a comparison: the head cursor moves onto `keep`'s leaf, and every compare cursor closes. */
export interface EndCompare {
  comparison_id: string;
  keep: string | null;
  session_id: string;
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
  [key: string]: unknown;
}

/** A `entry_open` event. */
export interface EntryOpenEvent {
  data: EntryEventData;
  epoch: string;
  kind: "entry_open";
  seq: number;
  session_id: string;
  [key: string]: unknown;
}

/**
 * RPC `enumerate_domain` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's own
 * handler at `cursor_id`.
 */
export interface EnumerateDomain {
  /** The cursor the verb acts at. */
  cursor_id: string;
  /** The domain's name, as a `next_step` step reported it. A domain that is `free` returns no values and total 0 — that is the answer, not a failure. */
  domain: string;
  /** For a scoped `message_id`: the entry the scope is relative to. Null uses the live tip. An id that names no entry is an error, not an empty listing. */
  leaf?: string | null;
  /** How many values to return at most. Defaults to 50. */
  limit?: number;
  /** Filter text. A value matches on a case-sensitive PREFIX of the value itself, or a case-insensitive SUBSTRING of its label — completion and search, because an id and its text are looked for differently. Empty matches everything in scope. */
  query?: string;
  /** For `message_id` only: which entries are candidates. Defaults to `in_session`. */
  scope?: "in_session" | "ancestors_of_leaf" | "descendants_of_leaf" | null;
  session_id: string;
}

export interface EnumerateDomainResult {
  /** The domain that was enumerated. */
  domain: string;
  /** How many values matched before `limit` was applied, so a host says '12 of 340' instead of implying it showed everything (G3). An empty `values` with a non-zero `total` cannot happen; an empty one with total 0 means the domain genuinely has none. */
  total: number;
  /** A list of {value, label}. `value` is what a host binds into `next_step`'s `bound`; `label` is what it shows. They are equal for a domain whose values already read as text. */
  values: DomainChoice[];
  [key: string]: unknown;
}

/** Why a request failed. `code` is stable; `message` is for a human. */
export interface Error {
  /** One of `ERROR_CODES`, the table RPC uses too (`tau_agent_core.rpc.dialect`). */
  code: -32700 | -32603 | -32602 | -32601 | -32600 | -32007 | -32006 | -32005 | -32004 | -32002 | -32001 | -32000;
  /** RPC's `error.data` for an RPC verb's refusal (a submission's `lock`, the offending `name`), else `None`. */
  data?: Record<string, unknown> | null;
  message: string;
  [key: string]: unknown;
}

/**
 * A failure as fields, beside the ``error`` string on ``agent_end`` and ``provider_retry``.
 * See docs/RESPONSE-HEADERS.md §5. Attributes: type: The exception's class name, e.g.
 * ``"ProviderHttpError"``. Always set. status: The HTTP status of a ``ProviderHttpError``, or
 * the HTTP-like code a ``ProviderStreamError``'s frame named; None otherwise. retry_after:
 * Seconds the server asked the client to wait, parsed from ``Retry-After``; None when it sent
 * none or this is not an HTTP refusal. headers: The refusal's response headers, names
 * lowercased; None when none were captured, which includes every failure that is not an HTTP
 * refusal. retryable: Whether ``tau_llm.retry.DEFAULT_RETRY_POLICY`` counts this failure as
 * transient: True for a retryable status or a connection failure, False for any other HTTP
 * refusal and for a ``ProviderStreamError``, None for an exception τ makes no transience
 * judgement about. On ``agent_end`` a True means τ's own retries ran out, or the server asked
 * for a longer wait than τ will make inside a turn.
 */
export interface ErrorDetail {
  headers?: Record<string, string> | null;
  retry_after?: number | null;
  retryable?: boolean | null;
  status?: number | null;
  type: string;
  [key: string]: unknown;
}

/**
 * A push for an attached session, numbered per session within an `epoch`; an `event`
 * notification's `params`.
 */
export type Event = EntryOpenEvent | EntryFinalEvent | EntryAppendEvent | AgentEventEvent | ChannelEvent | CursorsEvent | RequestEvent | RequestClosedEvent | UiEvent | CompactionEndEvent;

/** An `event` notification: no `id`, and no answer. */
export interface EventNotification {
  jsonrpc: "2.0";
  method: "event";
  params: Event;
  [key: string]: unknown;
}

/** One loaded extension and what it registered, as `get_extension_state` lists it. */
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
 * One row of `list_extensions`: an extension and its state
 * (`extension_sources.ExtensionRecord`).
 */
export interface ExtensionRecordWire {
  authorization: string | null;
  distribution: string | null;
  entry_point: string | null;
  identifier: string;
  kind: string;
  orphan_topics: string[];
  previous_version: string | null;
  reason: string | null;
  state: string;
  target: string;
  version: string | null;
  [key: string]: unknown;
}

/**
 * An extension request at a cursor, as `get_pending_request` answers it
 * (docs/EXTENSION-LOCKS.md).
 */
export interface ExtensionRequest {
  /** What it asks, or `None` for a bare lock. */
  ask: Ask | null;
  /** The request entry's id; `answer_request` names it. */
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

/** The answer to a request that failed, matched by `id`. */
export interface Failure {
  error: Error;
  /** The request's `id`, or `null` when the frame had none the daemon could read. */
  id: number | string | null;
  jsonrpc: "2.0";
  [key: string]: unknown;
}

/** One argument a flow still needs, and everything required to ask for it. */
export interface FlowStep {
  /** The argument being asked for. */
  argument: Argument;
  /** The arguments already bound, so a head redrawing a form has them. */
  bound: Record<string, unknown>;
  /** That argument's `tau_agent_core.capabilities.Domain`, resolved here so a head need not look it up. */
  domain: Domain;
  /** The flow's name. */
  flow: string;
  /** The entry a scoped `message_id` argument is relative to, carried through from the `next_step` call so the head hands it straight back to `enumerate_domain`. */
  leaf: string | null;
  [key: string]: unknown;
}

/** One argument a flow still needs, and everything required to ask for it. */
export interface FlowStepArm {
  /** The argument being asked for. */
  argument: Argument;
  arm: "FlowStep";
  /** The arguments already bound, so a head redrawing a form has them. */
  bound: Record<string, unknown>;
  /** That argument's `tau_agent_core.capabilities.Domain`, resolved here so a head need not look it up. */
  domain: Domain;
  /** The flow's name. */
  flow: string;
  /** The entry a scoped `message_id` argument is relative to, carried through from the `next_step` call so the head hands it straight back to `enumerate_domain`. */
  leaf: string | null;
  [key: string]: unknown;
}

/** A document another system's store put in the tree, typed `system:kind` (`jmfts:document`). */
export interface ForeignEntry {
  copiedFrom?: string;
  id: string;
  parentId: string | null;
  status?: never;
  timestamp: string;
  type: string;
  [key: string]: unknown;
}

/**
 * Copy the path to a cursor's leaf into a new session in the same cwd, and load it (RPC
 * `fork`).
 */
export interface Fork {
  /** The entry to fork at instead of the cursor's leaf. */
  at?: string | null;
  cursor_id: string;
  session_id: string;
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

/**
 * RPC `get_commands` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's own handler
 * at `cursor_id`.
 */
export interface GetCommands {
  /** The cursor the verb acts at. */
  cursor_id: string;
  session_id: string;
}

export interface GetCommandsResult {
  /** Every slash command that resolves right now, built-ins first. A `name` has no leading '/' — submit it as ordinary text with expand_commands=true, not as an RPC method. */
  commands: ({
    /** The one line a completion list or a palette shows. */
    description: string;
    /** Whether this command DECLARES what it takes. True means `next_step` will step it and `enumerate_domain` will list its argument's values, so a host can build a form or a completion list for it; false means the command takes one opaque line and there is nothing to ask about. Every built-in flow is true and the two view commands are false; an extension command is true only if it used `register_flow` (docs/EXTENSION-FLOWS.md). */
    flow: boolean;
    /** True for a private-registry name — `ext:<extension>:<command>`, which every extension command always has and which nothing can take from it (docs/EXTENSION-NAMESPACE.md). It resolves exactly like any other name; it is marked because offering both halves of the same command in one completion list is noise. Show these only once the reader has typed `ext:`. False for every name a reader would type unprompted. */
    hidden: boolean;
    /** The command word, with no leading '/'. */
    name: string;
    /** Where the NAME came from: 'builtin' is τ's own vocabulary, 'extension' is one a loaded extension registered, 'template' is a prompt template and 'skill' is a skill (`skill:<name>`). Resolution is in that order, so nothing shadows a built-in. A template or skill is not dispatched: the core expands it into the prompt and a turn runs (docs/PROMPT-TEMPLATES-AND-SKILLS.md). */
    origin: "builtin" | "extension" | "template" | "skill";
    [key: string]: unknown;
  })[];
  [key: string]: unknown;
}

/**
 * RPC `get_entry` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's own handler at
 * `cursor_id`.
 */
export interface GetEntry {
  /** The cursor the verb acts at. */
  cursor_id: string;
  /** The entry to read — an `entry_id` from get_tree or complete_message_id. An id naming no entry is INVALID_PARAMS, never a null entry. */
  entry_id: string;
  session_id: string;
}

export interface GetEntryResult {
  /** The raw session-log entry, as stored: camelCase `parentId` / `firstKeptId` / `fromId`, a `type`, and whatever payload that type carries — a `message` for the message kinds, a `summary` for a compaction or a branch_summary. Handed over whole rather than projected, because the caller is a detail pane rendering ONE node and a projection would be a second message shape to keep in step with get_messages'. One node per call: get_tree carries a one-line preview per row precisely so a browser does not pull bodies it is not showing. */
  entry: Entry;
  [key: string]: unknown;
}

/**
 * RPC `get_extension_config` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's own
 * handler at `cursor_id`.
 */
export interface GetExtensionConfig {
  /** The cursor the verb acts at. */
  cursor_id: string;
  /** The managed extension to read — a `path` from list_managed_extensions, or a unique file stem. */
  path: string;
  session_id: string;
}

export interface GetExtensionConfigResult {
  /** The managed path the token resolved to, not the token sent. */
  path: string;
  /** The extension's CONFIG_SCHEMA, normalized at load into {title, fields} — the same spec shape ui.form takes, so a head that can render a form can render a settings screen with no new widget. null for an extension that declares none, which is the answer that tells a head to offer no screen rather than an empty one. */
  schema: FormSpec | null;
  /** The live slice api.config returns for this extension, keyed by file stem: config.json's extensions.<stem> with --ext-config overrides applied, plus any set_extension_config since. {} for an unconfigured extension — never the schema's defaults, which the extension itself supplies. */
  values: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * RPC `get_extension_state` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's own
 * handler at `cursor_id`.
 */
export interface GetExtensionState {
  /** The cursor the verb acts at. */
  cursor_id: string;
  session_id: string;
}

export interface GetExtensionStateResult {
  /** Every discovered file that FAILED to load, as [{path, error}]. Kept from the last load_extensions call, because a failed import leaves nothing to recompute from. This is the half that makes this a read of its own rather than list_managed_extensions with more fields: a file that cannot import can never be a legal extension_name, and is exactly what a listing must show. */
  errors: LoadError[];
  /** Every loaded extension and what it registered, as [{name, path, tools, commands, shortcuts, hooks, content_hash, subjects}] — sdk.summarize_extensions of the live registry, which is the same projection the TUI's /extensions listing draws. Read LIVE, not from the load-time snapshot, so a reload_extension is reflected here. */
  extensions: ExtensionInfo[];
  [key: string]: unknown;
}

/**
 * RPC `get_last_assistant_text` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's
 * own handler at `cursor_id`.
 */
export interface GetLastAssistantText {
  /** The cursor the verb acts at. */
  cursor_id: string;
  session_id: string;
}

export interface GetLastAssistantTextResult {
  /** The last assistant message's concatenated 'text' content blocks, trimmed. null if no qualifying assistant message exists YET, or if one exists but it has no text (e.g. a pure tool-call turn) — the two cases are DELIBERATELY indistinguishable on the wire, matching pi's own `getLastAssistantText(): string | undefined` (pi agent-session.ts:3092) and its RPC verb (rpc-mode.ts:609-612, docs/rpc.md: 'Returns {"text": null} if no assistant messages exist' — silent on the second null-producing case, because on the wire there is only one representable 'nothing' and pi does not either). */
  text: string | null;
  [key: string]: unknown;
}

/**
 * RPC `get_messages` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's own handler
 * at `cursor_id`.
 */
export interface GetMessages {
  /** The cursor the verb acts at. */
  cursor_id: string;
  session_id: string;
}

export interface GetMessagesResult {
  /** AgentSession.messages — the terminal, flat message array (E2's pull side). */
  messages: ContextMessage[];
  [key: string]: unknown;
}

/**
 * RPC `get_models` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's own handler at
 * `cursor_id`.
 */
export interface GetModels {
  /** The cursor the verb acts at. */
  cursor_id: string;
  session_id: string;
}

export interface GetModelsResult {
  /** Every config model NAME this child can switch to, sorted, as [{name, model}]: `name` is the exact string set_model's `name` param takes, and `model` is the SAME projection get_state publishes for the active model — {id, provider, context_window} — obtained by resolving `name` through the session's bound model resolver, i.e. by asking the one component set_model itself would ask. Empty only when the child's config declares no models; a resolver that cannot be enumerated is an INTERNAL_ERROR, never an empty list. */
  models: ModelRecord[];
  [key: string]: unknown;
}

/**
 * RPC `get_pending_request` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's own
 * handler at `cursor_id`.
 */
export interface GetPendingRequest {
  /** The cursor the verb acts at. */
  cursor_id: string;
  session_id: string;
}

export interface GetPendingRequestResult {
  /** The extension request AT THE CURSOR, or null when there is none. The cursor only, never an ancestry walk: the thing a user is looking at and the thing that refused their submission are one entry. {entry_id, extension, extension_name, sentence, label, lock, ask, release} — `label` is τ's own framing of the four states over `lock` and `ask`, `sentence` is the extension's own line, `ask` is a validated `ui.form` spec ({title, fields, actions}) or null, and `release` names a command that clears the lock (advisory: commands are exempt from a lock by placement, not by name). A host renders all four states; three of them draw something and the fourth is this verb answering null. */
  request: ExtensionRequest | null;
  [key: string]: unknown;
}

/**
 * RPC `get_session_name` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's own
 * handler at `cursor_id`.
 */
export interface GetSessionName {
  /** The cursor the verb acts at. */
  cursor_id: string;
  session_id: string;
}

export interface GetSessionNameResult {
  /** The session's durable display name, or null if never set (extension_types.read_session_name). */
  name: string | null;
  [key: string]: unknown;
}

/**
 * RPC `get_session_stats` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's own
 * handler at `cursor_id`.
 */
export interface GetSessionStats {
  /** The cursor the verb acts at. */
  cursor_id: string;
  session_id: string;
}

export interface GetSessionStatsResult {
  /** The session's EFFECTIVE CompactionSettings — {auto, reserve_tokens, keep_recent_tokens}, read off AgentSession.compaction_settings, which hands back a COPY so a reader cannot retune a turn already in flight. `auto` is AUTOMATIC compaction only; the `compact` verb ignores it. An RPC session starts from the child's config.json `compaction` block — on unless its `auto` says otherwise (docs/PRICING-AND-COMPACTION-CONFIG.md §3) — and set_auto_compaction (D-4) is the one thing that changes it afterwards, so this reports the session's LIVE effective setting at call time, never a constant. */
  compaction_settings: CompactionSettingsRecord;
  /** estimate_context_tokens(session.messages) (compaction.py) projected as {tokens, usage_tokens, trailing_tokens, last_usage_index}: tokens is the total estimate the compaction threshold is checked against; usage_tokens is the anchored provider-reported count up to the last assistant Usage, trailing_tokens the heuristic estimate for messages after it, last_usage_index that message's index (null if no assistant Usage exists yet, in which case tokens==trailing_tokens and the whole list was heuristically estimated). */
  context: ContextEstimate;
  /** context_window - context.tokens. Can be negative: an honest over-budget number, never clamped to zero. */
  context_headroom: number;
  /** The active model's context_window (get_model()). */
  context_window: number;
  /** {id, timestamp, summary, first_kept_id, tokens_before} for the most recent type=='compaction' entry in session_log.entries(), or null if this session has never compacted — an honest absence, never a fabricated entry. */
  last_compaction: LastCompaction | null;
  /** AgentSession.get_usage() — null before the first completion. */
  usage: Usage | null;
  [key: string]: unknown;
}

/**
 * RPC `get_state` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's own handler at
 * `cursor_id`.
 */
export interface GetState {
  /** The cursor the verb acts at. */
  cursor_id: string;
  session_id: string;
}

export interface GetStateResult {
  /** Whether the CURRENT session is persisted: true if list_sessions returns it and switch_session can reach it later. The same predicate new_session/fork/switch_session publish on their session tuple, asked about the session this connection is on right now. False means the appending verbs (set_model, set_session_name, compact — D-7) will refuse with -32004 SESSION_NOT_PERSISTED, and nothing this connection does is written to the store. Reachable without a respawn: new_session {"persist": true} moves onto a persisted session. */
  addressable: boolean;
  /** AgentSession.is_streaming. */
  is_streaming: boolean;
  /** cursor.leaf (F3: no host may cache 'the tip'). */
  leaf: string | null;
  /** len(AgentSession.messages). */
  message_count: number;
  /** AgentSession.get_model(): {id, provider, context_window}. */
  model: ModelSpec;
  /** AgentSession.state.session_id. */
  session_id: string;
  /** AgentSession.state.status. */
  status: "idle" | "running";
  /** AgentSession.get_usage() — null before the first completion. */
  usage: Usage | null;
  [key: string]: unknown;
}

/**
 * RPC `get_tools` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's own handler at
 * `cursor_id`.
 */
export interface GetTools {
  /** The cursor the verb acts at. */
  cursor_id: string;
  session_id: string;
}

export interface GetToolsResult {
  /** Every tool on the acting cursor: constructor tools, then extension tools, narrowed by the cursor's frame; hidden ones included. */
  tools: ({
    /** Whether the request's `tools` block declares it. */
    declared: boolean;
    /** What the model is told the tool does. */
    description: string;
    /** The effective exposure, overrides applied. */
    exposure: "direct" | "model-only" | "callable" | "deferred" | "hidden";
    /** The tool's name, as a tool call addresses it. */
    name: string;
    /** The tool's own JSON Schema, passed to the provider unchanged — this table's supported-keyword rule does not govern it. */
    parameters: Record<string, unknown>;
    [key: string]: unknown;
  })[];
  [key: string]: unknown;
}

/**
 * RPC `get_tree` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's own handler at
 * `cursor_id`.
 */
export interface GetTree {
  /** The cursor the verb acts at. */
  cursor_id: string;
  session_id: string;
}

export interface GetTreeResult {
  /** len(nodes). Present so a host can check it read a whole tree rather than a truncated one: this read is UNBOUNDED by design — the shape IS the answer and a bounded shape is a different tree — which is why it is a pull and is never pushed (G3). */
  count: number;
  /** cursor.leaf at the moment of the read, duplicated out of `nodes` so a host finds it without scanning. Null on a session whose cursor names no entry, which is also the one case in which no node carries is_leaf: true. */
  leaf: string | null;
  /** Every entry in the log, in the order a browser draws them — preorder over the parent/child tree, roots in load order, children oldest first. FLAT, with `parent_id` carrying the shape: a nested projection of a long linear conversation is one nesting level per message, which is a serializer's recursion limit rather than a tree anyone wanted. Nothing is filtered out — which rows a browser declines to draw (a `navigate` with one child) is the reader's rule, not the log's. */
  nodes: ({
    /** Whether paste_subtree will take this entry as a source root — conversation_tree.COPYABLE_KINDS, reported per node so a host greys the illegal source rather than holding a second copy of the tuple. */
    copyable: boolean;
    /** The entry's id — the value every `message_id` argument takes (navigate, elide_span, commit_branch, paste_subtree, summarize_and_navigate). */
    entry_id: string;
    /** compaction.estimate_tokens over this entry's message, 0 for an entry carrying none. An ESTIMATE — a 4-chars-per-token heuristic — and the only token figure available for an arbitrary set of entries, because the one measured figure in a session is usage.input_tokens on a finished assistant message and that measures one request. A host totalling these says 'estimate' beside the number, as the TUI's browser does. */
    estimated_tokens: number;
    /** On a splice anchor ('compaction' or 'elide'), the oldest entry the fold keeps; null on every other kind. This is the fold's whole boundary: the entries a host paints as folded are the ones on the cursor's ancestor chain that sit before this id, with a system message carried across (docs/SYSTEM-PROMPT-IN-THE-FOLD.md). Sent because a host holding only the shape would have to guess at it. */
    first_kept_id: string | null;
    /** On a 'branch_summary', the head of the branch it summarizes — the pair a browser draws as a summary and the line it is about. Display metadata, never a splice boundary. Null on every other kind. */
    from_id: string | null;
    /** Whether this entry is the head cursor's leaf — where the next submission lands. Exactly one node carries true, or none on a session whose cursor names no entry. */
    is_leaf: boolean;
    /** Whether this entry is the system prompt. A fold carries it across rather than dropping it, so a host computing the folded span excludes it. */
    is_system: boolean;
    /** The entry's type: 'message', 'customMessage', 'compaction', 'elide', 'branch_summary', 'navigate', 'customEntry', 'model_change'. Not a closed enum — a kind added later reaches a host as a row it can draw and does not recognise, rather than as a gap. */
    kind: string;
    /** The entry this one hangs from; null for a root. */
    parent_id: string | null;
    /** The entry's first line, uncut — a host elides it to its own width. Empty for an entry carrying no text. */
    preview: string;
    /** 'user', 'assistant', 'toolResult' or 'system' on a message entry; null on every bookkeeping kind. */
    role: string | null;
    /** Epoch milliseconds, or null when no clock applies (docs/MESSAGE-TIMESTAMPS.md). This is the key children are sorted by, so re-sorting on it reproduces `nodes`. */
    timestamp: number | null;
    /** The call a 'toolResult' answers; null elsewhere. */
    tool_call_id: string | null;
    /** The toolCall block ids an assistant message declares; empty on every other entry. With `tool_call_id` this is the whole of the pairing rule a mark expands over: to every provider a call and its result are one unit, and a branch carrying one without the other is a prefix the API rejects (docs/TREE-EDITOR-MANUAL.md §6). */
    tool_call_ids: string[];
    [key: string]: unknown;
  })[];
  [key: string]: unknown;
}

/** The first request on every connection; nothing else is served before it. */
export interface Hello {
  /** What the client is, for the daemon's log (`tui`, `tail`, `web`). */
  client: string;
  /** The client's `PROTOCOL_VERSION`; a different one is refused. */
  protocol: string;
  /** The shared secret, required only when the daemon's config sets `serve.token`. A client reads it from `TAUD_TOKEN`. */
  token?: string | null;
}

/** The answer to `Hello`. */
export interface HelloResult {
  /** This connection's name in the daemon's log. */
  client_id: string;
  /** The daemon's working directory at start, absolute; a default for `NewSession`. */
  cwd: string;
  /** Every model the daemon's config defines, the list `Attached` repeats, so a client can offer one before it attaches (protocol 0.10). */
  models: ModelRecord[];
  /** The daemon's process id. */
  pid: number;
  /** The daemon's `PROTOCOL_VERSION`. */
  protocol: string;
  /** τ's package version, as `tau --version` prints it. */
  version: string;
  [key: string]: unknown;
}

/**
 * An image content block in a message. Reference: SUBPHASE-0.0.md, "1. Messages" section.
 * Attributes: type: Discriminator, always ``"image"``. data: The image bytes, base64-encoded,
 * without a ``data:`` prefix. mime_type: The image's media type, e.g. ``"image/png"``.
 */
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

/** The newest compaction entry on the path (`agent_session.CompactionRecord`). */
export interface LastCompaction {
  first_kept_id: string | null;
  id: string;
  summary: string;
  /** ISO-8601. */
  timestamp: string;
  tokens_before: number | null;
  [key: string]: unknown;
}

/**
 * RPC `list_extensions` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's own
 * handler at `cursor_id`.
 */
export interface ListExtensions {
  /** The cursor the verb acts at. */
  cursor_id: string;
  session_id: string;
}

export interface ListExtensionsResult {
  /** Every extension this session knows of and its state, as the rows of `tau ext list` (docs/EXTENSION-PACKAGES.md §7): loaded, disabled, failed, and found-but-not-loaded (unauthorized, unusable, collision). Each row names the identifier, source kind, target, distribution and version for a package, why it is not loaded, and the subscribed ext: topics whose emitter is not loaded (#44). Read-only: authorizing is not on the wire. */
  extensions: ExtensionRecordWire[];
  [key: string]: unknown;
}

/**
 * RPC `list_managed_extensions` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's
 * own handler at `cursor_id`.
 */
export interface ListManagedExtensions {
  /** The cursor the verb acts at. */
  cursor_id: string;
  session_id: string;
}

export interface ListManagedExtensionsResult {
  /** Every file extension under management, in load order, as [{path, enabled}]. `path` is the exact string every extension_name argument takes (enable_extension, disable_extension, reload_extension); `enabled` is false exactly when the extension is loaded but its bucket has been removed from the runner, so its hooks, tools and slash commands are not offered. */
  extensions: ManagedExtension[];
  [key: string]: unknown;
}

/** Every session in the daemon's store, across every cwd, newest first (RPC `list_sessions`). */
export interface ListSessions {}

/** An extension file that failed to load, and why. */
export interface LoadError {
  error: string;
  path: string;
  [key: string]: unknown;
}

/** One managed extension file and whether it is enabled. */
export interface ManagedExtension {
  enabled: boolean;
  path: string;
  [key: string]: unknown;
}

/** A message as the log stores it, told apart by `role`. */
export type Message = UserMessage | AssistantMessage | ToolResultMessage | SystemMessage | CustomRoleMessage;

/** A message on the conversation path. */
export interface MessageEntry {
  copiedFrom?: string;
  id: string;
  message: Message;
  parentId: string | null;
  status?: never;
  timestamp: string;
  type: "message";
  [key: string]: unknown;
}

/** One entry `complete_message_id` offers: its id, and its first line. */
export interface MessageMatch {
  entry_id: string;
  preview: string;
  [key: string]: unknown;
}

/** Legacy: the config model from here on, before config entries. */
export interface ModelChangeEntry {
  backend?: string | null;
  copiedFrom?: string;
  id: string;
  model: string | null;
  parentId: string | null;
  status?: never;
  timestamp: string;
  type: "model_change";
  [key: string]: unknown;
}

/** One model the config defines, as `get_models` lists it. */
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

/** Move a cursor to `leaf`. Writes nothing. */
export interface MoveCursor {
  cursor_id: string;
  leaf: string | null;
  session_id: string;
}

/**
 * RPC `navigate` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's own handler at
 * `cursor_id`.
 */
export interface Navigate {
  /** The cursor the verb acts at. */
  cursor_id: string;
  session_id: string;
  /** The entry to move the cursor onto — an `entry_id` from complete_message_id. The abandoned branch drops out of context via the parentId walk but stays on disk and stays browsable; nothing is erased. */
  target_id: string;
}

/** Legacy: a recorded move to `targetId`, written before cursors (docs/CURSORS.md §1.1). */
export interface NavigateEntry {
  copiedFrom?: string;
  id: string;
  parentId: string | null;
  status?: never;
  targetId: string | null;
  timestamp: string;
  type: "navigate";
  [key: string]: unknown;
}

export interface NavigateResult {
  /** cursor.leaf after the mutation (E5 rule 1). */
  leaf: string | null;
  /** ConversationTree.context_for(cursor) after the mutation — the same flat message array get_messages returns, for the path this call just produced. Returned rather than left for a follow-up get_messages because the mutation's whole product is a different context, and a host that had to fetch it separately could render the old one in between. */
  messages: ContextMessage[];
  [key: string]: unknown;
}

/** Create a session in `cwd`, a path on the daemon's machine, and load it (RPC `new_session`). */
export interface NewSession {
  /** The directory its tools run in; the create fails if it does not exist. */
  cwd: string;
  /** A model name from the daemon's config, or `None` for its default. */
  model?: string | null;
  /** A session name, or `None`. */
  name?: string | null;
}

/**
 * RPC `next_step` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's own handler at
 * `cursor_id`.
 */
export interface NextStep {
  /** The arguments bound so far, keyed by argument name. Omit it, or send {}, for the flow's first step. Only REQUIRED arguments block, so a flow whose arguments are all optional is `ready` on the first call. */
  bound?: Record<string, unknown>;
  /** The cursor the verb acts at. */
  cursor_id: string;
  /** The flow's name — one of the `name`s `get_commands` lists. An unknown name is an error, not an empty answer: a host that believes a flow exists must be told it does not. */
  flow: string;
  /** The entry a scoped `message_id` argument is relative to. A parameter rather than the live tip, so a host stepping a sub-agent's flow scopes to THAT agent's leaf. It is echoed back on the step so the host hands it straight to `enumerate_domain`. */
  leaf?: string | null;
  session_id: string;
}

export interface NextStepResult {
  /** {flow, mutation, arguments}. `mutation` is the capability to perform — the named flow's, always, so a host that already knows which flow it stepped can dispatch before this returns. `arguments` is what to perform it with, keyed by the mutation's own parameter names. This is a commitment: τ does not ask a second time, and a host that wants a confirmation renders one from this. */
  ready?: Ready | null;
  /** `step` — one required argument is still unbound and `step` describes it. `ready` — every required argument is bound and `ready` names the mutation to perform and what to perform it with. The two are mutually exclusive and exactly one is present. */
  status: "step" | "ready";
  /** {flow, argument, domain, leaf, bound}. `argument` is {name, domain, description, cardinality, required, scope}; `domain` is the resolved domain record {name, description, free, values, enumerator}, included so a host can render the field without a second call — `values` is non-null for a small fixed set, and `enumerator` non-null means call `enumerate_domain` for the live set. */
  step?: FlowStep | null;
  [key: string]: unknown;
}

/** Open a cursor at `leaf` (an entry id, or `None` before the root). */
export interface OpenCursor {
  label?: string;
  leaf: string | null;
  owner_id?: string | null;
  session_id: string;
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

/**
 * RPC `paste_subtree` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's own handler
 * at `cursor_id`.
 */
export interface PasteSubtree {
  /** The cursor the verb acts at. */
  cursor_id: string;
  session_id: string;
  /** The copied node — the root of the subtree. */
  source_id: string;
  /** The entry the copy hangs from. May not be inside the source's own subtree. */
  target_id: string;
}

export interface PasteSubtreeResult {
  /** cursor.leaf after the paste — E5 rule 1, and here it is the UNCHANGED tip, present because absence is never a signal (rule 3), not because anything moved. */
  leaf: string | null;
  /** The ids minted, in the order they were appended. The first is the copy of `source_id` itself. Ids rather than messages because a paste edits the TREE and never moves the leaf: the current context is unchanged, so there is nothing to re-render until someone navigates onto the copy. */
  minted_ids: string[];
  [key: string]: unknown;
}

/** One path an `@` token can complete to. */
export interface PathMatch {
  detail: string;
  is_dir: boolean;
  name: string;
  [key: string]: unknown;
}

/** Perform a flow's `Ready` at a cursor, as a submit that resolved to it would. */
export interface PerformReady {
  cursor_id: string;
  /** What `NextStep` answered once every argument was bound. Its `mutation` must be its flow's. */
  ready: Ready;
  session_id: string;
}

/** What a capability produced. The past tense of `Ready`. */
export interface PerformedArm {
  arm: "Performed";
  /** What it returned, keyed as its `returns` declares. JSON-able. */
  data: Record<string, unknown>;
  /** The flow that named the mutation, when a flow did. `None` when a caller performed the capability directly. */
  flow: string | null;
  /** The acting cursor's leaf after the call, or `None` for a session with no log. It is the promoted copy of `data["leaf"]` wherever the capability declares one, so a head reads the same field for every mutation instead of knowing which ones carry it. */
  leaf?: string | null;
  /** The capability that ran. */
  mutation: string;
  [key: string]: unknown;
}

/** RPC `prompt` (docs/RPC-PROTOCOL.md) at one cursor. `submit` with RPC's provenance defaults. */
export interface Prompt {
  /** Whether this submission's turn may open a blocking dialog. */
  allow_user_input?: boolean;
  /** Free-form origin detail (bus subject, cron id, HTTP request id). */
  correlation?: Correlation;
  /** The cursor the verb acts at. */
  cursor_id: string;
  /** Self-submission depth floor; submit() may raise it further. */
  depth?: number;
  /** Whether `@file` references in `text` are resolved into <attachment>/<reference> blocks before the Submission is built, the way the TUI's editor does (docs/FILE-ATTACHMENTS.md §2). Defaults to False, which sends `@notes.txt` to the model as those eleven literal characters. NOT a Submission field: expansion happens HERE, so what is persisted and what the model saw are the same string. Attached images are appended to `images`. Files are read at this moment, not when the host composed the text. See the `attachments` key on the result for what expansion did. */
  expand_attachments?: boolean;
  /** Whether a leading '/' is command-dispatched. Defaults to False. */
  expand_commands?: boolean;
  /** Optional list of image content blocks. */
  images?: ImageContent[] | null;
  /** Concurrency policy against an in-flight turn. Defaults to 'reject'. 'fork' is a recognized value but currently REJECTED at submission time (-32602, phase-2 review S3) — it runs on its own cursor, whose events this handler does not forward (docs/CURSORS.md §6). */
  multitask_strategy?: "reject" | "enqueue" | "steer" | "rollback" | "fork";
  session_id: string;
  /** Folds into store_history=False; NOT otherwise implemented — AgentSession.submit() raises NotImplementedError if True. */
  silent?: boolean;
  /** Who originated this submission (Submission.source). */
  source?: "interactive" | "rpc" | "extension" | "bus" | "timer" | "webhook" | "voice" | "agent";
  /** Whether this turn is persisted to the session log. Defaults to True. */
  store_history?: boolean;
  /** Caller-assigned correlation id for this submission (uuid4 recommended). */
  submission_id?: string;
  /** WHO submitted — an extension name, 'human', a channel id. */
  submitter?: string;
  /** The prompt text. */
  text: string;
}

export interface PromptResult {
  /** Always true here — a rejected submission is an RPCError, not this shape. */
  accepted: boolean;
  /** Whether a turn was admitted for this submission, so a `submission_end` channel event with its id will follow. False for a steer delivered into another turn, and for a command. */
  admitted?: boolean;
  /** Present exactly when the request set expand_attachments: true — absent is 'expansion did not run', which is a different statement from 'expansion found nothing'. {expanded: int, images: int, unresolved: [str], failures: [str]}. `unresolved` names the @words that matched no file and were therefore left in the text as prose. `failures` names the ones that resolved but could not be sent, each with the reason; the model is told the same thing through a <reference error="…"> block, so neither side is left believing an attachment landed when it did not. A host that shows neither list turns a visible failure back into a silent one. */
  attachments?: AttachmentReport;
  /** Present ONLY when this acceptance is also the submission's only completion: a core (extension-registered) slash command resolved synchronously with no turn started, so there is no later agent_end to carry it. {name, output} — `name` is the command that ran, which an input hook may have rewritten. Only an extension-registered command reaches this shape; a built-in resolves to a step, a ready flow or a view, each of which this wire refuses with COMMAND_NOT_SUPPORTED. Absent for an ordinary turn — poll get_messages / watch for agent_end instead. */
  command?: CommandOutput;
  /** What a command resolved to, after the daemon performed it; `null` for a prompt. */
  dispatched?: DispatchedCommand | null;
  /** Always null on this success shape; a real rejection is SUBMISSION_REJECTED instead. */
  rejection_reason: null;
  /** Echoes the request's submission_id (caller-supplied, or a minted uuid4 for prompt). */
  submission_id: string;
  /** Present ONLY when this submission resolved to a VIEW command — /tree or /extensions. {name, state, unavailable_because}: `name` is the view asked for, `state` is what a head draws it from, and `unavailable_because` is a sentence saying why no state rides along. Exactly one of the last two is non-null, never both and never neither. τ projects no view state yet (docs/VSCODE-HEAD.md §6), so today every one of these carries the reason; a host with its own browser opens it from its own reads, and a host without one prints the reason. This is a SUCCESS response, not the COMMAND_NOT_SUPPORTED a view used to raise: the wire says what was asked for and what it can supply, and the payload lands in `state` when there is one, with no shape change for a host. */
  view?: View;
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

/**
 * RPC `reload_extension` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's own
 * handler at `cursor_id`.
 */
export interface ReloadExtension {
  /** The cursor the verb acts at. */
  cursor_id: string;
  /** The managed extension to re-import — a `path` from list_managed_extensions, or a unique file stem. */
  path: string;
  session_id: string;
}

export interface ReloadExtensionResult {
  /** Which action ran — echoes the verb. */
  action: "enable" | "disable" | "reload" | "configure";
  /** cursor.leaf — E5 rule 1 on a mutator whose whole product is runtime state. It is the live tip reported as a READ, not a claim that this call wrote anything; the same reading set_auto_compaction's cursor already has. */
  leaf: string | null;
  /** The human-readable line, the same one the TUI listing shows. */
  message: string;
  /** Whether the action changed anything. false is a reportable no-op, never an error: an unknown target, an already-enabled extension, an already-disabled one. A hard failure — a file that no longer imports, which only reload can hit — RAISES instead and reaches the host as INTERNAL_ERROR, with the extension left torn down. */
  ok: boolean;
  /** The managed path the action resolved to. NOT always what was sent: `path` accepts a file stem as well as a full path, and this is the full path it matched. On a failed resolution it is the unresolved string, so a host can quote back what it asked for. */
  path: string;
  [key: string]: unknown;
}

/** A `request_closed` event. */
export interface RequestClosedEvent {
  data: RequestClosedEventData;
  epoch: string;
  kind: "request_closed";
  seq: number;
  session_id: string;
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
  [key: string]: unknown;
}

/** An extension form open now: the `request` event's data, and one of `Attached`'s `requests`. */
export interface RequestEventData {
  /** What `Answer` names. */
  request_id: string;
  spec: FormSpec;
  [key: string]: unknown;
}

/** The one answer to a request: a `result` or an `error`, never both. */
export type Response = Success | Failure;

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

/** What `tau serve --stop --json` prints. Not a frame. */
export interface ServeStopped {
  /** `HOST:PORT` or `unix:/PATH`. */
  address: string;
  /** The process id of the daemon that stopped, or `None` when none answered. */
  pid: number | null;
  /** Whether this call stopped one; false when no daemon answered there. */
  stopped: boolean;
  [key: string]: unknown;
}

/** The session's display name from here on; the model never sees it. */
export interface SessionInfoEntry {
  copiedFrom?: string;
  id: string;
  name: string;
  parentId: string | null;
  status?: never;
  timestamp: string;
  type: "session_info";
  [key: string]: unknown;
}

/** The answer to `ListSessions`, RPC's shape. */
export interface SessionList {
  scope: SessionScope;
  sessions: SessionRow[];
  [key: string]: unknown;
}

/** The answer to `NewSession` and `Fork`, RPC's lifecycle shape. */
export interface SessionOpened {
  /** Always false: no session is switched away from, so no hook can veto. */
  cancelled: boolean;
  /** The new session's head leaf, duplicated out of `session`. */
  leaf: string | null;
  session: SessionTuple;
  [key: string]: unknown;
}

/** One line of `ListSessions`' answer: RPC's row, plus where and whether it is loaded. */
export interface SessionRow {
  /** ISO-8601. */
  created: string;
  /** The directory its tools run in. */
  cwd: string;
  /** Why its entries could not be read, or `None`; such a row stays listed. */
  error: string | null;
  /** Whether the daemon holds it now. */
  loaded: boolean;
  message_count: number;
  /** ISO-8601. */
  modified: string;
  name: string | null;
  /** The session this one was forked from, or `None`. */
  parent: string | null;
  /** The store's own handle for the session. */
  ref: string;
  session_id: string;
  /** A bounded display label; message text appears nowhere else here. */
  title: string;
  [key: string]: unknown;
}

/** What universe a listing is: a store, and the `cwd` it is scoped to, `None` for every one. */
export interface SessionScope {
  cwd: string | null;
  store: string;
  [key: string]: unknown;
}

/** A session a connection drives (F2). */
export interface SessionTuple {
  /** Whether another call can name `session_id`; false for an in-memory session, which `list_sessions` never shows. */
  addressable: boolean;
  /** The cursor the connection drives in it. */
  cursor_id: string;
  /** That cursor's leaf. */
  leaf: string | null;
  session_id: string;
  /** The backend label of the connection's catalog. */
  store: string;
  [key: string]: unknown;
}

/**
 * RPC `set_auto_compaction` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's own
 * handler at `cursor_id`.
 */
export interface SetAutoCompaction {
  /** The cursor the verb acts at. */
  cursor_id: string;
  /** Desired auto-compaction state. An RPC session starts from the child's config.json `compaction` block, on unless its `auto` says otherwise (docs/PRICING-AND-COMPACTION-CONFIG.md §3); AgentSession.set_auto_compaction is the same setter in process. */
  enabled: boolean;
  session_id: string;
}

export interface SetAutoCompactionResult {
  /** The effective state after this call (D-4: 'a plain, idempotent setter ... returns the effective state') — what AgentSession.set_auto_compaction returns, read back off the settings rather than echoed from the request. */
  enabled: boolean;
  /** cursor.leaf after this call (E5, rule 1 of 'E5 in Tier B' above). ALWAYS the unchanged tip: this verb mutates an in-memory CompactionSettings and appends no log entry, so there is nothing here that could move it. Returned rather than omitted because absence is not a signal (rule 3) — a host reads the same field from every mutator and never has to infer the tip from a missing key (F3). */
  leaf: string | null;
  [key: string]: unknown;
}

/**
 * RPC `set_extension_config` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's own
 * handler at `cursor_id`.
 */
export interface SetExtensionConfig {
  /** The cursor the verb acts at. */
  cursor_id: string;
  /** The managed extension to configure — a `path` from list_managed_extensions, or a unique file stem. */
  path: string;
  session_id: string;
  /** The complete new slice, keyed by the field names get_extension_config's `schema` declares. Every declared field must be present: missing is not empty, and nothing is filled in for you. */
  values: Record<string, unknown>;
}

export interface SetExtensionConfigResult {
  /** Which action ran — echoes the verb. */
  action: "enable" | "disable" | "reload" | "configure";
  /** cursor.leaf — E5 rule 1 on a mutator whose whole product is runtime state. It is the live tip reported as a READ, not a claim that this call wrote anything; the same reading set_auto_compaction's cursor already has. */
  leaf: string | null;
  /** The human-readable line, the same one the TUI listing shows. */
  message: string;
  /** Whether the action changed anything. false is a reportable no-op, never an error: an unknown target, an already-enabled extension, an already-disabled one. A hard failure — a file that no longer imports, which only reload can hit — RAISES instead and reaches the host as INTERNAL_ERROR, with the extension left torn down. */
  ok: boolean;
  /** The managed path the action resolved to. NOT always what was sent: `path` accepts a file stem as well as a full path, and this is the full path it matched. On a failed resolution it is the unresolved string, so a host can quote back what it asked for. */
  path: string;
  [key: string]: unknown;
}

/**
 * RPC `set_model` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's own handler at
 * `cursor_id`.
 */
export interface SetModel {
  /** The cursor the verb acts at. */
  cursor_id: string;
  /** A config model NAME (a key in ~/.tau/config.json's 'models' map), resolved through AgentSession's bound model resolver (set_model_resolver) — the same name --model NAME accepts headlessly. NOT a model id; a config key may alias one. */
  name: string;
  session_id: string;
}

export interface SetModelResult {
  /** cursor.leaf immediately after the model_change entry this call appended (E5) — that entry's own id, since the append is the last write this handler makes. */
  leaf: string | null;
  /** AgentSession.get_model() after the switch: {id, provider, context_window}. */
  model: ModelSpec;
  [key: string]: unknown;
}

/**
 * RPC `set_reasoning` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's own handler
 * at `cursor_id`.
 */
export interface SetReasoning {
  /** The cursor the verb acts at. */
  cursor_id: string;
  /** Which reasoning level. */
  level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  session_id: string;
}

export interface SetReasoningResult {
  /** cursor.leaf after this call: ALWAYS the unchanged tip. Nothing is appended here; the next request records `thinking` ahead of itself (docs/TURN-SETTINGS.md §3). */
  leaf: string | null;
  /** The level requested for the acting cursor's next request — what AgentSession.set_reasoning returns. The level actually sent is message_end's reasoning_level, after the provider clamps it (docs/REASONING-WIRE.md §3). */
  level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  [key: string]: unknown;
}

/**
 * RPC `set_session_name` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's own
 * handler at `cursor_id`.
 */
export interface SetSessionName {
  /** The cursor the verb acts at. */
  cursor_id: string;
  /** The session's new durable display name. Must be non-empty. */
  name: string;
  session_id: string;
}

export interface SetSessionNameResult {
  /** The resulting cursor.leaf (E5/F3 — every mutating response returns the resulting leaf). */
  leaf: string | null;
  /** The name just persisted (echoes params.name). */
  name: string;
  [key: string]: unknown;
}

/** Stop the daemon: it answers, then stops as it does on SIGTERM, closing every connection. */
export interface Shutdown {}

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

/**
 * RPC `submit` (docs/RPC-PROTOCOL.md) at one cursor. Answered at admission, as over stdio, and
 * its turn ends with a `submission_end` channel event. `multitask_strategy: "fork"` is
 * accepted. A command answers success with `dispatched`, the arm it resolved to, where stdio
 * refuses a step or a ready flow: the daemon performs a ready flow itself, except `fork` and
 * `switch_session`, which come back for the client.
 */
export interface Submit {
  /** Whether this submission's turn may open a blocking dialog. */
  allow_user_input?: boolean;
  /** Free-form origin detail (bus subject, cron id, HTTP request id). */
  correlation?: Correlation;
  /** The cursor the verb acts at. */
  cursor_id: string;
  /** Self-submission depth floor; submit() may raise it further. */
  depth?: number;
  /** Whether `@file` references in `text` are resolved into <attachment>/<reference> blocks before the Submission is built, the way the TUI's editor does (docs/FILE-ATTACHMENTS.md §2). Defaults to False, which sends `@notes.txt` to the model as those eleven literal characters. NOT a Submission field: expansion happens HERE, so what is persisted and what the model saw are the same string. Attached images are appended to `images`. Files are read at this moment, not when the host composed the text. See the `attachments` key on the result for what expansion did. */
  expand_attachments?: boolean;
  /** Whether a leading '/' is command-dispatched. Defaults to False. */
  expand_commands?: boolean;
  /** Optional list of image content blocks. */
  images?: ImageContent[] | null;
  /** Concurrency policy against an in-flight turn. Defaults to 'reject'. 'fork' is a recognized value but currently REJECTED at submission time (-32602, phase-2 review S3) — it runs on its own cursor, whose events this handler does not forward (docs/CURSORS.md §6). */
  multitask_strategy?: "reject" | "enqueue" | "steer" | "rollback" | "fork";
  session_id: string;
  /** Folds into store_history=False; NOT otherwise implemented — AgentSession.submit() raises NotImplementedError if True. */
  silent?: boolean;
  /** Who originated this submission (Submission.source). */
  source: "interactive" | "rpc" | "extension" | "bus" | "timer" | "webhook" | "voice" | "agent";
  /** Whether this turn is persisted to the session log. Defaults to True. */
  store_history?: boolean;
  /** Caller-assigned correlation id for this submission (uuid4 recommended). */
  submission_id: string;
  /** WHO submitted — an extension name, 'human', a channel id. */
  submitter: string;
  /** The prompt text. */
  text: string;
}

export interface SubmitResult {
  /** Always true here — a rejected submission is an RPCError, not this shape. */
  accepted: boolean;
  /** Whether a turn was admitted for this submission, so a `submission_end` channel event with its id will follow. False for a steer delivered into another turn, and for a command. */
  admitted?: boolean;
  /** Present exactly when the request set expand_attachments: true — absent is 'expansion did not run', which is a different statement from 'expansion found nothing'. {expanded: int, images: int, unresolved: [str], failures: [str]}. `unresolved` names the @words that matched no file and were therefore left in the text as prose. `failures` names the ones that resolved but could not be sent, each with the reason; the model is told the same thing through a <reference error="…"> block, so neither side is left believing an attachment landed when it did not. A host that shows neither list turns a visible failure back into a silent one. */
  attachments?: AttachmentReport;
  /** Present ONLY when this acceptance is also the submission's only completion: a core (extension-registered) slash command resolved synchronously with no turn started, so there is no later agent_end to carry it. {name, output} — `name` is the command that ran, which an input hook may have rewritten. Only an extension-registered command reaches this shape; a built-in resolves to a step, a ready flow or a view, each of which this wire refuses with COMMAND_NOT_SUPPORTED. Absent for an ordinary turn — poll get_messages / watch for agent_end instead. */
  command?: CommandOutput;
  /** What a command resolved to, after the daemon performed it; `null` for a prompt. */
  dispatched?: DispatchedCommand | null;
  /** Always null on this success shape; a real rejection is SUBMISSION_REJECTED instead. */
  rejection_reason: null;
  /** Echoes the request's submission_id (caller-supplied, or a minted uuid4 for prompt). */
  submission_id: string;
  /** Present ONLY when this submission resolved to a VIEW command — /tree or /extensions. {name, state, unavailable_because}: `name` is the view asked for, `state` is what a head draws it from, and `unavailable_because` is a sentence saying why no state rides along. Exactly one of the last two is non-null, never both and never neither. τ projects no view state yet (docs/VSCODE-HEAD.md §6), so today every one of these carries the reason; a host with its own browser opens it from its own reads, and a host without one prints the reason. This is a SUCCESS response, not the COMMAND_NOT_SUPPORTED a view used to raise: the wire says what was asked for and what it can supply, and the payload lands in `state` when there is one, with no shape change for a host. */
  view?: View;
  [key: string]: unknown;
}

/** The answer to a request that succeeded, matched by `id`. */
export interface Success {
  id: number | string;
  jsonrpc: "2.0";
  /** The request's result: `Results[method]` in the schema. */
  result: unknown;
  [key: string]: unknown;
}

/**
 * RPC `summarize_and_navigate` (docs/RPC-PROTOCOL.md) at one cursor. The daemon runs RPC's own
 * handler at `cursor_id`.
 */
export interface SummarizeAndNavigate {
  /** The cursor the verb acts at. */
  cursor_id: string;
  /** Extra guidance for the summarizer's SYSTEM prompt. Omitted runs the default summarizer prompt. */
  custom_instructions?: string;
  session_id: string;
  /** The branch point. The subtree BELOW it is what gets summarized, and the branch_summary entry is parented at it. */
  target_id: string;
}

export interface SummarizeAndNavigateResult {
  /** cursor.leaf after the mutation (E5 rule 1). */
  leaf: string | null;
  /** ConversationTree.context_for(cursor) after the mutation — the same flat message array get_messages returns, for the path this call just produced. Returned rather than left for a follow-up get_messages because the mutation's whole product is a different context, and a host that had to fetch it separately could render the old one in between. */
  messages: ContextMessage[];
  [key: string]: unknown;
}

/** A compaction or branch summary as the context renders it: a user message with no timestamp. */
export interface SummaryMessage {
  content: TextContent[];
  role: "user";
  timestamp?: never;
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

/**
 * A text content block in a message. Reference: SUBPHASE-0.0.md, "1. Messages" section.
 * Attributes: type: Discriminator, always ``"text"``. text: The text itself.
 */
export interface TextContent {
  text: string;
  type: "text";
  [key: string]: unknown;
}

/** Legacy: the reasoning level from here on, before config entries. */
export interface ThinkingChangeEntry {
  copiedFrom?: string;
  id: string;
  level: string | null;
  parentId: string | null;
  status?: never;
  timestamp: string;
  type: "thinking_change";
  [key: string]: unknown;
}

/**
 * A thinking/reasoning content block. Reference: SUBPHASE-0.0.md, "1. Messages" section.
 * Attributes: type: Discriminator, always ``"thinking"``. thinking: The reasoning text.
 * cached_tokens: Not set by any τ provider; stays 0 unless a caller fills it.
 * thinking_signature: What a provider needs to replay this block, kept verbatim. On the OpenAI
 * wire, the name of the response field the reasoning arrived in (e.g.
 * ``"reasoning_content"``); on Anthropic and Google, a dict namespaced by provider holding the
 * opaque artifact. ``""`` when there is none. A block with an artifact and empty ``thinking``
 * is still reasoning (docs/REASONING-WIRE.md §5).
 */
export interface ThinkingContent {
  cached_tokens?: number;
  thinking: string;
  thinking_signature?: string | Record<string, unknown>;
  type: "thinking";
  [key: string]: unknown;
}

/**
 * A tool call content block in a message. Reference: SUBPHASE-0.0.md, "1. Messages" section.
 * Attributes: type: Discriminator, always ``"toolCall"``. id: The provider's call id; the
 * answering result carries it as ``tool_call_id``. name: The tool the model asked for.
 * arguments: The parsed argument object. provider_signature: Vendor-namespaced data a provider
 * must send back with this call, e.g. Gemini's thought signature. Persisted with the session.
 */
export interface ToolCall {
  arguments: Record<string, unknown>;
  id: string;
  name: string;
  provider_signature?: Record<string, unknown>;
  type: "toolCall";
  [key: string]: unknown;
}

/**
 * A tool result message. Reference: SUBPHASE-0.0.md, "1. Messages" section. Attributes: role:
 * Discriminator, always ``"toolResult"``. tool_call_id: The ``ToolCall.id`` this answers.
 * tool_name: The tool that ran. content: What the model sees: text and image blocks. details:
 * Structured data for heads and hooks; no provider sends it. is_error: Whether the tool
 * failed; the content then holds the error. timestamp: Epoch milliseconds when the result was
 * created.
 */
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

/** A `ui` event. */
export interface UiEvent {
  data: UiEventData;
  epoch: string;
  kind: "ui";
  seq: number;
  session_id: string;
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
 * Token usage for one LLM response. Frozen: use ``model_copy(update=...)``. Reference:
 * SUBPHASE-0.0.md, "1. Messages" section. ``cache_reported`` exists because a 0 in the cache
 * counters is ambiguous: llama.cpp reports no cache fields, while a gateway's 0 means "cached
 * nothing" (docs/PROMPT-CACHING.md §7). Attributes: model_config: Pydantic configuration;
 * makes instances frozen. input_tokens: Prompt tokens, as the provider reported them.
 * output_tokens: Completion tokens, as the provider reported them. cache_read_tokens: Prompt
 * tokens served from the provider's cache. cache_write_tokens: Prompt tokens written to the
 * provider's cache. total_tokens: The server's total, or input plus output when it sent none.
 * reasoning_tokens: How many of ``output_tokens`` were reasoning; ``None`` when the server
 * reported no split (docs/REASONING-WIRE.md §7). cost: Not set by any τ provider; prices are
 * applied at the head's emit boundary, not stored here. extra: Provider-specific additions,
 * e.g. llama.cpp ``"timings"`` or the OpenAI provider's ``"repairs"`` count for tool-call
 * arguments.
 */
export interface Usage {
  cache_read_tokens?: number;
  cache_reported?: boolean;
  cache_write_tokens?: number;
  cost?: Record<string, number>;
  extra?: Record<string, unknown>;
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number | null;
  total_tokens?: number;
  [key: string]: unknown;
}

/**
 * A user message. Reference: SUBPHASE-0.0.md, "1. Messages" section. Attributes: role:
 * Discriminator, always ``"user"``. content: Plain text, or a list of text and image blocks.
 * timestamp: Epoch milliseconds when the message was created.
 */
export interface UserMessage {
  content: string | (TextContent | ImageContent)[];
  role: "user";
  timestamp: number;
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
  /** Which retry a provider_retry announces, counting from 1. A provider_retry says a request failed before producing any output and will be sent again, byte-identical, after delay_seconds; `error` is the failure. A host renders it as a passing warning: if the retries run out, the turn's agent_end carries the final error as usual. None for all other event types. See docs/PROVIDER-RETRY.md. */
  attempt?: number | null;
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
  /** The cursor whose turn emitted this event (docs/CURSORS.md §6). Several cursors run turns on one session at once; a host routes by this. None outside a turn. */
  cursor_id?: string | null;
  /** Seconds τ waits before re-sending, on provider_retry: the server's Retry-After when it sent one, else an exponential backoff. None for all other event types. */
  delay_seconds?: number | null;
  /** One text fragment that arrived. On message_update (E1) it is a diffable content-block's prefix-diff against the previous message_update in the same turn, never the cumulative message; only a diffable block kind sets it (see block_type), and a non-diffable block change (e.g. a growing toolCall) produces no wire event. On side_completion_update it is the next fragment of the summary. Both are applied the same way, which is why they share a field rather than asking a client to keep two accumulators — see `replace`. None for all other event types. */
  delta?: string | null;
  /** The texts a user abort discarded, on follow_ups_dropped: the queued followUps in queue order, then the enqueue submissions that were waiting for the turn, in submission order. They were never written to the session, so this is the one field here that carries content no verb can pull afterwards. None for all other event types. See docs/TURN-SETTINGS.md §5 and §5.1. */
  dropped?: string[] | null;
  /** How many tool calls in this completion were not run, on message_end. A completion cut off at the output cap runs none of its calls: each stays in the message with its partial arguments and gets an error result, or is dropped when nothing of it decodes; an aborted stream drops a call whose arguments were mid-flight. Null rather than 0 when every call ran, so 'none lost' and 'not reported' stay distinguishable. None for all other event types. See docs/TRUNCATED-TOOL-CALLS.md §3.2. */
  dropped_tool_calls?: number | null;
  /** How an agent_end closed: 'done' (the model had nothing more to say), 'terminate' (a tool asked to stop), 'aborted', 'max_turns' (the ceiling truncated the run), 'repeat_tool_calls' (the loop stopped itself because the model kept repeating an identical, wholly-failing batch) or 'error'. None on every other event type. `error` says whether the loop raised; this says how it stopped when it did not, which is what tells a host that an answer is TRUNCATED rather than finished. */
  end_reason?: "done" | "terminate" | "aborted" | "max_turns" | "repeat_tool_calls" | "error" | null;
  /** Why an agent_end closed when the loop raised rather than finishing (e.g. 'RuntimeError: Connection refused'). None on a normal close; always paired with is_error=True when set. Without it 'the agent finished' and 'the agent died mid-turn' are the same event on the wire. */
  error?: string | null;
  /** `error` as fields, set exactly when `error` is (agent_end, provider_retry): `type` (the exception class name, always set), `status` (the HTTP status of a refusal), `retry_after` (seconds the server asked for), `headers` (the refusal's response headers, lowercased, set-cookie removed) and `retryable` (true for a transient failure — 408/429/502/503/504/529 or a connection failure — false for any other refusal, null when τ makes no judgement). Each is null when not known. See docs/RESPONSE-HEADERS.md §5. */
  error_detail?: ErrorDetail | null;
  /** Whether this event represents an error. */
  is_error?: boolean;
  /** The emitting cursor's resulting leaf, on agent_end (E5/F3). Filled in by rpc/transport.py's writer immediately before this line is serialized — not by rpc/wire_events.py at event-projection time — because persistence happens strictly AFTER agent_end fires; reading it any earlier reproduces the exact stale-tip bug this field exists to close. None for all other event types. */
  leaf?: string | null;
  /** The most retries that request will make, on provider_retry. None for all other event types. */
  max_retries?: number | null;
  /** Count of messages produced this turn, on agent_end (E2). The messages themselves are pulled via get_messages, never pushed. None for all other event types. */
  message_count?: number | null;
  /** On a tool_execution_* event for a call a tool made, the calling tool's call id; None for a call the model made. Experimental. */
  parent_tool_call_id?: string | null;
  /** Which side completion a side_completion_* event reports: 'compaction' or 'branch_summary'. Side work spends tokens and produces text outside any turn, so it stamps no submission_id and a host keys on this instead. The summary TEXT and what it cost are deliberately not on the wire — both land in the session log as a compaction or branch_summary entry, which get_entry serves with tokens_before, covered_tokens and summary_usage attached. Pushing unbounded content through an event is what WireEvent exists to avoid. None for all other event types. See docs/STREAMING-SIDE-WORK.md. */
  purpose?: "compaction" | "branch_summary" | null;
  /** What asked for a side completion: 'manual' (a person or this host), 'threshold' (the auto-trigger, which nobody asked for) or 'navigate' (the tree browser's summarising move). On all three side_completion_* events, so a host that attached mid-summary still learns whether the work was requested or imposed. None for all other event types. */
  reason?: "manual" | "threshold" | "navigate" | null;
  /** The thinking level this completion was requested with, after the provider clamped it to what the model supports, on the message_end that carries usage. Null when no reasoning control was sent — no level was set, or the model does not declare reasoning — so a requested level that was clamped or not sent is visible rather than silent. None for all other event types. See docs/REASONING-WIRE.md §3. */
  reasoning_level?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | null;
  /** Only meaningful when delta is set. False (the common case): delta is an incremental suffix — append it to whatever was already accumulated for this block_type this turn. True: the provider replaced rather than extended the block's content — delta is the block's ENTIRE new value, and the receiver must RESET its accumulator to delta rather than appending. Mirrors event_projection.BlockDelta.replace exactly. */
  replace?: boolean;
  /** The HTTP response headers of the completion this message_end closes, names lowercased, set-cookie removed. Set on the message_end that carries stop_reason; null there when the transport did not capture them, {} when the server sent none. τ parses none of them: rate-limit counters differ per vendor. None for all other event types. See docs/RESPONSE-HEADERS.md §5. */
  response_headers?: Record<string, string> | null;
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
  type: "agent_start" | "agent_end" | "turn_start" | "turn_end" | "message_start" | "message_update" | "message_end" | "tool_execution_start" | "tool_execution_update" | "tool_execution_end" | "side_completion_start" | "side_completion_update" | "side_completion_end" | "provider_retry" | "follow_ups_dropped";
  [key: string]: unknown;
}

/** Every frame a client sends. */
export type ClientFrame = {
  id: number | string;
  jsonrpc: "2.0";
  method: "hello";
  params?: Hello;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "list_sessions";
  params?: ListSessions;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "new_session";
  params?: NewSession;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "fork";
  params?: Fork;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "attach";
  params?: Attach;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "detach";
  params?: Detach;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "open_cursor";
  params?: OpenCursor;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "close_cursor";
  params?: CloseCursor;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "move_cursor";
  params?: MoveCursor;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "answer";
  params?: Answer;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "perform_ready";
  params?: PerformReady;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "describe";
  params?: Describe;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "shutdown";
  params?: Shutdown;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "compare";
  params?: Compare;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "end_compare";
  params?: EndCompare;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "submit";
  params?: Submit;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "prompt";
  params?: Prompt;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "abort";
  params?: Abort;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "compact";
  params?: Compact;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "get_state";
  params?: GetState;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "get_messages";
  params?: GetMessages;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "get_commands";
  params?: GetCommands;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "get_tools";
  params?: GetTools;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "get_models";
  params?: GetModels;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "get_session_name";
  params?: GetSessionName;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "get_session_stats";
  params?: GetSessionStats;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "get_last_assistant_text";
  params?: GetLastAssistantText;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "set_model";
  params?: SetModel;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "set_auto_compaction";
  params?: SetAutoCompaction;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "set_reasoning";
  params?: SetReasoning;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "set_session_name";
  params?: SetSessionName;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "complete_path";
  params?: CompletePath;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "next_step";
  params?: NextStep;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "enumerate_domain";
  params?: EnumerateDomain;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "complete_message_id";
  params?: CompleteMessageId;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "get_tree";
  params?: GetTree;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "get_entry";
  params?: GetEntry;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "get_pending_request";
  params?: GetPendingRequest;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "answer_request";
  params?: AnswerRequest;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "list_managed_extensions";
  params?: ListManagedExtensions;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "get_extension_state";
  params?: GetExtensionState;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "list_extensions";
  params?: ListExtensions;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "get_extension_config";
  params?: GetExtensionConfig;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "set_extension_config";
  params?: SetExtensionConfig;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "enable_extension";
  params?: EnableExtension;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "disable_extension";
  params?: DisableExtension;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "reload_extension";
  params?: ReloadExtension;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "navigate";
  params?: Navigate;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "summarize_and_navigate";
  params?: SummarizeAndNavigate;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "elide_span";
  params?: ElideSpan;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "commit_branch";
  params?: CommitBranch;
} | {
  id: number | string;
  jsonrpc: "2.0";
  method: "paste_subtree";
  params?: PasteSubtree;
};

/** Every frame the daemon sends. */
export type ServerFrame = Response | EventNotification;

/** Every request's `params`, by its `method`. */
export interface Requests {
  hello: Hello;
  list_sessions: ListSessions;
  new_session: NewSession;
  fork: Fork;
  attach: Attach;
  detach: Detach;
  open_cursor: OpenCursor;
  close_cursor: CloseCursor;
  move_cursor: MoveCursor;
  answer: Answer;
  perform_ready: PerformReady;
  describe: Describe;
  shutdown: Shutdown;
  compare: Compare;
  end_compare: EndCompare;
  submit: Submit;
  prompt: Prompt;
  abort: Abort;
  compact: Compact;
  get_state: GetState;
  get_messages: GetMessages;
  get_commands: GetCommands;
  get_tools: GetTools;
  get_models: GetModels;
  get_session_name: GetSessionName;
  get_session_stats: GetSessionStats;
  get_last_assistant_text: GetLastAssistantText;
  set_model: SetModel;
  set_auto_compaction: SetAutoCompaction;
  set_reasoning: SetReasoning;
  set_session_name: SetSessionName;
  complete_path: CompletePath;
  next_step: NextStep;
  enumerate_domain: EnumerateDomain;
  complete_message_id: CompleteMessageId;
  get_tree: GetTree;
  get_entry: GetEntry;
  get_pending_request: GetPendingRequest;
  answer_request: AnswerRequest;
  list_managed_extensions: ListManagedExtensions;
  get_extension_state: GetExtensionState;
  list_extensions: ListExtensions;
  get_extension_config: GetExtensionConfig;
  set_extension_config: SetExtensionConfig;
  enable_extension: EnableExtension;
  disable_extension: DisableExtension;
  reload_extension: ReloadExtension;
  navigate: Navigate;
  summarize_and_navigate: SummarizeAndNavigate;
  elide_span: ElideSpan;
  commit_branch: CommitBranch;
  paste_subtree: PasteSubtree;
}

/** What each request answers, by its `method`. */
export interface Results {
  hello: HelloResult;
  list_sessions: SessionList;
  new_session: SessionOpened;
  fork: SessionOpened;
  attach: Attached;
  detach: null;
  open_cursor: CursorOpened;
  close_cursor: null;
  move_cursor: null;
  answer: null;
  perform_ready: DispatchedCommand;
  describe: Surface;
  shutdown: null;
  compare: CompareStarted;
  end_compare: CompareEnded;
  submit: SubmitResult;
  prompt: PromptResult;
  abort: AbortResult;
  compact: CompactResult;
  get_state: GetStateResult;
  get_messages: GetMessagesResult;
  get_commands: GetCommandsResult;
  get_tools: GetToolsResult;
  get_models: GetModelsResult;
  get_session_name: GetSessionNameResult;
  get_session_stats: GetSessionStatsResult;
  get_last_assistant_text: GetLastAssistantTextResult;
  set_model: SetModelResult;
  set_auto_compaction: SetAutoCompactionResult;
  set_reasoning: SetReasoningResult;
  set_session_name: SetSessionNameResult;
  complete_path: CompletePathResult;
  next_step: NextStepResult;
  enumerate_domain: EnumerateDomainResult;
  complete_message_id: CompleteMessageIdResult;
  get_tree: GetTreeResult;
  get_entry: GetEntryResult;
  get_pending_request: GetPendingRequestResult;
  answer_request: AnswerRequestResult;
  list_managed_extensions: ListManagedExtensionsResult;
  get_extension_state: GetExtensionStateResult;
  list_extensions: ListExtensionsResult;
  get_extension_config: GetExtensionConfigResult;
  set_extension_config: SetExtensionConfigResult;
  enable_extension: EnableExtensionResult;
  disable_extension: DisableExtensionResult;
  reload_extension: ReloadExtensionResult;
  navigate: NavigateResult;
  summarize_and_navigate: SummarizeAndNavigateResult;
  elide_span: ElideSpanResult;
  commit_branch: CommitBranchResult;
  paste_subtree: PasteSubtreeResult;
}

export type RequestType = keyof Requests;
export type RequestFields<T extends RequestType> = Requests[T];

/** The `data` each event kind carries, by its `kind`. */
export interface EventData {
  agent_event: WireEvent;
  channel: ChannelEventData;
  compaction_end: CompactionEnd;
  cursors: CursorsEventData;
  entry_append: EntryEventData;
  entry_final: EntryEventData;
  entry_open: EntryEventData;
  request: RequestEventData;
  request_closed: RequestClosedEventData;
  ui: UiEventData;
}

export type EventKind = keyof EventData;

/** Every method, in the schema's order. */
export const REQUEST_TYPES = ["hello","list_sessions","new_session","fork","attach","detach","open_cursor","close_cursor","move_cursor","answer","perform_ready","describe","shutdown","compare","end_compare","submit","prompt","abort","compact","get_state","get_messages","get_commands","get_tools","get_models","get_session_name","get_session_stats","get_last_assistant_text","set_model","set_auto_compaction","set_reasoning","set_session_name","complete_path","next_step","enumerate_domain","complete_message_id","get_tree","get_entry","get_pending_request","answer_request","list_managed_extensions","get_extension_state","list_extensions","get_extension_config","set_extension_config","enable_extension","disable_extension","reload_extension","navigate","summarize_and_navigate","elide_span","commit_branch","paste_subtree"] as const;
/** Every error code a request can fail with, by name. */
export const ERROR_CODES = {
  PARSE_ERROR: -32700,
  INTERNAL_ERROR: -32603,
  INVALID_PARAMS: -32602,
  METHOD_NOT_FOUND: -32601,
  INVALID_REQUEST: -32600,
  NOT_FOUND: -32007,
  PROTOCOL_MISMATCH: -32006,
  UNAUTHORIZED: -32005,
  SESSION_NOT_PERSISTED: -32004,
  TURN_STILL_RUNNING: -32002,
  COMMAND_NOT_SUPPORTED: -32001,
  SUBMISSION_REJECTED: -32000,
} as const;
/** Every event kind, in the schema's order. */
export const EVENT_KINDS = ["agent_event","channel","compaction_end","cursors","entry_append","entry_final","entry_open","request","request_closed","ui"] as const;
