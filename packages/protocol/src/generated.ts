/* eslint-disable */
/**
 * GENERATED FILE -- DO NOT EDIT.
 *
 * Regenerate with `npm run generate`, which spawns a real tau process and
 * reads `get_capabilities`. The wire is the source of truth; nothing here is
 * hand-maintained.
 *
 * Protocol version: 1.5   Dialect: jsonrpc-2.0
 * Commands: 40   Declined: 7   Events: 10
 */

/** The protocol version this file was generated from. */
export const PROTOCOL_VERSION = "1.5" as const;
export const DIALECT = "jsonrpc-2.0" as const;

/** Bounds tau enforces on what a host may SEND. */
export const LIMITS = {
  "max_request_line_bytes": 8388608
} as const;

/** The ten agent lifecycle event types. */
export const EVENT_TYPES = [
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Verbs tau deliberately does not implement, with its stated reason. */
export const DECLINED: Readonly<Record<string, string>> = {
  bash: "τ's bash is a tool the agent loop executes under a Submission's provenance and admission rules, same as any other tool. An out-of-band 'run this in the shell' RPC verb would be a second, unauthenticated path into the same executor a host never drove a turn for — identical reasoning to the send_tool_result decline above: 'a second privileged path into the same executor is a second thing to secure.'",
  cycle_model: "A TUI keybinding affordance (step to the next configured model) leaking into a machine protocol — Tier D (REMOTE-CONTROL.md §3): 'a remote host enumerates and sets; it does not cycle.' A host that wants a specific model names it via set_model(name) — a shipped Tier B verb on this same table — rather than stepping through an ordered list it cannot see.",
  cycle_thinking_level: "Same Tier D judgment as cycle_model: a keybinding-shaped 'step to the next level' affordance, not a protocol verb. τ has no thinkingLevel concept on AgentSession today either (get_state's own notes list what τ has no equivalent of yet) — there is nothing for a set_* verb to set, let alone cycle.",
  export_html: "Tier D (REMOTE-CONTROL.md §3): 'a host can render.' τ's job over this wire is to hand back messages (get_messages) and events; rendering them as HTML is presentation logic that belongs in the host, not a service τ provides over stdio.",
  send_tool_result: "τ's AgentLoop executes tool calls itself. Accepting a tool result over RPC would open a second, unauthenticated path into the same executor that a host never drove the call for — Tier D's reasoning (REMOTE-CONTROL.md §3): 'a second privileged path into the same executor is a second thing to secure.'",
  set_follow_up_mode: "Same judgment as set_steering_mode: a TUI mode toggle with a per-submission equivalent (multitask_strategy='enqueue') already on the wire via submit/prompt, not a session-wide switch worth its own verb.",
  set_steering_mode: "A TUI keybinding-adjacent mode toggle (pi's Enter-steers / Alt+Enter-follows binding) with no session-wide state on AgentSession to toggle: multitask_strategy is already a PER-SUBMISSION parameter on submit/prompt's own params_schema, not a mode a host would set once and forget. The per-call knob this would duplicate already exists.",
};

/** The wire projection of ``AgentEvent`` (D3) — REMOTE-CONTROL.md's designed shape, and (as of unit 2B) what ``rpc/handler.py`` actually sends: ``rpc/wire_events.py`` constructs instances of this class rather than a hand-shaped dict. See the module docstring's Status note and the field-by-field comment above this class. */
export interface WireEvent {
  /** Event type discriminator. */
  type: "agent_start" | "agent_end" | "turn_start" | "turn_end" | "message_start" | "message_update" | "message_end" | "tool_execution_start" | "tool_execution_update" | "tool_execution_end";
  /** Milliseconds since epoch. */
  timestamp: number;
  /** Turn number (turn_*). */
  turn_index?: number | null;
  /** Tool call id (tool_*). */
  tool_call_id?: string | null;
  /** Tool name (tool_*). */
  tool_name?: string | null;
  /** Whether this event represents an error. */
  is_error?: boolean;
  /** Why an agent_end closed when the loop raised rather than finishing (e.g. 'RuntimeError: Connection refused'). None on a normal close; always paired with is_error=True when set. Without it 'the agent finished' and 'the agent died mid-turn' are the same event on the wire. */
  error?: string | null;
  /** How an agent_end closed: 'done' (the model had nothing more to say), 'terminate' (a tool asked to stop), 'aborted', 'max_turns' (the ceiling truncated the run), 'repeat_tool_calls' (the loop stopped itself because the model kept repeating an identical, wholly-failing batch) or 'error'. None on every other event type. `error` says whether the loop raised; this says how it stopped when it did not, which is what tells a host that an answer is TRUNCATED rather than finished. */
  end_reason?: "done" | "terminate" | "aborted" | "max_turns" | "repeat_tool_calls" | "error" | null;
  /** Whether a tool_execution_end is an extension veto (S50), distinct from a generic errored result. */
  blocked?: boolean;
  /** The extension that vetoed the call; paired with blocked. */
  blocked_by?: string | null;
  /** The Submission that drove this turn, if any (E4/G6). None for an event from a call that never went through submit()/prompt() — never a fabricated id. */
  submission_id?: string | null;
  /** The submission's origin (E4). None alongside submission_id. */
  source?: "interactive" | "rpc" | "extension" | "bus" | "timer" | "webhook" | "voice" | "agent" | null;
  /** WHO submitted (E4). None alongside submission_id. */
  submitter?: string | null;
  /** The submission's free-form origin detail (E4). None alongside submission_id — an empty dict would claim a submission with no correlation data, which is a different statement. */
  correlation?: Record<string, unknown> | null;
  /** A diffable content-block's delta on message_update (E1) — the prefix-diff against the previous message_update in the same turn, never the cumulative message. Only set for a diffable block kind (see block_type); a non-diffable block change (e.g. a growing toolCall) produces no wire event. None for all other event types. See `replace` for how to apply this value. */
  delta?: string | null;
  /** Which diffable content-block kind `delta` belongs to. Set exactly when `delta` is set. */
  block_type?: "text" | "thinking" | null;
  /** Only meaningful when delta is set. False (the common case): delta is an incremental suffix — append it to whatever was already accumulated for this block_type this turn. True: the provider replaced rather than extended the block's content — delta is the block's ENTIRE new value, and the receiver must RESET its accumulator to delta rather than appending. Mirrors event_projection.BlockDelta.replace exactly. */
  replace?: boolean;
  /** Count of messages produced this turn, on agent_end (E2). The messages themselves are pulled via get_messages, never pushed. None for all other event types. */
  message_count?: number | null;
  /** Why the model stopped this completion, on the message_end that carries usage. 'length' means the output cap ended it, so the content is a PREFIX and not an answer — the one value an operator has to act on. None on the content-only duplicate message_end (which carries no usage either) and on every other event type. This rides a field of its own because the message it belongs to is excluded from the wire; it is a closed enum, not unbounded content. See docs/TRUNCATED-TOOL-CALLS.md. */
  stop_reason?: "stop" | "length" | "toolUse" | "error" | "aborted" | null;
  /** How many tool calls this completion lost because the stream ended mid-argument, on message_end. A truncated or aborted arguments buffer is a prefix, so the provider drops the call rather than running it on a repaired or empty payload, and this is the only record that it existed. Null rather than 0 when none were dropped, so 'none lost' and 'not reported' stay distinguishable. None for all other event types. */
  dropped_tool_calls?: number | null;
  /** One sentence saying this turn's prompt cache should have been read and was not, on agent_end. Null is the normal case and says nothing was observed: the cache was read, the server accounts for no cache, the prompt is under the minimum cacheable prefix, or a read earlier in this session already proved caching is on. A host renders it as a warning; see docs/PROMPT-CACHING.md §7 for the three gates. None for all other event types. */
  cache_notice?: string | null;
  /** The session log's resulting cursor, on agent_end (E5/F3). Filled in by rpc/transport.py's writer immediately before this line is serialized — not by rpc/wire_events.py at event-projection time — because persistence happens strictly AFTER agent_end fires; reading it any earlier reproduces the exact stale-tip bug this field exists to close. None for all other event types. */
  cursor?: string | null;
  [key: string]: unknown;
}

/**
 * `abort` (tier A, since 2A).
 *
 * AgentSession.abort() (agent_session.py:3244) — synchronous, idempotent, and a SIGNAL only:
 * it requests the in-flight turn stop, and returns immediately, before that turn has unwound
 * or persisted anything. Phase-2 review B1: this response therefore does NOT carry a cursor —
 * one taken here would be the PRE-abort tip, exactly the stale-tip failure E5/F3 exist to
 * prevent, and the reviewer's own trace caught it (a 2s-gated turn aborted at 0.5s: this
 * call's cursor and the cursor AFTER the turn actually finished differed). E5 for `abort` (and
 * for `submit`/`prompt`, which share this trait) is satisfied instead by `WireEvent.cursor` on
 * the `agent_end` that follows — the one point the mutation has genuinely happened — never by
 * a value guessed at signal time. WHAT IT REACHES (finding 5, Tier B review): the in-flight
 * turn, and — since that finding — an in-flight `compact`. It did not before, and said
 * otherwise: a measured trace answered {status: aborted} at +0.00s and delivered
 * compaction_end {performed: true} at +20.01s, because AgentSession.compact consults no abort
 * flag anywhere. The compaction's background task is now cancelled here, and this response
 * names it in `compaction_id` (null when none was running) so a host knows which
 * compaction_end to expect. That notification carries `cancelled: true` and no `performed` — a
 * compaction stopped part-way neither performed nor found nothing to do, and nothing was
 * written (Fail Early: the summary is generated before the entry is appended). D-5's 'a
 * cancelled compaction emits no compaction_end' is unchanged for the case it was written about
 * — a SHUTDOWN reap, where there is no host left to correlate anything and the report goes to
 * stderr (T4); a host that asked for the cancellation is the opposite case and is told on the
 * wire. What abort still does NOT reach: an auto-compaction (`_maybe_auto_compact`), which
 * runs inside AgentSession with no RPC task to cancel — see set_auto_compaction's notes, which
 * state the same boundary from the other side.
 */
export type AbortParams = {};
export type AbortResult = {
  /** Always 'aborted'. */
  status: "aborted";
  /** The compaction this abort's signal was delivered to, or null when none was in flight (finding 5, Tier B review). Present so a host knows to expect a compaction_end carrying cancelled: true for that id. Whether the compaction actually stopped is reported THERE and not here — same signal-vs-outcome split that keeps `cursor` off this response. */
  compaction_id: string | null;
  [key: string]: unknown;
};

/**
 * `answer_request` (tier C, since 0.10.1).
 *
 * AgentSession.answer_request, projected — the write half of the pair get_pending_request
 * reads. Without it an RPC host could SEE a lock and not release one, which makes a locked
 * session a session that host can never continue; the TUI and the REPL both had the release
 * and this wire did not. The append happens BEFORE the dispatch, which is what releases the
 * lock first: the handler then runs on a session that is already unlocked and may submit a
 * turn of its own. `handled: false` is a WARNING and not a failure — the extension was not
 * loaded, the response was appended anyway and the lock is gone. TWO GUARDS THIS DOES NOT
 * TAKE, both stated rather than omitted. It takes no D-1 turn_safety_guard, for two reasons
 * that compound: a request is very often RAISED by a tool_call hook inside a turn
 * (docs/EXTENSION-LOCKS.md), so answering mid-turn is the designed case and not a race — and
 * the dispatched action may itself submit, which under a held turn_lock would deadlock against
 * the lock this verb was holding. The TUI and the REPL call the same method with no lock. It
 * takes no D-7 require_durable_session either, which is the one deliberate exception to 'the
 * verb that appends refuses': the append's product here is a RELEASED LOCK in this process,
 * and refusing would leave an unpersisted session locked with no way out at all — strictly
 * worse than the promise D-7 exists to stop being made, and the same reasoning `handled:
 * false` already applies to an absent extension. Refuses with INVALID_PARAMS, before any
 * append: an unknown request id, a request carrying no ask (a bare lock is cleared by
 * navigating or by its own command, not answered), an action label the ask does not declare,
 * or values its fields reject.
 */
export type AnswerRequestParams = {
  /** The request's `entry_id`, as get_pending_request reported it or as a SUBMISSION_REJECTED refusal carried it. */
  request_id: string;
  /** The pressed action's `label` — one of the labels in the ask's `actions`. The label, not the command it names: the label is what a person chose and what the ask's own table is keyed by. */
  action: string;
  /** The filled fields, keyed by field name. Omitted is the empty dict, which is what an ask declaring no fields takes. Checked against the ask's declared fields before anything is appended: nothing is coerced and no partial answer is persisted. */
  values?: Record<string, unknown>;
};
export type AnswerRequestResult = {
  /** Whether the extension that raised the request was loaded and ran its action. FALSE still means the response was appended and the lock released — a lock whose owner cannot answer must not become a session nobody can continue — so a host reports it as a warning and carries on, rather than as a failure to retry. */
  handled: boolean;
  /** What the dispatched command produced, or null. */
  output: string | null;
  /** session_log.cursor after the response was appended (E5 rule 1). The append is what RELEASES the lock — appending moves the cursor and a lock is read at the cursor — so this value is the evidence the session is answerable again. */
  cursor: string | null;
  [key: string]: unknown;
};

/**
 * `commit_branch` (tier C, since 0.9.8).
 *
 * tau_agent_core.tree_ops.commit_branch, projected. Builds a branch out of a set of marked
 * entries and continues on it (docs/TREE-BROWSER-AS-EDITOR.md §6). The copies are minted with
 * append_at, which does NOT move the leaf, and the leaf moves onto the last minted entry
 * afterwards — so the commit is atomic from the cursor's point of view and a mint that fails
 * partway leaves orphans hanging off the attach point rather than a half-moved conversation.
 * Refuses, all INVALID_PARAMS and all before the first append: an empty selection, an unknown
 * id, an entry no branch can carry, or a selection composing a path that is not turn-complete.
 * D-1: guarded by turn_safety_guard, so this refuses with TURN_STILL_RUNNING rather than
 * re-shaping the path an in-flight turn is being run against. D-7 rule 1: it APPENDS, so
 * require_durable_session refuses an unpersisted session (SESSION_NOT_PERSISTED) before
 * anything is touched — a tree edit that dies with the process leaves a host holding a
 * conversation it can never load again. E5 rule 1: the completion carries the resulting
 * `cursor`. Refuses: every caller error tau_agent_core.tree_ops raises — an unknown id above
 * all — comes back as INVALID_PARAMS, checked before the first append, so a refusal leaves the
 * log byte-identical. WHERE the entries land and for how long is set_model's own note: a
 * --mode rpc child defaults to a private <tmp>/.tau-<uid>/sessions, so durability is bounded
 * by machine uptime unless the host passed --session-dir DIR.
 */
export type CommitBranchParams = {
  /** The marked entry ids, in any order — tree_surgery puts them into tree order. The longest run that is already an ancestor chain is kept in place; the rest are minted as copies parented under it, so nothing is re-parented and nothing is erased. */
  ids: unknown[];
  /** Whether the branch keeps ONLY the selection. true appends an elide resuming at the root-most mark, so the context becomes the system prompt plus the branch; false leaves everything above the attach point in context. */
  drop_context: boolean;
};
export type CommitBranchResult = {
  /** ConversationTree.context_for(cursor) after the mutation — the same flat message array get_messages returns, for the path this call just produced. Returned rather than left for a follow-up get_messages because the mutation's whole product is a different context, and a host that had to fetch it separately could render the old one in between. */
  messages: unknown[];
  /** session_log.cursor after the mutation (E5 rule 1). */
  cursor: string | null;
  [key: string]: unknown;
};

/**
 * `compact` (tier B, since tier-b).
 *
 * Dual completion (C3), the same shape submit/prompt use: THIS response only acknowledges that
 * a compaction was admitted and is running ({accepted, compaction_id}); the outcome arrives
 * later as a `compaction_end` NOTIFICATION whose REQUIRED keys are compaction_id + request_id
 * (correlation), is_error, cancelled and cursor (E5) — `cancelled` is on EVERY one of them,
 * false on the ordinary paths, and it is what distinguishes 'a host aborted this' from 'this
 * failed' and from 'this found nothing'. Optional beside those: error, performed, and the full
 * CompactionResult
 * (summary/first_kept_entry_id/tokens_before/tokens_saved/compacted_entry_ids/usage, plus
 * CompactionDetails' read_files/modified_files). COMPACTION_END_PARAMS_SCHEMA is the authority
 * and a test pins this sentence against it, because the first version of this list was written
 * before `cancelled` existed and silently stayed wrong for a round (round-3 finding 3 of the
 * Tier B review) — a second implementor building a parser from it would have omitted a
 * required field. Blocker 1 (Tier B review) is why: summarization is an unbounded provider
 * call, and running it inline on the dispatch path stopped transport._read_stdin from PARSING
 * the next line — measured at 20s, with `abort` itself unanswerable for the duration, which is
 * exactly the availability property REMOTE-CONTROL.md §4[1] refuses to trade ('a host whose
 * whole problem is that τ is producing faster than it can read is precisely the host that
 * needs to abort'). performed=false reports AgentSession.compact() returning None (§1 ground
 * truth) as a real outcome, not an error — an empty conversation, one already ending in a
 * compaction summary, or a cut that would remove no message from the context at all, which
 * under the shipped keep_recent_tokens (20000) is what any smaller conversation gets, so it is
 * this verb's ordinary default-settings answer rather than an edge case; when is_error is
 * true, performed is ABSENT rather than false (a compaction that raised did not 'find nothing
 * to compact'). E5, answered the one way the whole tier answers it (see commands.py 'E5 in
 * Tier B'): `cursor` rides the COMPLETION — the compaction_end notification, where the
 * mutation has genuinely happened — never the acknowledgement, which is built before it has;
 * and it is present on ALL THREE outcomes, the post-compaction tip when performed and the
 * unchanged tip when performed=false or is_error, because absence is not this tier's way of
 * saying 'nothing moved'. custom_instructions, when given, is threaded unchanged to
 * AgentSession.compact. Refusals, all three on THIS response. Two are TURN_STILL_RUNNING
 * (D-1's vocabulary for 'no, a thing is running'): a turn that did not release turn_lock
 * within DEFAULT_SWAP_TIMEOUT_S (the guard is taken in the background task and HELD across the
 * whole compact() call, so a submit() using 'enqueue'/'rollback' cannot interleave with it),
 * and a second compact while one is already in flight — refused immediately, without waiting
 * out the guard, since a compaction holds that lock for as long as the provider takes. The
 * third is D-7 (see commands.py 'DURABILITY in Tier B'): this verb appends a `compaction`
 * entry, so an UNPERSISTED session — the product of new_session {"persist": false} — is
 * refused outright (require_durable_session -> SESSION_NOT_PERSISTED), checked before the
 * single-flight slot is taken and before the provider is paid, and the same answer set_model
 * and set_session_name give. Stated cost, not hidden: compaction is unavailable on an
 * unpersisted session; the fix is to move onto a persisted one. WHERE the entry lands, and for
 * how long (unit S, added at this review's integration — the other two appending verbs said it
 * and this one did not): a --mode rpc process defaults to storing its sessions under a private
 * <tmp>/.tau-<uid>/sessions, NOT the user's ~/.tau/sessions. Most systems clear the temp dir
 * on reboot, so the durability D-7 refuses to promise without is itself bounded by MACHINE
 * UPTIME rather than forever — including the compaction entry and the rewritten tree behind
 * it. A host that needs more must be started with --session-dir DIR (accepted under --mode rpc
 * precisely so a host can choose, including --session-dir ~/.tau/sessions). ABORT (finding 5,
 * Tier B review): a host's `abort` now cancels an in-flight compaction, where it used to
 * answer 'aborted' while the tree was rewritten anyway. The compaction_end that follows
 * carries cancelled=true, no `performed`, and the unchanged cursor; nothing was written,
 * because the summary is generated before the entry is appended. abort's own response names
 * the compaction_id, so the two correlate. Shutdown (D-5, as corrected by finding 3 of the
 * Tier B review, and distinct from the abort above — nobody asked for this one): a compaction
 * still running when the host disconnects is reaped by run()'s teardown, and it reports its
 * outcome EXACTLY ONE of three ways, never none of them. If it finishes while the writer is
 * still alive — which now includes the whole grace period run() gives background tasks,
 * because that reap was moved ahead of the stdout drain — the ordinary compaction_end is
 * delivered. If it finishes after the writer is genuinely gone (broken pipe, or SIGTERM
 * cancelling the writer outright), the full outcome goes to stderr (T4), because a
 * notification nobody can read is not a completion. If it is cancelled before finishing,
 * nothing was written and that too is said on stderr. The hole this closes was real and
 * measured: a compaction completing inside the reap's grace window used to be enqueued onto a
 * queue whose writer had already exited — rc 0, empty stderr, no compaction_end, and a
 * compaction entry durably in the session log for the next process to find unannounced.
 * Discoverability gap, stated not hidden: get_capabilities publishes a params_schema and a
 * result_schema per verb and the event half of the capability document is generated from
 * AgentEvent, so there is no slot in it for a server->client notification's payload.
 * compaction_end's field list is therefore documented here and in
 * commands.COMPACTION_END_PARAMS_SCHEMA (import-time-checked by _assert_supported_schema, like
 * every table schema) rather than published over the wire; widening the capability document to
 * carry notification schemas is a real gap this unit deliberately did not take on. Known gaps,
 * stated not hidden (not fixed by this unit): AgentSession.compact() itself does not acquire
 * turn_lock — the guard closes the race for THIS call only, and any OTHER direct caller (e.g.
 * a future TUI path) remains unprotected; that is AgentSession's debt. compact()'s own
 * agent_start/agent_end bracket (agent_session.py:3119,3123) is emitted via self._events.emit
 * directly, not _emit_stamped, so — same orphan-provenance shape D-4 documents for
 * _maybe_auto_compact — a host correlating events to submission_id sees that pair unstamped;
 * correlate on compaction_end instead. And finding 3 (Tier B review) is only narrowed, not
 * closed: this verb's ACKNOWLEDGEMENT still waits out the D-1 guard on the dispatch path, so a
 * compact sent while a TURN is running still costs the reader up to DEFAULT_SWAP_TIMEOUT_S —
 * bounded, unlike the unbounded case above, and the same bound
 * set_model/set_auto_compaction/set_session_name each pay.
 */
export type CompactParams = {
  /** Optional extra focus for the generated summary, threaded unchanged to AgentSession.compact(custom_instructions=...). */
  custom_instructions?: string;
};
export type CompactResult = {
  /** Always true — the compaction was admitted and is now running in the background. A refusal is an error response instead (TURN_STILL_RUNNING), never accepted: false. */
  accepted: boolean;
  /** Correlates this acknowledgement to the compaction_end notification that reports the outcome. Server-generated; a host does not supply it. */
  compaction_id: string;
  [key: string]: unknown;
};

/**
 * `complete_message_id` (tier C, since 0.9.8).
 *
 * The message_id domain's enumerator, addressed by its own capability name.
 * ConversationTree.complete_message_id over the session's live entries and cursor. Until this
 * verb, every capability taking an entry id was callable over the wire only by a host that had
 * been handed an id by something else — the hole get_models closed for set_model and
 * list_sessions for switch_session. Overlaps enumerate_domain {"domain": "message_id"}
 * deliberately and returns the same data under its own field names (entry_id/preview rather
 * than value/label): a host walking a FLOW's argument list reaches it through enumerate_domain
 * without knowing which capability enumerates that domain, and a host calling the capability
 * by name calls this. Read-only: no D-1 turn_safety_guard, no `cursor` in the result (E5 rule
 * 2 — a host that wants the tip calls get_state), and no require_durable_session (D-7 rule 2:
 * it appends nothing). Refuses: a `cursor` naming no entry, under a scope that needs one, is a
 * CALLER error and comes back as INVALID_PARAMS — the same classification set_model gives an
 * unknown model name. Fail-Early, because the alternative is an empty match list that reads as
 * 'the scope held nothing'.
 */
export type CompleteMessageIdParams = {
  /** Which entries are candidates. 'in_session' is every entry in the log; 'ancestors_of_cursor' is the parent chain from the root to `cursor` inclusive; 'descendants_of_cursor' is the subtree below it, excluding `cursor` itself. Omitted means 'in_session'. */
  scope?: "in_session" | "ancestors_of_cursor" | "descendants_of_cursor";
  /** The entry the two scoped variants are relative to. Omitted uses the session's own cursor (get_state's `cursor`). An id that names no entry is INVALID_PARAMS, never an empty match list. */
  cursor?: string;
  /** Filter text. Matches a case-sensitive PREFIX of an entry id, or a case-insensitive SUBSTRING of its preview — completion and search in one field. Omitted or empty matches everything in scope. */
  query?: string;
  /** How many matches to return at most. Omitted means 50. */
  limit?: number;
};
export type CompleteMessageIdResult = {
  /** The candidates in tree order (root-most first), as [{entry_id, preview}]: `entry_id` is the value every message_id argument takes, and `preview` is the entry's first line — the row the tree browser draws. Bounded by `limit`. */
  matches: unknown[];
  /** How many entries matched BEFORE `limit` was applied, so a host is told it is seeing a prefix rather than shown one silently (G3, the rule complete_path already follows). */
  total: number;
  [key: string]: unknown;
};

/**
 * `complete_path` (tier B, since 1.4).
 *
 * The @file half of what a chat editor needs to be usable, and the counterpart of
 * `get_commands` for the slash half. A host cannot compute this for itself: a browser has no
 * filesystem at all, and even a host that does have one (a VS Code extension) would be listing
 * ITS filesystem, which under Remote SSH or a devcontainer is the wrong machine. This answers
 * from the process working directory — the same directory the agent's own tools resolve
 * against and the same one `submit {expand_attachments: true}` reads, so the listing, the
 * expansion and the tools cannot disagree about which file @notes.txt names. A thin wrapper
 * over `attachments.complete_attachment`, which the TUI's own editor calls: one implementation
 * of the matching rules (case-sensitive prefix on the last path segment, hidden entries only
 * once the prefix itself starts with a dot), not two that drift. Read-only and pure apart from
 * reading directory entries: no D-1 turn_safety_guard (it mutates nothing, so it answers
 * mid-turn), no `cursor` (E5 binds mutators), no require_durable_session (D-7: it appends
 * nothing, and it answers the same under --no-session). G3, 'nothing unbounded is pushed':
 * `matches` is bounded by attachments._COMPLETION_LIMIT and `total` reports the true count, so
 * a host is told when it is seeing a prefix of the answer instead of silently shown one.
 * SCOPE, stated not hidden: an absolute or ../ token lists outside the working directory,
 * exactly as it does in the TUI. That is not a new hole — this same connection can run `bash`
 * through the agent — but a host serving this to a browser on a shared network is publishing a
 * directory lister to whoever holds the token, and should know it.
 */
export type CompletePathParams = {
  /** The editor's contents as typed, NOT just the @word. */
  text: string;
  /** The cursor's character offset into `text`. Which @reference is being completed is decided from this, so a host that sends the @word alone with cursor 0 gets `completion: null` rather than a listing — the cursor is not optional and is not defaulted. */
  cursor: number;
};
export type CompletePathResult = {
  /** `null` when the cursor is not inside an @reference at all — the host shows no popup. Otherwise {start, end, token, matches, total}: `start`/`end` are the character span of the whole @word, so a host replaces that span rather than guessing where the token began; `matches` is a list of {name, detail, is_dir}, `name` being the text that goes AFTER the @ (directories end in '/'); `total` is how many entries matched before the list was bounded, so a host can say '12 of 340' instead of implying it showed everything. An EMPTY `matches` with a non-null completion is the 'this names no file' warning, not an absence of information. */
  completion: Record<string, unknown> | null;
  [key: string]: unknown;
};

/**
 * `disable_extension` (tier C, since 0.9.8).
 *
 * AgentSession.disable_extension(), projected. Fires the extension's own session_shutdown with
 * reason 'disable' FIRST — the teardown seam, so a watcher or exit-commit runs cleanly — then
 * removes its runner bucket and unwinds the tools, commands and shortcuts it registered. The
 * LoadedExtension record is KEPT, which is what lets enable_extension bring it back without
 * re-reading the file. ok=false for an unknown target or one that is already disabled. D-1:
 * guarded by turn_safety_guard. An extension's hooks fire inside the turn, and its tools are
 * resolved from the registry this action rewrites, so running it mid-turn would change the
 * tool table under a loop that had already read it — TURN_STILL_RUNNING rather than that race.
 * D-7 rule 2: appends NOTHING, so no require_durable_session; extension state is runtime state
 * and is never written to the session log, which is also why it does not survive a respawn and
 * a host that wants an extension loaded at startup passes it on the command line. E5 rule 1:
 * the completion carries `cursor` anyway. `path` accepts a full managed path or a unique file
 * stem (AgentSession.resolve_extension_target); an ambiguous stem resolves to nothing and
 * comes back as ok=false, never a guess.
 */
export type DisableExtensionParams = {
  /** The managed extension to disable — a `path` from list_managed_extensions, or a unique file stem. */
  path: string;
};
export type DisableExtensionResult = {
  /** Which action ran — echoes the verb. */
  action: "enable" | "disable" | "reload" | "configure";
  /** The managed path the action resolved to. NOT always what was sent: `path` accepts a file stem as well as a full path, and this is the full path it matched. On a failed resolution it is the unresolved string, so a host can quote back what it asked for. */
  path: string;
  /** Whether the action changed anything. false is a reportable no-op, never an error: an unknown target, an already-enabled extension, an already-disabled one. A hard failure — a file that no longer imports, which only reload can hit — RAISES instead and reaches the host as INTERNAL_ERROR, with the extension left torn down. */
  ok: boolean;
  /** The human-readable line, the same one the TUI listing shows. */
  message: string;
  /** session_log.cursor — E5 rule 1 on a mutator whose whole product is runtime state. It is the live tip reported as a READ, not a claim that this call wrote anything; the same reading set_auto_compaction's cursor already has. */
  cursor: string | null;
  [key: string]: unknown;
};

/**
 * `elide_span` (tier C, since 0.9.8).
 *
 * tau_agent_core.tree_ops.elide_span, projected. Folds a span out of the active context — the
 * summary-less generalization of the compaction anchor. Synchronous and free: no summary,
 * therefore no model call. Nothing is erased; every entry the fold now skips is still in the
 * log and still browsable. Two refusals beyond the ordinary unknown-id one, both
 * INVALID_PARAMS and both checked before the first append: a first_kept_id that is not on the
 * anchor's path (the fold's forward scan would never find it and would emit the anchor and
 * nothing else), and a span that would hide nothing (a persisted node that changes nothing
 * about the context it was created to change is indistinguishable to a user from a successful
 * fold). D-1: guarded by turn_safety_guard, so this refuses with TURN_STILL_RUNNING rather
 * than re-shaping the path an in-flight turn is being run against. D-7 rule 1: it APPENDS, so
 * require_durable_session refuses an unpersisted session (SESSION_NOT_PERSISTED) before
 * anything is touched — a tree edit that dies with the process leaves a host holding a
 * conversation it can never load again. E5 rule 1: the completion carries the resulting
 * `cursor`. Refuses: every caller error tau_agent_core.tree_ops raises — an unknown id above
 * all — comes back as INVALID_PARAMS, checked before the first append, so a refusal leaves the
 * log byte-identical. WHERE the entries land and for how long is set_model's own note: a
 * --mode rpc child defaults to a private <tmp>/.tau-<uid>/sessions, so durability is bounded
 * by machine uptime unless the host passed --session-dir DIR.
 */
export type ElideSpanParams = {
  /** The entry the fold jumps FROM. The elide entry is appended as its child, so the anchor becomes the end of the kept region and the new tip. */
  anchor_id: string;
  /** The entry the fold resumes at — the anchor itself or one of its ANCESTORS, never a descendant. Everything on the path before it is the elided span. A resume point the fold's scan cannot reach would empty the context silently, which is why the wrong direction is refused rather than tolerated. */
  first_kept_id: string;
};
export type ElideSpanResult = {
  /** ConversationTree.context_for(cursor) after the mutation — the same flat message array get_messages returns, for the path this call just produced. Returned rather than left for a follow-up get_messages because the mutation's whole product is a different context, and a host that had to fetch it separately could render the old one in between. */
  messages: unknown[];
  /** session_log.cursor after the mutation (E5 rule 1). */
  cursor: string | null;
  [key: string]: unknown;
};

/**
 * `enable_extension` (tier C, since 0.9.8).
 *
 * AgentSession.enable_extension(), projected. Re-binds a DISABLED extension by re-invoking the
 * stored register(api) — the same entry point the loader called — against a fresh runner
 * bucket, then fires session_start with reason 'enable' so a watcher re-installs. It does not
 * re-read the file; reload_extension is the verb that does. ok=false for an unknown target or
 * one that is already enabled. D-1: guarded by turn_safety_guard. An extension's hooks fire
 * inside the turn, and its tools are resolved from the registry this action rewrites, so
 * running it mid-turn would change the tool table under a loop that had already read it —
 * TURN_STILL_RUNNING rather than that race. D-7 rule 2: appends NOTHING, so no
 * require_durable_session; extension state is runtime state and is never written to the
 * session log, which is also why it does not survive a respawn and a host that wants an
 * extension loaded at startup passes it on the command line. E5 rule 1: the completion carries
 * `cursor` anyway. `path` accepts a full managed path or a unique file stem
 * (AgentSession.resolve_extension_target); an ambiguous stem resolves to nothing and comes
 * back as ok=false, never a guess.
 */
export type EnableExtensionParams = {
  /** The managed extension to enable — a `path` from list_managed_extensions, or a unique file stem. */
  path: string;
};
export type EnableExtensionResult = {
  /** Which action ran — echoes the verb. */
  action: "enable" | "disable" | "reload" | "configure";
  /** The managed path the action resolved to. NOT always what was sent: `path` accepts a file stem as well as a full path, and this is the full path it matched. On a failed resolution it is the unresolved string, so a host can quote back what it asked for. */
  path: string;
  /** Whether the action changed anything. false is a reportable no-op, never an error: an unknown target, an already-enabled extension, an already-disabled one. A hard failure — a file that no longer imports, which only reload can hit — RAISES instead and reaches the host as INTERNAL_ERROR, with the extension left torn down. */
  ok: boolean;
  /** The human-readable line, the same one the TUI listing shows. */
  message: string;
  /** session_log.cursor — E5 rule 1 on a mutator whose whole product is runtime state. It is the live tip reported as a READ, not a claim that this call wrote anything; the same reading set_auto_compaction's cursor already has. */
  cursor: string | null;
  [key: string]: unknown;
};

/**
 * `enumerate_domain` (tier C, since 0.9.8).
 *
 * The other half of the flow loop. A flow argument carries a DOMAIN — a named type in τ's
 * object model — rather than a list of strings, and this is what turns one into the values
 * that are legal right now, each with a label a person can read. The rule it states once was
 * previously rediscovered twice by hand: `get_models` was added because `set_model`'s config
 * NAME was unconstructible from the wire (finding 7), and `list_sessions` because
 * `switch_session`'s id was (finding 8). A mutation with a bounded parameter is uncallable
 * without an enumerating read. It dispatches to those same readers rather than reimplementing
 * them, so a listing here and the corresponding verb cannot disagree about what exists.
 * `model_name` -> the bound model resolver's catalogue (the same one `get_models` reads);
 * `session_id` -> the runtime's SessionCatalog (the same `list_sessions` publishes); `path` ->
 * attachments.complete_attachment (the same `complete_path` wraps); `message_id` ->
 * ConversationTree.complete_message_id; `extension_name` ->
 * AgentSession.list_managed_extensions. A READ: no `cursor` (E5 rule 2), no D-1
 * turn_safety_guard, no require_durable_session. Fail-Early on a missing dependency: a domain
 * whose reader needs a runtime this process does not have RAISES rather than answering with an
 * empty list, which a host would read as 'there are none'.
 */
export type EnumerateDomainParams = {
  /** The domain's name, as a `next_step` step reported it. A domain that is `free` returns no values and total 0 — that is the answer, not a failure. */
  domain: string;
  /** For `message_id` only: which entries are candidates. Defaults to `in_session`. */
  scope?: "in_session" | "ancestors_of_cursor" | "descendants_of_cursor" | null;
  /** For a scoped `message_id`: the entry the scope is relative to. Null uses the live tip. An id that names no entry is an error, not an empty listing. */
  cursor?: string | null;
  /** Filter text. A value matches on a case-sensitive PREFIX of the value itself, or a case-insensitive SUBSTRING of its label — completion and search, because an id and its text are looked for differently. Empty matches everything in scope. */
  query?: string;
  /** How many values to return at most. Defaults to 50. */
  limit?: number;
};
export type EnumerateDomainResult = {
  /** The domain that was enumerated. */
  domain: string;
  /** A list of {value, label}. `value` is what a host binds into `next_step`'s `bound`; `label` is what it shows. They are equal for a domain whose values already read as text. */
  values: unknown[];
  /** How many values matched before `limit` was applied, so a host says '12 of 340' instead of implying it showed everything (G3). An empty `values` with a non-zero `total` cannot happen; an empty one with total 0 means the domain genuinely has none. */
  total: number;
  [key: string]: unknown;
};

/**
 * `fork` (tier A, since phase-3).
 *
 * H1: branches the CURRENT session's active-path history into a new, addressable session, and
 * moves this connection onto it — the source is left untouched on disk. Same {cancelled} veto
 * contract as new_session (H2). E5: the result carries the FORK's resulting cursor (its tip
 * after copying the source's history), not the source session's cursor. Same
 * TURN_STILL_RUNNING failure mode as new_session (Finding 1). `session.addressable` is always
 * true here (SessionCatalog.fork always writes — there is no unpersisted fork), so the fork's
 * id is one list_sessions returns and switch_session accepts; the field is reported rather
 * than assumed, because a host reads ONE contract across all three of these verbs (finding 7).
 */
export type ForkParams = {};
export type ForkResult = {
  /** True if a session_before_switch extension hook vetoed (H2). When true, `session`/`cursor` are absent — nothing was touched. An in-flight turn that did not stop in time is a DIFFERENT outcome and never reaches this shape — see TURN_STILL_RUNNING. */
  cancelled: boolean;
  /** F2's session tuple: {store, session_id, lane, cursor, addressable}. `lane` is always 'primary' in v1 (lanes are Tier C, not this phase). Present only when cancelled is false. `addressable` (finding 7 of the Tier B review) is the field that says whether `session_id` is a value ANOTHER call can use: true means list_sessions returns this id and switch_session resolves it; false means this session exists in memory only — it is `new_session {"persist": false}`'s product, switch_session answers -32602 for it, list_sessions never shows it, and the verbs D-7 rule 1 governs (set_model/set_session_name/compact) refuse on it. `store` names the store THIS CONNECTION's catalog is on, which is not a claim that this session is in it: when addressable is false, nothing was written to that store. */
  session?: Record<string, unknown>;
  /** The resulting session_log.cursor, duplicated at top level (E5/F3 — every mutating response returns the resulting cursor). Present only when cancelled is false. */
  cursor?: string | null;
  [key: string]: unknown;
};

/**
 * `get_capabilities` (tier A, since 2C).
 *
 * K1 (REMOTE-CONTROL.md §4[8]): {protocol_version, dialect, commands[], events[],
 * event_schema, ui_methods[], declined[{name, reason}]}. Built by WALKING COMMAND_TABLE and
 * rpc_event_schema (§6 recommendation), never hand-copied — see rpc/capabilities.py. K2: call
 * this FIRST on a new connection and check protocol_version before sending anything mutating.
 * ui_methods is always [] in v1 (RC3) — the honest statement that the reverse channel (§7.1)
 * does not exist yet.
 */
export type GetCapabilitiesParams = {};
export type GetCapabilitiesResult = {
  /** MAJOR.MINOR (K2). */
  protocol_version: string;
  /** Always 'jsonrpc-2.0' in v1 (D1). */
  dialect: string;
  /** Every non-declined COMMAND_TABLE row: {name, tier, since, notes, params_schema, result_schema}. */
  commands: unknown[];
  /** The AgentEvent-derived wire event type names. */
  events: unknown[];
  /** JSON Schema for a WireEvent's params (generated from AgentEvent, §6 point 3). */
  event_schema: Record<string, unknown>;
  /** Always [] in v1 (RC3) — the reverse channel does not exist yet. */
  ui_methods: unknown[];
  /** Every declined verb: {name, reason} (C1). */
  declined: unknown[];
  /** Bounds this process enforces on what a host may SEND, as numbers rather than as something to discover by tripping over it — today {max_request_line_bytes} (T7). Read live off the code that enforces each bound (capabilities.build_limits), so an advertised limit cannot drift from the applied one. A MAP rather than one field per bound: the next bound to be published is an addition INSIDE this object, which a host honoring E3 gets for free. */
  limits: Record<string, unknown>;
  [key: string]: unknown;
};

/**
 * `get_commands` (tier A, since 2C).
 *
 * Enumerated at CALL time, not tabled. §6 'One thing to keep dynamic': slash commands
 * contributed by extensions are genuinely runtime-variable, and pi builds this list by
 * enumeration too. That dynamism is specific to THIS verb and is not an argument for a dynamic
 * protocol-verb table (§6 A6). Returns τ's built-ins (commands.FRONTEND_COMMANDS,
 * origin='builtin') plus whatever extensions registered via api.register_command
 * (origin='extension'), in `resolve_command`'s own precedence order so the listing cannot
 * advertise a name that dispatch would resolve differently. `flow` says whether the command
 * declares what it TAKES: true means `next_step` steps it and `enumerate_domain` lists its
 * argument's values, so a host builds a form or a completion list rather than asking for one
 * opaque line. An extension command is a flow only if it used api.register_flow
 * (docs/EXTENSION-FLOWS.md).
 */
export type GetCommandsParams = {};
export type GetCommandsResult = {
  /** Every slash command that resolves right now, built-ins first. A `name` has no leading '/' — submit it as ordinary text with expand_commands=true, not as an RPC method. */
  commands: {
    /** The command word, with no leading '/'. */
    name: string;
    /** The one line a completion list or a palette shows. */
    description: string;
    /** Where the NAME came from: 'builtin' is τ's own vocabulary, 'extension' is one a loaded extension registered. Built-ins resolve first, so an extension cannot shadow one. It does NOT say who runs the command — that is which arm the dispatch returns. */
    origin: "builtin" | "extension";
    /** Whether this command DECLARES what it takes. True means `next_step` will step it and `enumerate_domain` will list its argument's values, so a host can build a form or a completion list for it; false means the command takes one opaque line and there is nothing to ask about. Every built-in flow is true and the two view commands are false; an extension command is true only if it used `register_flow` (docs/EXTENSION-FLOWS.md). */
    flow: boolean;
    [key: string]: unknown;
  }[];
  [key: string]: unknown;
};

/**
 * `get_entry` (tier C, since 0.10.1).
 *
 * ConversationTree.entry(entry_id) — one node's full body, which is what a detail pane beside
 * a tree draws and the reason get_tree carries a one-line `preview` per row instead of a
 * message. The pair is the same one the TUI's own browser makes: `tree()` for the rows,
 * `entry` for the node it is showing (tree_browser.py's `_resolve_entry`). get_messages does
 * not serve this — it answers for the ACTIVE PATH, and the node a reader has moved the
 * browser's cursor onto is very often not on it. The entry is handed over RAW, in its stored
 * camelCase shape, rather than projected: the caller is rendering one node, and a projection
 * would be a second message shape to keep in step with get_messages'. Bounded by the caller:
 * one id, one entry, and a host that wants ten asks ten times — the alternative, an ids array,
 * buys nothing over stdio and invites a host to pull a whole tree's bodies in one line.
 * Read-only: no D-1 turn_safety_guard, no E5 cursor (rule 2), no require_durable_session (D-7
 * rule 2).
 */
export type GetEntryParams = {
  /** The entry to read — an `entry_id` from get_tree or complete_message_id. An id naming no entry is INVALID_PARAMS, never a null entry. */
  entry_id: string;
};
export type GetEntryResult = {
  /** The raw session-log entry, as stored: camelCase `parentId` / `firstKeptId` / `fromId`, a `type`, and whatever payload that type carries — a `message` for the message kinds, a `summary` for a compaction or a branch_summary. Handed over whole rather than projected, because the caller is a detail pane rendering ONE node and a projection would be a second message shape to keep in step with get_messages'. One node per call: get_tree carries a one-line preview per row precisely so a browser does not pull bodies it is not showing. */
  entry: Record<string, unknown>;
  [key: string]: unknown;
};

/**
 * `get_extension_config` (tier C, since 0.9.8).
 *
 * AgentSession.get_extension_config(), projected. The read a settings screen is built from:
 * `schema` is the extension's own CONFIG_SCHEMA module attribute, validated at load into the
 * {title, fields} shape ui.form takes, and `values` is the live slice api.config returns for
 * it. A null `schema` is the honest answer for an extension that declares none — a host
 * renders no settings screen rather than an empty one. Read: no cursor (E5 rule 2), no turn
 * guard. Fail-Early: an unresolvable `path` RAISES here rather than returning a null row,
 * because unlike the enable/disable/reload verbs there is no ok=false channel on a read.
 */
export type GetExtensionConfigParams = {
  /** The managed extension to read — a `path` from list_managed_extensions, or a unique file stem. */
  path: string;
};
export type GetExtensionConfigResult = {
  /** The managed path the token resolved to, not the token sent. */
  path: string;
  /** The extension's CONFIG_SCHEMA, normalized at load into {title, fields} — the same spec shape ui.form takes, so a head that can render a form can render a settings screen with no new widget. null for an extension that declares none, which is the answer that tells a head to offer no screen rather than an empty one. */
  schema: Record<string, unknown>;
  /** The live slice api.config returns for this extension, keyed by file stem: config.json's extensions.<stem> with --ext-config overrides applied, plus any set_extension_config since. {} for an unconfigured extension — never the schema's defaults, which the extension itself supplies. */
  values: Record<string, unknown>;
  [key: string]: unknown;
};

/**
 * `get_extension_state` (tier C, since 0.9.8).
 *
 * AgentSession.get_extension_state(), projected through sdk.summarize_extensions — the read
 * the /extensions listing is built from, and the read a head needs before it can offer
 * enable/disable/reload as anything but a blind form. Whether each extension is currently
 * ENABLED is the separate read list_managed_extensions; a host that wants both composes them,
 * which is the division AgentSession.get_extension_state's own docstring states. Read-only: no
 * turn_safety_guard, no `cursor` (E5 rule 2), no require_durable_session (D-7 rule 2 —
 * extension state is runtime state and is never appended to the session log, so this answers
 * the same on a persisted and an unpersisted session).
 */
export type GetExtensionStateParams = {};
export type GetExtensionStateResult = {
  /** Every loaded extension and what it registered, as [{name, path, tools, commands, shortcuts, hooks, content_hash, subjects}] — sdk.summarize_extensions of the live registry, which is the same projection the TUI's /extensions listing draws. Read LIVE, not from the load-time snapshot, so a reload_extension is reflected here. */
  extensions: unknown[];
  /** Every discovered file that FAILED to load, as [{path, error}]. Kept from the last load_extensions call, because a failed import leaves nothing to recompute from. This is the half that makes this a read of its own rather than list_managed_extensions with more fields: a file that cannot import can never be a legal extension_name, and is exactly what a listing must show. */
  errors: unknown[];
  [key: string]: unknown;
};

/**
 * `get_last_assistant_text` (tier B, since tier-b).
 *
 * AgentSession.get_last_assistant_text(), projected. The derivation used to live HERE, in the
 * wire layer (docs/RPC-TIER-B.md §1: 'No method. Trivially derived') — which meant a head that
 * was not this one had to re-derive it and could reach a different answer; it is now one core
 * call and this verb is its projection. Read-only, no D-1 turn_safety_guard (nothing here
 * mutates session state). 'text' is the last qualifying assistant message's 'text'-type
 * content blocks concatenated and trimmed — thinking and toolCall blocks are skipped, never
 * concatenated in; an assistant message that is itself stop_reason='aborted' with empty
 * content is skipped as though it never happened, so an aborted-before-anything turn does not
 * hide the last real answer. Returns {"text": null} both when no assistant message exists yet
 * AND when the last one has no text (a pure tool-call turn) — pi does not distinguish these
 * either (docs/rpc.md only documents the first case); a host that needs to tell them apart
 * must additionally call get_messages. No `cursor`: E5 binds mutators, and this is a read
 * (commands.py 'E5 in Tier B', rule 2 — a host that wants the tip calls get_state). D-7
 * (commands.py 'DURABILITY in Tier B', rule 2): appends nothing, so no require_durable_session
 * — this answers the same on a persisted and an unpersisted session.
 */
export type GetLastAssistantTextParams = {};
export type GetLastAssistantTextResult = {
  /** The last assistant message's concatenated 'text' content blocks, trimmed. null if no qualifying assistant message exists YET, or if one exists but it has no text (e.g. a pure tool-call turn) — the two cases are DELIBERATELY indistinguishable on the wire, matching pi's own `getLastAssistantText(): string | undefined` (pi agent-session.ts:3092) and its RPC verb (rpc-mode.ts:609-612, docs/rpc.md: 'Returns {"text": null} if no assistant messages exist' — silent on the second null-producing case, because on the wire there is only one representable 'nothing' and pi does not either). */
  text: string | null;
  [key: string]: unknown;
};

/**
 * `get_messages` (tier A, since 2A).
 *
 * E2's PULL side — the terminal message array, fetched, never pushed.
 */
export type GetMessagesParams = {};
export type GetMessagesResult = {
  /** AgentSession.messages — the terminal, flat message array (E2's pull side). */
  messages: {
    /** 'system', 'user', 'assistant' or 'toolResult'. An extension-injected node carries 'custom' and the loop remaps it to 'user' before a provider sees it. */
    role: string;
    /** A plain string on a system message; elsewhere a list of content blocks, each carrying its own `type` — text, image, thinking or toolCall. */
    content: string | unknown[];
    /** Epoch MILLISECONDS at the moment the message happened: a user message's send, a toolResult's collection, an assistant message's end (or its cancellation, for a partial). null means no clock applies — a synthetic message an extension built, or a system message. Never 0; a session written before τ fixed this carries 0 on disk and every store maps it to null on load, so a host never sees one (docs/MESSAGE-TIMESTAMPS.md). Consecutive timestamps are what let a host compute per-call latency and whether a prompt cache entry had expired, and they read identically live and after a reload. */
    timestamp?: number | null;
    /** Present on assistant messages: the ONE completion that produced this message, as {input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cache_reported, total_tokens, extra}. Per-completion, never cumulative — each prompt already contains every earlier one, so summing total_tokens over a conversation counts turn 1 once per turn. cache_reported false means the server accounts for no prompt cache, so its cache_read_tokens of 0 is silence and not a miss; cache_read_tokens at 0 WITH cache_reported true is the signal described in docs/PROMPT-CACHING.md §7. */
    usage?: Record<string, unknown>;
    [key: string]: unknown;
  }[];
  [key: string]: unknown;
};

/**
 * `get_models` (tier B, since tier-b).
 *
 * Finding 7 of the Tier B review: set_model takes a config model NAME (a key in
 * ~/.tau/config.json's 'models' map) and nothing on this table enumerated them, so a host
 * could only learn a valid name by reading the child's config file out of band — which defeats
 * G1 ('a second implementation should be possible from this document plus the generated
 * reference'). Returns `models`: every name the session's bound resolver knows, sorted, each
 * with the SAME {id, provider, context_window} projection get_state publishes for the active
 * model. Each entry's `model` is produced by RESOLVING that name through the bound resolver —
 * the component set_model itself calls (AgentSession.set_model -> set_model_resolver) — so
 * what this verb advertises is what a set_model on that name would actually install, not a
 * second reading of the config. Read-only: no D-1 turn_safety_guard (nothing here mutates
 * session state; a turn may be in flight and this still answers) and no `cursor` (E5 binds
 * mutators — commands.py 'E5 in Tier B', rule 2; a host that wants the tip calls get_state),
 * and no require_durable_session (D-7, commands.py 'DURABILITY in Tier B', rule 2: it appends
 * nothing, so it answers the same on an unpersisted session — even though the set_model it
 * exists to serve would then refuse there). Refuses, rather than reporting an empty catalogue,
 * when the session has NO resolver bound at all, or a resolver that cannot enumerate
 * (RuntimeError -> INTERNAL_ERROR): 'this child has no configured models' and 'nobody can
 * answer that here' are different facts, and an empty list for the second is the
 * silent-fallback shape Fail-Early forbids — a host would read it as 'set_model has no valid
 * argument' and stop. A config entry that does not BUILD (e.g. an invalid `reasoning_replay`,
 * backends.build_model_from_config's own ValueError) fails this verb naming that entry, rather
 * than dropping it: a silently shorter list is a list a host would trust. KNOWN GAPS, stated
 * not hidden. (1) The ACTIVE model need not appear here, and this verb does not flag which
 * entry is active: a startup `--model provider/id` is an ad-hoc model with no config key
 * (headless.resolve_model_config), so set_model cannot switch back to it either, and two
 * config names may alias one model id — guessing 'active' by matching get_state's id would be
 * a fabrication where the aliases differ. A host reads get_state for what is running and this
 * for what it may ask for. (2) `context_window` is whatever the resolver returns; today
 * backends.build_model_from_config assigns every config entry the same 128000, including the
 * one get_state reports, so a host must not read a difference into these numbers that the
 * child does not currently make. (3) Nothing here is a capability probe: a name resolving does
 * not mean the endpoint is reachable or the api key is right — set_model's own notes record
 * that a cross-provider switch surfaces a provider auth error on the next turn.
 */
export type GetModelsParams = {};
export type GetModelsResult = {
  /** Every config model NAME this child can switch to, sorted, as [{name, model}]: `name` is the exact string set_model's `name` param takes, and `model` is the SAME projection get_state publishes for the active model — {id, provider, context_window} — obtained by resolving `name` through the session's bound model resolver, i.e. by asking the one component set_model itself would ask. Empty only when the child's config declares no models; a resolver that cannot be enumerated is an INTERNAL_ERROR, never an empty list. */
  models: unknown[];
  [key: string]: unknown;
};

/**
 * `get_pending_request` (tier C, since 0.10.1).
 *
 * AgentSession.pending_request, projected. 0.10.0 replaced ui.confirm / ui.select / ui.input
 * with one persisted `extension_request` entry and said every head renders all four of its
 * states — and the state was reachable over THIS wire only as `SUBMISSION_REJECTED` data,
 * which means an RPC host learned about a lock by being refused by it and could not see one
 * that had not refused it yet. A head polls this at every cursor move: after a turn ends,
 * after a command, on a resume, on a session switch. Null is the ordinary answer and is not a
 * failure. Read-only: no D-1 turn_safety_guard (a request raised by a tool_call hook is
 * exactly the case a host wants to see mid-turn), no E5 cursor (rule 2), no
 * require_durable_session (D-7 rule 2).
 */
export type GetPendingRequestParams = {};
export type GetPendingRequestResult = {
  /** The extension request AT THE CURSOR, or null when there is none. The cursor only, never an ancestry walk: the thing a user is looking at and the thing that refused their submission are one entry. {entry_id, extension, extension_name, sentence, label, lock, ask, release} — `label` is τ's own framing of the four states over `lock` and `ask`, `sentence` is the extension's own line, `ask` is a validated `ui.form` spec ({title, fields, actions}) or null, and `release` names a command that clears the lock (advisory: commands are exempt from a lock by placement, not by name). A host renders all four states; three of them draw something and the fourth is this verb answering null. */
  request: Record<string, unknown> | null;
  [key: string]: unknown;
};

/**
 * `get_session_name` (tier B, since tier-b).
 *
 * Read-only (docs/RPC-TIER-B.md B5: 'the read does not' take D-1's guard or carry a cursor).
 * Calls AgentSession.get_session_name, which is extension_types.read_session_name — the SAME
 * body ExtensionAPI.get_session_name calls. A session log with no durable name to read (e.g.
 * the SDK's InMemorySessionLog) raises RuntimeError, uncaught here, surfacing as
 * INTERNAL_ERROR: this is a READ, so it never takes D-7's guard and never earns
 * SESSION_NOT_PERSISTED — a log that cannot even be asked is a store wired wrong. Never set is
 * NOT that case: it returns {name: null}, same as read_session_name's own None. No `cursor`:
 * E5 binds mutators, and this is a read (commands.py 'E5 in Tier B', rule 2 — a host that
 * wants the tip calls get_state). No require_durable_session either (D-7, commands.py
 * 'DURABILITY in Tier B', rule 2): it appends nothing, so it reads a name back on an
 * unpersisted session even though set_session_name refuses to write one there.
 */
export type GetSessionNameParams = {};
export type GetSessionNameResult = {
  /** The session's durable display name, or null if never set (extension_types.read_session_name). */
  name: string | null;
  [key: string]: unknown;
};

/**
 * `get_session_stats` (tier B, since tier-b).
 *
 * D-3: get_state already returns usage/message_count/cursor, so this is not a re-shaping of
 * that — it is the verb a host reads to decide WHETHER and WHEN to compact. Returns:
 * estimate_context_tokens(session.messages) (compaction.py) as `context`; the model's
 * context_window and the resulting context_headroom; the EFFECTIVE CompactionSettings as
 * `compaction_settings` (enabled/reserve_tokens/keep_recent_tokens — read from
 * AgentSession.compaction_settings, which returns a copy); the newest compaction log entry as
 * `last_compaction` (null if none — an honest absence); and get_usage() as `usage`, for cost.
 * An RPC session is CONSTRUCTED with compaction_settings=CompactionSettings(enabled=False)
 * (backends.py:885), so a host that has not changed it reads compaction_settings.enabled=false
 * here — that is how it discovers auto-compaction is off (§1.1). That is a starting value, not
 * a constant this verb may promise: set_auto_compaction (D-4) shipped in this same tier and
 * flips exactly this field, so what comes back is the session's LIVE effective setting read at
 * call time. The verb itself changes nothing. Read-only: no turn_safety_guard (D-1 — only the
 * MUTATING Tier B verbs take it) and no `cursor` (E5 binds mutators — commands.py 'E5 in Tier
 * B', rule 2; a host that wants the tip calls get_state). Refuses nothing: no params, and no
 * precondition beyond a constructed session — including no require_durable_session (D-7,
 * commands.py 'DURABILITY in Tier B', rule 2: it appends nothing). That matters here
 * specifically: this is the verb a host reads to decide whether to compact, and on an
 * unpersisted session it still answers while `compact` itself refuses (D-7 rule 1). The
 * composition is AgentSession.get_session_stats(), one core call, and this verb is its
 * projection: it used to be assembled here, in the wire layer, which left every other head to
 * assemble its own. Known gap: `last_compaction` is a scan of the log's own append order, not
 * the ConversationTree active path — see AgentSession.get_last_compaction's docstring.
 */
export type GetSessionStatsParams = {};
export type GetSessionStatsResult = {
  /** estimate_context_tokens(session.messages) (compaction.py) projected as {tokens, usage_tokens, trailing_tokens, last_usage_index}: tokens is the total estimate the compaction threshold is checked against; usage_tokens is the anchored provider-reported count up to the last assistant Usage, trailing_tokens the heuristic estimate for messages after it, last_usage_index that message's index (null if no assistant Usage exists yet, in which case tokens==trailing_tokens and the whole list was heuristically estimated). */
  context: Record<string, unknown>;
  /** The active model's context_window (get_model()). */
  context_window: number;
  /** context_window - context.tokens. Can be negative: an honest over-budget number, never clamped to zero. */
  context_headroom: number;
  /** The session's EFFECTIVE CompactionSettings — {enabled, reserve_tokens, keep_recent_tokens}, read off AgentSession.compaction_settings, which hands back a COPY so a reader cannot retune a turn already in flight. An RPC session is CONSTRUCTED with enabled=False (backends.py:885) — that is how a host discovers auto-compaction is off (§1.1) — and set_auto_compaction (D-4, shipped in this same tier) is the one thing that changes it, so this reports the session's LIVE effective setting at call time, never a constant. */
  compaction_settings: Record<string, unknown>;
  /** {id, timestamp, summary, first_kept_id, tokens_before} for the most recent type=='compaction' entry in session_log.entries(), or null if this session has never compacted — an honest absence, never a fabricated entry. */
  last_compaction: Record<string, unknown> | null;
  /** AgentSession.get_usage() — null before the first completion. */
  usage: Record<string, unknown> | null;
  [key: string]: unknown;
};

/**
 * `get_state` (tier A, since 2A).
 *
 * An aggregate over AgentSession.state (session_id/status), is_streaming, get_model(),
 * get_usage(), messages, and session_log.cursor (F3: a host may not cache 'the tip', so cursor
 * rides on every state read). τ has no equivalent of pi's
 * thinkingLevel/steeringMode/followUpMode/sessionFile/pendingMessageCount — none of those
 * exist as AgentSession state today, so they are omitted rather than fabricated. Two of pi's
 * state fields DID gain a τ equivalent in Tier B, and are absent from THIS verb as duplication
 * rather than as absence: pi's sessionName is get_session_name (B5 — read off the session log
 * via extension_types.read_session_name; still not an AgentSession property, which is why it
 * is not folded in here), and pi's autoCompactionEnabled is get_session_stats'
 * compaction_settings.enabled (D-3), the field set_auto_compaction (D-4) writes. This verb
 * answers 'what is running'; get_session_stats' own notes state that division of labour.
 * `addressable` is the one field here that is not about the turn: it answers whether the
 * CURRENT session is persisted, which stopped being a constant when --mode rpc began honoring
 * --no-session. Before that the startup session was always persisted,
 * new_session/fork/switch_session reported addressable on the sessions THEY produced, and a
 * host that never called one of those three had no verb to ask — so the only way to learn an
 * unpersisted session was to trip -32004 on set_model. It belongs on the state read rather
 * than a verb of its own because a host already calls this one, and because it can change
 * under the connection's feet (a switch_session onto an ephemeral session) exactly as `model`
 * and `cursor` can.
 */
export type GetStateParams = {};
export type GetStateResult = {
  /** AgentSession.state.session_id. */
  session_id: string;
  /** AgentSession.state.status. */
  status: "idle" | "running";
  /** AgentSession.is_streaming. */
  is_streaming: boolean;
  /** AgentSession.get_model(): {id, provider, context_window}. */
  model: Record<string, unknown>;
  /** AgentSession.get_usage() — null before the first completion. */
  usage: Record<string, unknown> | null;
  /** len(AgentSession.messages). */
  message_count: number;
  /** session_log.cursor (F3: no host may cache 'the tip'). */
  cursor: string | null;
  /** Whether the CURRENT session is persisted: true if list_sessions returns it and switch_session can reach it later. The same predicate new_session/fork/switch_session publish on their session tuple, asked about the session this connection is on right now. False means the appending verbs (set_model, set_session_name, compact — D-7) will refuse with -32004 SESSION_NOT_PERSISTED, and nothing this connection does is written to the store. Reachable without a respawn: new_session {"persist": true} moves onto a persisted session. */
  addressable: boolean;
  [key: string]: unknown;
};

/**
 * `get_tools` (tier A, since 2A).
 *
 * Already implemented pre-2A; ported onto the table verbatim, no behaviour change.
 */
export type GetToolsParams = {};
export type GetToolsResult = {
  /** This session's bound AgentTool set, in binding order. */
  tools: {
    /** The tool's name, as a tool call addresses it. */
    name: string;
    /** What the model is told the tool does. */
    description: string;
    /** The tool's own JSON Schema, passed to the provider unchanged — this table's supported-keyword rule does not govern it. */
    parameters: Record<string, unknown>;
    [key: string]: unknown;
  }[];
  [key: string]: unknown;
};

/**
 * `get_tree` (tier C, since 0.10.1).
 *
 * ConversationTree.browse() over the session's live entries and cursor — the shape half of the
 * tree, and the read the five tree MUTATIONS were uncallable without. docs/VSCODE-HEAD.md §6
 * measured that gap and named this verb as what closes it: 0.9.8 put navigate, elide_span,
 * commit_branch, paste_subtree and summarize_and_navigate on the wire, and complete_message_id
 * returns a flat list of (entry_id, preview) pairs with no parent links — a picker, not a
 * browser. A host could edit a tree it had no way to draw. Every node carries the facts a
 * browser COLOURS a row with as well as the ones it draws it from, because each of them is
 * read out of the raw entry and no other verb hands a raw entry over: `first_kept_id` is the
 * fold's boundary, `tool_call_ids`/`tool_call_id` the pairing a mark expands over, `copyable`
 * the paste source rule, `from_id` the branch-summary pair. Without them an out-of-process
 * head would recompute each from a second reading of the log's shape, which is the drift the
 * capability registry exists to make impossible. FLAT with `parent_id`, not nested: a
 * five-hundred-message linear conversation nests five hundred deep, and json.dumps has a
 * recursion limit where a tree does not. UNBOUNDED, deliberately, and this is the one place G3
 * is argued rather than applied: G3 forbids pushing something unbounded, and this is a PULL —
 * the shape IS the answer, and a bounded shape is a different tree. `count` is there so a host
 * can say it read a whole one. Read-only: no D-1 turn_safety_guard (it mutates nothing, so it
 * answers mid-turn — a browser opened while a turn streams shows the tree as it stands), no
 * `cursor` in the E5 sense (the `cursor` key here is the tip this READ observed, not a
 * mutation's product), and no require_durable_session (D-7 rule 2: it appends nothing, and an
 * unpersisted session has a tree like any other). The `/tree` VIEW command still carries
 * `unavailable_because` rather than state: resolve_command is pure and holds no session, so a
 * head opens the view from THIS read — which is what that sentence has said since 0.9.8 and
 * what it can now mean.
 */
export type GetTreeParams = {};
export type GetTreeResult = {
  /** Every entry in the log, in the order a browser draws them — preorder over the parent/child tree, roots in load order, children oldest first. FLAT, with `parent_id` carrying the shape: a nested projection of a long linear conversation is one nesting level per message, which is a serializer's recursion limit rather than a tree anyone wanted. Nothing is filtered out — which rows a browser declines to draw (a `navigate` with one child) is the reader's rule, not the log's. */
  nodes: {
    /** The entry's id — the value every `message_id` argument takes (navigate, elide_span, commit_branch, paste_subtree, summarize_and_navigate). */
    entry_id: string;
    /** The entry this one hangs from; null for a root. */
    parent_id: string | null;
    /** The entry's type: 'message', 'customMessage', 'compaction', 'elide', 'branch_summary', 'navigate', 'customEntry', 'model_change'. Not a closed enum — a kind added later reaches a host as a row it can draw and does not recognise, rather than as a gap. */
    kind: string;
    /** 'user', 'assistant', 'toolResult' or 'system' on a message entry; null on every bookkeeping kind. */
    role: string | null;
    /** The entry's first line, uncut — a host elides it to its own width. Empty for an entry carrying no text. */
    preview: string;
    /** Whether this entry is the session's cursor — where the next submission lands. Exactly one node carries true, or none on a session whose cursor names no entry. */
    is_cursor: boolean;
    /** Epoch milliseconds, or null when no clock applies (docs/MESSAGE-TIMESTAMPS.md). This is the key children are sorted by, so re-sorting on it reproduces `nodes`. */
    timestamp: number | null;
    /** On a splice anchor ('compaction' or 'elide'), the oldest entry the fold keeps; null on every other kind. This is the fold's whole boundary: the entries a host paints as folded are the ones on the cursor's ancestor chain that sit before this id, with a system message carried across (docs/SYSTEM-PROMPT-IN-THE-FOLD.md). Sent because a host holding only the shape would have to guess at it. */
    first_kept_id: string | null;
    /** On a 'branch_summary', the head of the branch it summarizes — the pair a browser draws as a summary and the line it is about. Display metadata, never a splice boundary. Null on every other kind. */
    from_id: string | null;
    /** Whether this entry is the system prompt. A fold carries it across rather than dropping it, so a host computing the folded span excludes it. */
    is_system: boolean;
    /** The toolCall block ids an assistant message declares; empty on every other entry. With `tool_call_id` this is the whole of the pairing rule a mark expands over: to every provider a call and its result are one unit, and a branch carrying one without the other is a prefix the API rejects (docs/TREE-EDITOR-MANUAL.md §6). */
    tool_call_ids: string[];
    /** The call a 'toolResult' answers; null elsewhere. */
    tool_call_id: string | null;
    /** Whether paste_subtree will take this entry as a source root — conversation_tree.COPYABLE_KINDS, reported per node so a host greys the illegal source rather than holding a second copy of the tuple. */
    copyable: boolean;
    /** compaction.estimate_tokens over this entry's message, 0 for an entry carrying none. An ESTIMATE — a 4-chars-per-token heuristic — and the only token figure available for an arbitrary set of entries, because the one measured figure in a session is usage.input_tokens on a finished assistant message and that measures one request. A host totalling these says 'estimate' beside the number, as the TUI's browser does. */
    estimated_tokens: number;
    [key: string]: unknown;
  }[];
  /** session_log.cursor at the moment of the read, duplicated out of `nodes` so a host finds it without scanning. Null on a session whose cursor names no entry, which is also the one case in which no node carries is_cursor: true. */
  cursor: string | null;
  /** len(nodes). Present so a host can check it read a whole tree rather than a truncated one: this read is UNBOUNDED by design — the shape IS the answer and a bounded shape is a different tree — which is why it is a pull and is never pushed (G3). */
  count: number;
  [key: string]: unknown;
};

/**
 * `list_managed_extensions` (tier C, since 0.9.8).
 *
 * The extension_name domain's enumerator, addressed by its own capability name:
 * AgentSession.list_managed_extensions(), projected. Overlaps enumerate_domain {"domain":
 * "extension_name"} the way complete_message_id overlaps its own domain — with one difference
 * worth a host's attention: enumerate_domain has only value/label to work with, so it renders
 * enabled-ness INTO the label ('path (disabled)'), and this verb hands back the boolean. A
 * host deciding whether to offer enable or disable wants this one. Read-only: no
 * turn_safety_guard, no `cursor` (E5 rule 2), no require_durable_session (D-7 rule 2). Answers
 * only about MANAGED file extensions — a file that failed to import is not here, because it
 * can never be a legal extension_name; get_extension_state is the read that shows it.
 */
export type ListManagedExtensionsParams = {};
export type ListManagedExtensionsResult = {
  /** Every file extension under management, in load order, as [{path, enabled}]. `path` is the exact string every extension_name argument takes (enable_extension, disable_extension, reload_extension); `enabled` is false exactly when the extension is loaded but its bucket has been removed from the runner, so its hooks, tools and slash commands are not offered. */
  extensions: unknown[];
  [key: string]: unknown;
};

/**
 * `list_sessions` (tier B, since tier-b).
 *
 * Finding 8 of the Tier B review: switch_session takes a session id (exact, or a unique
 * prefix) and nothing on this table produced one, so a host could only reach a session it had
 * created in this process — the same G1 hole get_models closed for set_model's config NAME,
 * and, being absent from `declined` too, a C1 violation rather than a deferral. Returns
 * `sessions`: every session this connection can switch to, newest-modified first, and `scope`:
 * {store, cwd}, which says WHICH universe that is. The listing and switch_session's resolution
 * are the SAME set by construction, not by agreement — both are SessionCatalog.list(cwd) for
 * this process's cwd (resolve_ref is built on it), so an id this verb returns is an id that
 * verb accepts, and a session it omits is one switch_session refuses with -32602. That is also
 * this tier's definition of `addressable` on new_session/fork/switch_session's session tuple:
 * addressable means listed here. Scope, stated because unit S (D-6/H1b) made it a real
 * question: --mode rpc's DEFAULT session base is <tmp>/.tau-<uid>/sessions while the TUI's and
 * --print's is ~/.tau/sessions, so a host and the human at the terminal are normally looking
 * at DIFFERENT lists (--session-dir DIR, accepted under --mode rpc, is how a host joins the
 * user's). Each row's `ref` — the store's own handle, the file store's absolute path — is what
 * tells them apart; an RPC child's own startup session is always one of these rows, so
 * `get_state`'s session_id finds it and its ref names the base. Read-only: no D-1
 * turn_safety_guard (nothing here mutates session state; a turn may be in flight and this
 * still answers), no `cursor` (E5 binds mutators — commands.py 'E5 in Tier B', rule 2; a host
 * that wants the tip calls get_state), and no require_durable_session (D-7, commands.py
 * 'DURABILITY in Tier B', rule 2: it appends nothing, so it answers the same on an unpersisted
 * session — where the answer is precisely that the current session is NOT among the rows).
 * KNOWN GAPS, stated not hidden. (1) It does not flag which row is the session this connection
 * is on, for the reason get_models does not flag the active model: the host already has that
 * from get_state's `session_id`, and here the comparison is exact rather than a guess. (2) No
 * `cwd` parameter, and no way to widen the scope to every directory: switch_session resolves
 * against THIS cwd only, so a wider list would advertise ids it would then refuse. (3) A row
 * is metadata, never a promise that loading succeeds — `error` non-null says the entries could
 * not be read, and switch_session on that id will raise the store's real reason rather than
 * silently loading an empty conversation.
 */
export type ListSessionsParams = {};
export type ListSessionsResult = {
  /** Every session `switch_session` can resolve from this connection, newest-modified first, as [{session_id, ref, name, title, message_count, created, modified, parent, error}]. `session_id` is the exact string switch_session's `session_id` param takes. `ref` is the STORE's own handle for that session (SessionCatalog's listing ref — the file store's absolute .jsonl path, a JMFTS catalog's document id): it is what names WHICH universe this listing is, since --mode rpc's default session base is <tmp>/.tau-<uid>/sessions and the TUI's is ~/.tau/sessions (D-6/H1b). `name` is what set_session_name set, null if never named; `title` is the picker's bounded display label (SessionInfo.display_title) and is the only place message TEXT appears here — first_message/last_message are deliberately not published, being unbounded (a 40kB prompt would ride every listing). `created`/`modified` are ISO-8601; `parent` is the id this session was forked from, else null; `error` is why this row's entries could not be read, else null — an unreadable session stays LISTED and says so (SessionInfo.error) rather than vanishing from a host's view. */
  sessions: unknown[];
  /** What universe the list above is, as {store, cwd}: `store` is the same backend label the session tuple of new_session/fork/switch_session carries, and `cwd` is the working directory the listing is scoped to — this process's own, the identical scope switch_session resolves against (SessionCatalog.resolve_ref is built on list(cwd)), so the ids here are exactly the ids that verb accepts. Sessions in OTHER directories are not listed because switch_session could not reach them either. The BASE DIRECTORY is not a field: no SessionCatalog declares one (the file store's is private and `None` means the default), and each entry's `ref` names it exactly — stated as a limit, not hidden: an EMPTY list therefore names no location at all. */
  scope: Record<string, unknown>;
  [key: string]: unknown;
};

/**
 * `navigate` (tier C, since 0.9.8).
 *
 * tau_agent_core.tree_ops.navigate, projected. Moves the session cursor to an entry and hands
 * back the context that produces. Zero model calls: it appends one `navigate` entry. A
 * target_id that is already the cursor is a no-op that still returns the context, so a host
 * need not check first. Until this verb τ's differentiating feature — a session tree a caller
 * can move around in — was reachable only from inside the Textual head (docs/VSCODE-HEAD.md
 * §6). D-1: guarded by turn_safety_guard, so this refuses with TURN_STILL_RUNNING rather than
 * re-shaping the path an in-flight turn is being run against. D-7 rule 1: it APPENDS, so
 * require_durable_session refuses an unpersisted session (SESSION_NOT_PERSISTED) before
 * anything is touched — a tree edit that dies with the process leaves a host holding a
 * conversation it can never load again. E5 rule 1: the completion carries the resulting
 * `cursor`. Refuses: every caller error tau_agent_core.tree_ops raises — an unknown id above
 * all — comes back as INVALID_PARAMS, checked before the first append, so a refusal leaves the
 * log byte-identical. WHERE the entries land and for how long is set_model's own note: a
 * --mode rpc child defaults to a private <tmp>/.tau-<uid>/sessions, so durability is bounded
 * by machine uptime unless the host passed --session-dir DIR.
 */
export type NavigateParams = {
  /** The entry to move the cursor onto — an `entry_id` from complete_message_id. The abandoned branch drops out of context via the parentId walk but stays on disk and stays browsable; nothing is erased. */
  target_id: string;
};
export type NavigateResult = {
  /** ConversationTree.context_for(cursor) after the mutation — the same flat message array get_messages returns, for the path this call just produced. Returned rather than left for a follow-up get_messages because the mutation's whole product is a different context, and a host that had to fetch it separately could render the old one in between. */
  messages: unknown[];
  /** session_log.cursor after the mutation (E5 rule 1). */
  cursor: string | null;
  [key: string]: unknown;
};

/**
 * `new_session` (tier A, since phase-3).
 *
 * H1 (REMOTE-CONTROL.md §4[6]): starts a fresh conversation on the SAME AgentSession
 * (model/tools/extensions/provider stay warm — H3). `persist` defaults to true (Blocker 2,
 * Tier B review): the fresh session is written to the configured store, so it is addressable
 * by switch_session and durable for the verbs that append to it
 * (set_model/set_session_name/compact — D-7). Pass false for an in-memory conversation — those
 * three verbs then refuse on it rather than promising a durable write, and the session tuple
 * says so on the wire: `addressable: false` (finding 7 of the same review, which measured this
 * verb returning an 'addressable tuple' for a session switch_session answered -32602 for).
 * Addressable means exactly 'list_sessions returns this id'. {cancelled} is H2's veto
 * contract: a session_before_switch extension hook may refuse, and a host must treat that as a
 * hard failure rather than a silent no-op. E5: the result carries the resulting cursor —
 * always the fresh log's cursor here, never a value from before this call ran.
 * TURN_STILL_RUNNING (Finding 1): an in-flight turn that did not stop within the bounded wait
 * after abort() — nothing was touched; retry, or wait for agent_end first.
 */
export type NewSessionParams = {
  /** Whether the new session is written to the configured store. Omitted defaults to TRUE: addressable by switch_session, listed by list_sessions, and able to keep what set_model/set_session_name/compact append to it. false gives an in-memory conversation that outlives nothing — the result then reports `session.addressable: false` (finding 7), no list_sessions row exists for its id, switch_session refuses it, and those three verbs REFUSE (SESSION_NOT_PERSISTED) rather than return a cursor for a write that never landed. Which verbs those are is not a list to memorise: D-7 (commands.py 'DURABILITY in Tier B') is 'the verb that appends refuses', and the rest — including set_auto_compaction — answer normally. */
  persist?: boolean;
};
export type NewSessionResult = {
  /** True if a session_before_switch extension hook vetoed (H2). When true, `session`/`cursor` are absent — nothing was touched. An in-flight turn that did not stop in time is a DIFFERENT outcome and never reaches this shape — see TURN_STILL_RUNNING. */
  cancelled: boolean;
  /** F2's session tuple: {store, session_id, lane, cursor, addressable}. `lane` is always 'primary' in v1 (lanes are Tier C, not this phase). Present only when cancelled is false. `addressable` (finding 7 of the Tier B review) is the field that says whether `session_id` is a value ANOTHER call can use: true means list_sessions returns this id and switch_session resolves it; false means this session exists in memory only — it is `new_session {"persist": false}`'s product, switch_session answers -32602 for it, list_sessions never shows it, and the verbs D-7 rule 1 governs (set_model/set_session_name/compact) refuse on it. `store` names the store THIS CONNECTION's catalog is on, which is not a claim that this session is in it: when addressable is false, nothing was written to that store. */
  session?: Record<string, unknown>;
  /** The resulting session_log.cursor, duplicated at top level (E5/F3 — every mutating response returns the resulting cursor). Present only when cancelled is false. */
  cursor?: string | null;
  [key: string]: unknown;
};

/**
 * `next_step` (tier C, since 0.9.8).
 *
 * Half of the flow loop, and the reason a host can offer a gesture it has never heard of. A
 * flow is an ordered argument list ending in one mutation; this returns either the next
 * argument or the mutation, and a host renders whatever it gets. The same call drives a modal
 * wizard, a tab-completion popup and a shell — the difference between them is the presenter,
 * not the protocol. It has to be on the wire rather than computed host-side because τ's
 * extensions are unknown to the host: a host cannot enumerate valid actions it has no table
 * for. PURE and a READ: it performs nothing, reads no session, and therefore carries no
 * `cursor` (E5 rule 2). No D-1 turn_safety_guard — it mutates nothing, so it answers mid-turn
 * — and no require_durable_session, since it appends nothing and answers the same under
 * --no-session. Partial arguments ARE the dry run: a flow invoked with nothing bound reports
 * its first step and changes nothing, which is why there is no `-y` and no confirmation verb.
 */
export type NextStepParams = {
  /** The flow's name — one of the `name`s `get_commands` lists. An unknown name is an error, not an empty answer: a host that believes a flow exists must be told it does not. */
  flow: string;
  /** The arguments bound so far, keyed by argument name. Omit it, or send {}, for the flow's first step. Only REQUIRED arguments block, so a flow whose arguments are all optional is `ready` on the first call. */
  bound?: Record<string, unknown>;
  /** The entry a scoped `message_id` argument is relative to. A parameter rather than the live tip, so a host stepping a sub-agent's flow scopes to THAT agent's cursor. It is echoed back on the step so the host hands it straight to `enumerate_domain`. */
  cursor?: string | null;
};
export type NextStepResult = {
  /** `step` — one required argument is still unbound and `step` describes it. `ready` — every required argument is bound and `ready` names the mutation to perform and what to perform it with. The two are mutually exclusive and exactly one is present. */
  status: "step" | "ready";
  /** {flow, argument, domain, cursor, bound}. `argument` is {name, domain, description, cardinality, required, scope}; `domain` is the resolved domain record {name, description, free, values, enumerator}, included so a host can render the field without a second call — `values` is non-null for a small fixed set, and `enumerator` non-null means call `enumerate_domain` for the live set. */
  step?: Record<string, unknown> | null;
  /** {flow, mutation, arguments}. `mutation` is the capability to perform — the named flow's, always, so a host that already knows which flow it stepped can dispatch before this returns. `arguments` is what to perform it with, keyed by the mutation's own parameter names. This is a commitment: τ does not ask a second time, and a host that wants a confirmation renders one from this. */
  ready?: Record<string, unknown> | null;
  [key: string]: unknown;
};

/**
 * `paste_subtree` (tier C, since 0.9.8).
 *
 * tau_agent_core.tree_ops.paste_subtree, projected (docs/TREE-BROWSER-AS-EDITOR.md §7). Every
 * copied entry is a new entry carrying `copiedFrom`, minted with append_at, parents before
 * children, with a source-to-new id map re-hanging each child under its copied parent — so the
 * copy keeps the original's shape including its forks. The one tree mutation whose result is
 * NOT a message list: the leaf never moves, so what the model sees changes only when someone
 * navigates onto the copy. Refuses: an unknown id, a source whose kind cannot be copied, a
 * target inside the source's own subtree, or a copied tool result whose call is on neither the
 * target's path nor the copied run. D-1: guarded by turn_safety_guard, so this refuses with
 * TURN_STILL_RUNNING rather than re-shaping the path an in-flight turn is being run against.
 * D-7 rule 1: it APPENDS, so require_durable_session refuses an unpersisted session
 * (SESSION_NOT_PERSISTED) before anything is touched — a tree edit that dies with the process
 * leaves a host holding a conversation it can never load again. E5 rule 1: the completion
 * carries the resulting `cursor`. Refuses: every caller error tau_agent_core.tree_ops raises —
 * an unknown id above all — comes back as INVALID_PARAMS, checked before the first append, so
 * a refusal leaves the log byte-identical. WHERE the entries land and for how long is
 * set_model's own note: a --mode rpc child defaults to a private <tmp>/.tau-<uid>/sessions, so
 * durability is bounded by machine uptime unless the host passed --session-dir DIR.
 */
export type PasteSubtreeParams = {
  /** The copied node — the root of the subtree. */
  source_id: string;
  /** The entry the copy hangs from. May not be inside the source's own subtree. */
  target_id: string;
};
export type PasteSubtreeResult = {
  /** The ids minted, in the order they were appended. The first is the copy of `source_id` itself. Ids rather than messages because a paste edits the TREE and never moves the leaf: the current context is unchanged, so there is nothing to re-render until someone navigates onto the copy. */
  minted_ids: unknown[];
  /** session_log.cursor after the paste — E5 rule 1, and here it is the UNCHANGED tip, present because absence is never a signal (rule 3), not because anything moved. */
  cursor: string | null;
  [key: string]: unknown;
};

/**
 * `prompt` (tier A, since 2A).
 *
 * §10 decision 10: one implementation, two names. Builds the same Submission `submit` does,
 * with source/submitter/submission_id/correlation DEFAULTED rather than required — provenance
 * is always present on the wire, merely defaulted when the host does not supply it. Same dual
 * completion as `submit` (C3).
 */
export type PromptParams = {
  /** The prompt text. */
  text: string;
  /** Optional list of image content blocks. */
  images?: unknown[] | null;
  /** Who originated this submission (Submission.source). */
  source?: "interactive" | "rpc" | "extension" | "bus" | "timer" | "webhook" | "voice" | "agent";
  /** WHO submitted — an extension name, 'human', a channel id. */
  submitter?: string;
  /** Caller-assigned correlation id for this submission (uuid4 recommended). */
  submission_id?: string;
  /** Concurrency policy against an in-flight turn. Defaults to 'reject'. 'fork' is a recognized value but currently REJECTED at submission time (-32602, phase-2 review S3) — its events reach no channel this handler forwards; see docs/REMOTE-CONTROL.md §3 Tier C open_lane. */
  multitask_strategy?: "reject" | "enqueue" | "steer" | "rollback" | "fork";
  /** Whether a leading '/' is command-dispatched. Defaults to False. */
  expand_commands?: boolean;
  /** Whether `@file` references in `text` are resolved into <attachment>/<reference> blocks before the Submission is built, the way the TUI's editor does (docs/FILE-ATTACHMENTS.md §2). Defaults to False, which sends `@notes.txt` to the model as those eleven literal characters. NOT a Submission field: expansion happens HERE, so what is persisted and what the model saw are the same string. Attached images are appended to `images`. Files are read at this moment, not when the host composed the text. See the `attachments` key on the result for what expansion did. */
  expand_attachments?: boolean;
  /** Whether this submission's turn may open a blocking dialog. */
  allow_user_input?: boolean;
  /** Whether this turn is persisted to the session log. Defaults to True. */
  store_history?: boolean;
  /** Folds into store_history=False; NOT otherwise implemented — AgentSession.submit() raises NotImplementedError if True. */
  silent?: boolean;
  /** Free-form origin detail (bus subject, cron id, HTTP request id). */
  correlation?: Record<string, unknown>;
  /** Self-submission depth floor; submit() may raise it further. */
  depth?: number;
};
export type PromptResult = {
  /** Always true here — a rejected submission is an RPCError, not this shape. */
  accepted: boolean;
  /** Echoes the request's submission_id (caller-supplied, or a minted uuid4 for prompt). */
  submission_id: string;
  /** Always null on this success shape; a real rejection is SUBMISSION_REJECTED instead. */
  rejection_reason: null;
  /** Present ONLY when this acceptance is also the submission's only completion: a core (extension-registered) slash command resolved synchronously with no turn started, so there is no later agent_end to carry it. {name, output} — `name` is the command that ran, which an input hook may have rewritten. Only an extension-registered command reaches this shape; a built-in resolves to a step, a ready flow or a view, each of which this wire refuses with COMMAND_NOT_SUPPORTED. Absent for an ordinary turn — poll get_messages / watch for agent_end instead. */
  command?: Record<string, unknown>;
  /** Present ONLY when this submission resolved to a VIEW command — /tree or /extensions. {name, state, unavailable_because}: `name` is the view asked for, `state` is what a head draws it from, and `unavailable_because` is a sentence saying why no state rides along. Exactly one of the last two is non-null, never both and never neither. τ projects no view state yet (docs/VSCODE-HEAD.md §6), so today every one of these carries the reason; a host with its own browser opens it from its own reads, and a host without one prints the reason. This is a SUCCESS response, not the COMMAND_NOT_SUPPORTED a view used to raise: the wire says what was asked for and what it can supply, and the payload lands in `state` when there is one, with no shape change for a host. */
  view?: Record<string, unknown>;
  /** Present exactly when the request set expand_attachments: true — absent is 'expansion did not run', which is a different statement from 'expansion found nothing'. {expanded: int, images: int, unresolved: [str], failures: [str]}. `unresolved` names the @words that matched no file and were therefore left in the text as prose. `failures` names the ones that resolved but could not be sent, each with the reason; the model is told the same thing through a <reference error="…"> block, so neither side is left believing an attachment landed when it did not. A host that shows neither list turns a visible failure back into a silent one. */
  attachments?: Record<string, unknown>;
  [key: string]: unknown;
};

/**
 * `reload_extension` (tier C, since 0.9.8).
 *
 * AgentSession.reload_extension(), projected. Tears the current instance down, RE-IMPORTS the
 * file from disk as a new module object — so edits on disk take effect — and re-registers it
 * against a fresh bucket. The one verb of the three that can hit a hard failure: a file that
 * no longer imports RAISES out of the action and reaches the host as INTERNAL_ERROR, with the
 * extension left torn down. That is Fail-Early and deliberate — an ok=false there would report
 * a no-op for a session whose extension is now gone. Same argument shape as enable/disable,
 * different risk, which is why it is a third verb and not a mode of one of them. D-1: guarded
 * by turn_safety_guard. An extension's hooks fire inside the turn, and its tools are resolved
 * from the registry this action rewrites, so running it mid-turn would change the tool table
 * under a loop that had already read it — TURN_STILL_RUNNING rather than that race. D-7 rule
 * 2: appends NOTHING, so no require_durable_session; extension state is runtime state and is
 * never written to the session log, which is also why it does not survive a respawn and a host
 * that wants an extension loaded at startup passes it on the command line. E5 rule 1: the
 * completion carries `cursor` anyway. `path` accepts a full managed path or a unique file stem
 * (AgentSession.resolve_extension_target); an ambiguous stem resolves to nothing and comes
 * back as ok=false, never a guess.
 */
export type ReloadExtensionParams = {
  /** The managed extension to re-import — a `path` from list_managed_extensions, or a unique file stem. */
  path: string;
};
export type ReloadExtensionResult = {
  /** Which action ran — echoes the verb. */
  action: "enable" | "disable" | "reload" | "configure";
  /** The managed path the action resolved to. NOT always what was sent: `path` accepts a file stem as well as a full path, and this is the full path it matched. On a failed resolution it is the unresolved string, so a host can quote back what it asked for. */
  path: string;
  /** Whether the action changed anything. false is a reportable no-op, never an error: an unknown target, an already-enabled extension, an already-disabled one. A hard failure — a file that no longer imports, which only reload can hit — RAISES instead and reaches the host as INTERNAL_ERROR, with the extension left torn down. */
  ok: boolean;
  /** The human-readable line, the same one the TUI listing shows. */
  message: string;
  /** session_log.cursor — E5 rule 1 on a mutator whose whole product is runtime state. It is the live tip reported as a READ, not a claim that this call wrote anything; the same reading set_auto_compaction's cursor already has. */
  cursor: string | null;
  [key: string]: unknown;
};

/**
 * `set_auto_compaction` (tier B, since tier-b).
 *
 * D-4: a plain, idempotent setter — `AgentSession.set_auto_compaction`, which this verb calls
 * rather than writing the field itself. It used to write
 * `session._compaction_settings.enabled` directly, on the ground that no accessor existed
 * (§1's ground truth) and that `get_tools` set the precedent with `session._tools`. Both
 * reaches are gone: the method exists, the TUI and the CLI can call it too, and this verb is
 * no longer the only door onto it. D-1: takes turn_safety_guard before mutating, so this never
 * races a turn's own read of the same settings object; TURN_STILL_RUNNING on a bounded
 * timeout, same as set_model/compact/set_session_name. E5, answered the one way the whole tier
 * answers it (see commands.py 'E5 in Tier B'): this response carries `cursor`, and for this
 * verb it is ALWAYS the unchanged tip — the mutation is an in-memory CompactionSettings field,
 * not a log entry. It is returned rather than omitted because a missing key is not a way to
 * say 'nothing moved': that would be the tip-inference F3 forbids, and it would make one tier
 * answer E5 two ways. D-7, the same one-way answer for durability (commands.py 'DURABILITY in
 * Tier B', rule 2): this verb appends NOTHING, so it takes no require_durable_session and
 * answers on an unpersisted session — where compact/set_model/set_session_name all refuse
 * (rule 1), because those three do append. Read the `cursor` above accordingly: on any session
 * it is the live tip, never a claim that this call wrote something. No policy guard (§1.2):
 * CompactionPolicy is constructed in exactly one place, sdk.py:865, which rpc_mode.py never
 * goes through — no RPC session ever carries one for this verb to protect. Why a host has to
 * ask at all: rpc_mode.py -> backends.create_backend -> TauBackend constructs its session with
 * CompactionSettings(enabled=False) (backends.py:885, §1.1) and nothing else in RPC mode flips
 * it. KNOWN GAP, stated not hidden (D-4): enabling this can cause `_maybe_auto_compact`
 * (agent_session.py:3286-3291) to fire on the NEXT turn, and that method emits its own
 * `agent_start`/`agent_end` pair through `self._events.emit` directly, not `_emit_stamped` —
 * so that pair carries NO `submission_id`. A host correlating events to the `submission_id` a
 * prior `submit`/`prompt` returned will see an ORPHAN agent_start/agent_end it cannot
 * attribute to any request it made. The `agent_end` DOES carry a `cursor` (the handler stamps
 * every outbound `agent_end` at DEQUEUE, in `prepare_outbound` / `_stamp_agent_end_cursor`,
 * regardless of provenance), so a host obeying F3 (never cache 'the tip') stays correct across
 * a compaction it did not explicitly ask for, even though it cannot explain WHY its context
 * just shrank from submission_id alone. SECOND KNOWN GAP, the other face of D-7 rule 2:
 * enabling this on an UNPERSISTED session arms a mechanism that then appends `compaction`
 * entries to a log that dies with the process — from inside `_maybe_auto_compact`, a code path
 * with no RPC verb on it and so nothing for rule 1 to guard. Same class as the
 * AgentSession-internal gap compact's notes record about turn_lock: this tier guards the wire,
 * not AgentSession. An auto-compaction is also NOT reachable by `abort` for the same reason —
 * there is no background task the RPC layer owns to cancel (finding 5).
 */
export type SetAutoCompactionParams = {
  /** Desired auto-compaction state. RPC sessions are constructed with CompactionSettings(enabled=False) (backends.py:885, RPC-TIER-B.md §1.1), so a host that wants it on says so here; AgentSession.set_auto_compaction is the same setter in process. */
  enabled: boolean;
};
export type SetAutoCompactionResult = {
  /** The effective state after this call (D-4: 'a plain, idempotent setter ... returns the effective state') — what AgentSession.set_auto_compaction returns, read back off the settings rather than echoed from the request. */
  enabled: boolean;
  /** session_log.cursor after this call (E5, rule 1 of 'E5 in Tier B' above). ALWAYS the unchanged tip: this verb mutates an in-memory CompactionSettings and appends no log entry, so there is nothing here that could move it. Returned rather than omitted because absence is not a signal (rule 3) — a host reads the same field from every mutator and never has to infer the tip from a missing key (F3). */
  cursor: string | null;
  [key: string]: unknown;
};

/**
 * `set_extension_config` (tier C, since 0.9.8).
 *
 * AgentSession.set_extension_config(), projected. Replaces the slice wholesale — not a merge —
 * after checking every value against the declared schema, then reloads the extension, because
 * api.config is captured when the extension's API is bound and a slice written without a
 * reload would be read by nobody. An undeclared key, a missing declared field, or a value
 * whose type does not match its field's kind reaches the host as INVALID_PARAMS; so does an
 * extension that declares no schema, since there is then no contract to check against.
 * `values` is why this row's params are hand-written: its keys are whatever THIS extension
 * declared, which is not sayable in the Argument vocabulary — the same reason `submit` carries
 * arguments=None. Applies for this session only: the core does not own ~/.tau/config.json, so
 * persisting is head-local. D-1: guarded by turn_safety_guard. An extension's hooks fire
 * inside the turn, and its tools are resolved from the registry this action rewrites, so
 * running it mid-turn would change the tool table under a loop that had already read it —
 * TURN_STILL_RUNNING rather than that race. D-7 rule 2: appends NOTHING, so no
 * require_durable_session; extension state is runtime state and is never written to the
 * session log, which is also why it does not survive a respawn and a host that wants an
 * extension loaded at startup passes it on the command line. E5 rule 1: the completion carries
 * `cursor` anyway. `path` accepts a full managed path or a unique file stem
 * (AgentSession.resolve_extension_target); an ambiguous stem resolves to nothing and comes
 * back as ok=false, never a guess.
 */
export type SetExtensionConfigParams = {
  /** The managed extension to configure — a `path` from list_managed_extensions, or a unique file stem. */
  path: string;
  /** The complete new slice, keyed by the field names get_extension_config's `schema` declares. Every declared field must be present: missing is not empty, and nothing is filled in for you. */
  values: Record<string, unknown>;
  [key: string]: unknown;
};
export type SetExtensionConfigResult = {
  /** Which action ran — echoes the verb. */
  action: "enable" | "disable" | "reload" | "configure";
  /** The managed path the action resolved to. NOT always what was sent: `path` accepts a file stem as well as a full path, and this is the full path it matched. On a failed resolution it is the unresolved string, so a host can quote back what it asked for. */
  path: string;
  /** Whether the action changed anything. false is a reportable no-op, never an error: an unknown target, an already-enabled extension, an already-disabled one. A hard failure — a file that no longer imports, which only reload can hit — RAISES instead and reaches the host as INTERNAL_ERROR, with the extension left torn down. */
  ok: boolean;
  /** The human-readable line, the same one the TUI listing shows. */
  message: string;
  /** session_log.cursor — E5 rule 1 on a mutator whose whole product is runtime state. It is the live tip reported as a READ, not a claim that this call wrote anything; the same reading set_auto_compaction's cursor already has. */
  cursor: string | null;
  [key: string]: unknown;
};

/**
 * `set_model` (tier B, since tier-b).
 *
 * D-2: switches the active model by NAME (AgentSession.set_model, agent_session.py:785 —
 * effective on the NEXT turn, never mid-stream) and, unlike the bare session method, PERSISTS
 * the switch: appends a model_change entry and returns the resulting cursor (E5, answered the
 * one way the whole tier answers it — see commands.py 'E5 in Tier B': every Tier B mutator's
 * completion carries `cursor`, present even when the call moved nothing; only the tier's reads
 * omit it. Here the append always moves it, so it is that entry's own id). D-1: guarded by
 * turn_safety_guard, so this refuses with TURN_STILL_RUNNING rather than racing an in-flight
 * turn's own AgentLoop, which reads self._model when it rebuilds each turn. Refuses: an
 * unknown `name` is a CALLER error, not a runtime failure — the bound resolver's
 * KeyError/ValueError (both are AgentSession.set_model's own documented shapes for 'no such
 * name') is converted to INVALID_PARAMS, the same classification switch_session already gives
 * an unresolvable session_id: a value the schema cannot check syntactically, refused before
 * anything is touched. The resolver's own message (it is the component that knows which names
 * exist) reaches the host verbatim, unwrapped from KeyError.__str__'s repr quotes rather than
 * paraphrased — see _resolver_error_message. An UNPERSISTED session (new_session
 * {persist:false}) is refused too, before anything is touched — require_durable_session,
 * Blocker 2 of the Tier B review — because a cursor returned for an append that lands only in
 * memory is a durability promise this verb cannot keep; SESSION_NOT_PERSISTED, which is also
 * what a log declaring no durable location at all gets (the SDK's InMemorySessionLog). A log
 * MISSING append_model_change entirely is the different, blunter failure it always was —
 * require_log_appender, §1.1, RuntimeError -> INTERNAL_ERROR — because that is a store wired
 * wrong, not a session the host can move off. That refusal is D-7 rule 1, stated once for the
 * whole tier in commands.py's 'DURABILITY in Tier B' block: a verb that APPENDS refuses an
 * unpersisted session — this one, set_session_name, and (since finding 6) compact, which used
 * to run there and report a cursor for an entry that died with the process. Both checks run
 * BEFORE session.set_model(name), so a refusal leaves the in-process model unswitched: this
 * verb never reports 'maybe switched, definitely not persisted'. Known gap (D-2, stated not
 * hidden): the append happens HERE, in the RPC verb, not inside AgentSession.set_model itself
 * — widening that method is out of this phase's scope, since it is also the TUI's own call
 * path — so a TUI model switch still does NOT persist a model_change entry; only a switch made
 * through this RPC verb does. WHERE the entry lands, and for how long (unit S): a --mode rpc
 * process defaults to storing its sessions under a private <tmp>/.tau-<uid>/sessions, NOT the
 * user's ~/.tau/sessions — one 0-message session per spawn would otherwise take over `tau -c`
 * for whoever is working in the same directory. Most systems clear the temp dir on reboot, so
 * this cursor's durability is bounded by MACHINE UPTIME, not forever: a replay can find the
 * entry for the life of the session, and a host that needs more must be started with
 * --session-dir DIR (accepted under --mode rpc precisely so a host can choose, including
 * --session-dir ~/.tau/sessions).
 */
export type SetModelParams = {
  /** A config model NAME (a key in ~/.tau/config.json's 'models' map), resolved through AgentSession's bound model resolver (set_model_resolver) — the same name --model NAME accepts headlessly. NOT a model id; a config key may alias one. */
  name: string;
};
export type SetModelResult = {
  /** AgentSession.get_model() after the switch: {id, provider, context_window}. */
  model: Record<string, unknown>;
  /** session_log.cursor immediately after the model_change entry this call appended (E5) — that entry's own id, since the append is the last write this handler makes. */
  cursor: string | null;
  [key: string]: unknown;
};

/**
 * `set_session_name` (tier B, since tier-b).
 *
 * D-1 (mutating): takes turn_safety_guard before writing. Calls AgentSession.set_session_name,
 * which is extension_types.apply_session_name — the SAME body ExtensionAPI.set_session_name
 * calls (docs/RPC-TIER-B.md B5: 'do not reinvent it and do not copy-paste it'), which itself
 * performs §1.1's raise ('the bound log must have append_session_info, else raise') — so this
 * handler does NOT also call require_log_appender: that would check the identical fact twice.
 * require_log_appender (B0) is for a verb with no pre-existing extension-API body to reuse,
 * e.g. set_model. It DOES take require_durable_session first (Blocker 2, Tier B review), which
 * asks a different question — not 'does the log have the appender' (every real session does)
 * but 'will the entry outlive this process': an unpersisted session (new_session
 * {persist:false}) is refused rather than handed a cursor for a rename nobody will ever read
 * back. That is D-7 rule 1, which commands.py's 'DURABILITY in Tier B' block now states once
 * for the whole tier — this verb appends, so it refuses; `compact` appends too and, since
 * finding 6, gives the same answer instead of a third one. E5, answered the one way the whole
 * tier answers it (see commands.py 'E5 in Tier B'): this response carries the resulting
 * `cursor`, as every Tier B mutator's completion does, present even when the call moved
 * nothing — here the append always moves it. An empty name is INVALID_PARAMS (validate_params
 * has no minLength — see the params schema's own note); an unpersisted session, or a log
 * declaring no durable location (e.g. the SDK's InMemorySessionLog), is SESSION_NOT_PERSISTED
 * — round-3 finding 4 of the Tier B review moved it off INTERNAL_ERROR, which the generated
 * reference defines as 'the handler raised something it did not raise on purpose' and which
 * this refusal is the opposite of. A log MISSING append_session_info altogether still surfaces
 * as INTERNAL_ERROR (require_log_appender): a store wired wrong is not a session the host can
 * move off. Nothing is mutated before either check. This verb was RPC's only door onto
 * append_session_info until AgentSession.set_session_name existed; a head now reaches the same
 * body without a wire. WHERE the rename lands, and for how long (unit S): a --mode rpc process
 * defaults to storing its sessions under a private <tmp>/.tau-<uid>/sessions, NOT the user's
 * ~/.tau/sessions — so a name set here does not show up in that user's TUI picker unless the
 * host was started with --session-dir (accepted under --mode rpc precisely so a host can
 * choose, including --session-dir ~/.tau/sessions). Most systems clear the temp dir on reboot,
 * so this cursor's durability is bounded by MACHINE UPTIME, not forever.
 */
export type SetSessionNameParams = {
  /** The session's new durable display name. Must be non-empty. */
  name: string;
};
export type SetSessionNameResult = {
  /** The name just persisted (echoes params.name). */
  name: string;
  /** The resulting session_log.cursor (E5/F3 — every mutating response returns the resulting cursor). */
  cursor: string | null;
  [key: string]: unknown;
};

/**
 * `submit` (tier C, since 2A).
 *
 * The provenance differentiator (REMOTE-CONTROL.md §3 Tier C): the full quad
 * (source/submitter/submission_id/correlation) is required on the wire, and every AgentEvent
 * the resulting turn emits is stamped with it. Dual completion (C3): this response only
 * acknowledges admission.
 */
export type SubmitParams = {
  /** The prompt text. */
  text: string;
  /** Optional list of image content blocks. */
  images?: unknown[] | null;
  /** Who originated this submission (Submission.source). */
  source: "interactive" | "rpc" | "extension" | "bus" | "timer" | "webhook" | "voice" | "agent";
  /** WHO submitted — an extension name, 'human', a channel id. */
  submitter: string;
  /** Caller-assigned correlation id for this submission (uuid4 recommended). */
  submission_id: string;
  /** Concurrency policy against an in-flight turn. Defaults to 'reject'. 'fork' is a recognized value but currently REJECTED at submission time (-32602, phase-2 review S3) — its events reach no channel this handler forwards; see docs/REMOTE-CONTROL.md §3 Tier C open_lane. */
  multitask_strategy?: "reject" | "enqueue" | "steer" | "rollback" | "fork";
  /** Whether a leading '/' is command-dispatched. Defaults to False. */
  expand_commands?: boolean;
  /** Whether `@file` references in `text` are resolved into <attachment>/<reference> blocks before the Submission is built, the way the TUI's editor does (docs/FILE-ATTACHMENTS.md §2). Defaults to False, which sends `@notes.txt` to the model as those eleven literal characters. NOT a Submission field: expansion happens HERE, so what is persisted and what the model saw are the same string. Attached images are appended to `images`. Files are read at this moment, not when the host composed the text. See the `attachments` key on the result for what expansion did. */
  expand_attachments?: boolean;
  /** Whether this submission's turn may open a blocking dialog. */
  allow_user_input?: boolean;
  /** Whether this turn is persisted to the session log. Defaults to True. */
  store_history?: boolean;
  /** Folds into store_history=False; NOT otherwise implemented — AgentSession.submit() raises NotImplementedError if True. */
  silent?: boolean;
  /** Free-form origin detail (bus subject, cron id, HTTP request id). */
  correlation?: Record<string, unknown>;
  /** Self-submission depth floor; submit() may raise it further. */
  depth?: number;
};
export type SubmitResult = {
  /** Always true here — a rejected submission is an RPCError, not this shape. */
  accepted: boolean;
  /** Echoes the request's submission_id (caller-supplied, or a minted uuid4 for prompt). */
  submission_id: string;
  /** Always null on this success shape; a real rejection is SUBMISSION_REJECTED instead. */
  rejection_reason: null;
  /** Present ONLY when this acceptance is also the submission's only completion: a core (extension-registered) slash command resolved synchronously with no turn started, so there is no later agent_end to carry it. {name, output} — `name` is the command that ran, which an input hook may have rewritten. Only an extension-registered command reaches this shape; a built-in resolves to a step, a ready flow or a view, each of which this wire refuses with COMMAND_NOT_SUPPORTED. Absent for an ordinary turn — poll get_messages / watch for agent_end instead. */
  command?: Record<string, unknown>;
  /** Present ONLY when this submission resolved to a VIEW command — /tree or /extensions. {name, state, unavailable_because}: `name` is the view asked for, `state` is what a head draws it from, and `unavailable_because` is a sentence saying why no state rides along. Exactly one of the last two is non-null, never both and never neither. τ projects no view state yet (docs/VSCODE-HEAD.md §6), so today every one of these carries the reason; a host with its own browser opens it from its own reads, and a host without one prints the reason. This is a SUCCESS response, not the COMMAND_NOT_SUPPORTED a view used to raise: the wire says what was asked for and what it can supply, and the payload lands in `state` when there is one, with no shape change for a host. */
  view?: Record<string, unknown>;
  /** Present exactly when the request set expand_attachments: true — absent is 'expansion did not run', which is a different statement from 'expansion found nothing'. {expanded: int, images: int, unresolved: [str], failures: [str]}. `unresolved` names the @words that matched no file and were therefore left in the text as prose. `failures` names the ones that resolved but could not be sent, each with the reason; the model is told the same thing through a <reference error="…"> block, so neither side is left believing an attachment landed when it did not. A host that shows neither list turns a visible failure back into a silent one. */
  attachments?: Record<string, unknown>;
  [key: string]: unknown;
};

/**
 * `summarize_and_navigate` (tier C, since 0.9.8).
 *
 * AgentSession.summarize_and_navigate(), projected. The summarizing arm of navigate, and a
 * SEPARATE verb rather than a flag on it for the reason the core splits them: this one makes a
 * completion call, so it costs tokens and takes wall time that `navigate` does not. A host
 * offering both should say so in what it offers. The summarizer's tokens are banked to the
 * session's side ledger (AgentSession.record_side_usage) and are NOT itemised in this response
 * — stated, not hidden: there is no verb on this wire that reports side_usage, so a host
 * tracking spend sees them only in aggregate. A summarizer that returns nothing usable RAISES
 * (session_manager.summarize_branch) and reaches the host as INTERNAL_ERROR — it is a runtime
 * failure, not a bad argument, and it is never fabricated into an empty summary. D-1: guarded
 * by turn_safety_guard, so this refuses with TURN_STILL_RUNNING rather than re-shaping the
 * path an in-flight turn is being run against. D-7 rule 1: it APPENDS, so
 * require_durable_session refuses an unpersisted session (SESSION_NOT_PERSISTED) before
 * anything is touched — a tree edit that dies with the process leaves a host holding a
 * conversation it can never load again. E5 rule 1: the completion carries the resulting
 * `cursor`. Refuses: every caller error tau_agent_core.tree_ops raises — an unknown id above
 * all — comes back as INVALID_PARAMS, checked before the first append, so a refusal leaves the
 * log byte-identical. WHERE the entries land and for how long is set_model's own note: a
 * --mode rpc child defaults to a private <tmp>/.tau-<uid>/sessions, so durability is bounded
 * by machine uptime unless the host passed --session-dir DIR.
 */
export type SummarizeAndNavigateParams = {
  /** The branch point. The subtree BELOW it is what gets summarized, and the branch_summary entry is parented at it. */
  target_id: string;
  /** Extra guidance for the summarizer's SYSTEM prompt. Omitted runs the default summarizer prompt. */
  custom_instructions?: string;
};
export type SummarizeAndNavigateResult = {
  /** ConversationTree.context_for(cursor) after the mutation — the same flat message array get_messages returns, for the path this call just produced. Returned rather than left for a follow-up get_messages because the mutation's whole product is a different context, and a host that had to fetch it separately could render the old one in between. */
  messages: unknown[];
  /** session_log.cursor after the mutation (E5 rule 1). */
  cursor: string | null;
  [key: string]: unknown;
};

/**
 * `switch_session` (tier A, since phase-3).
 *
 * H1: loads a different, already-addressable session (resolved by id or unique id prefix —
 * SWITCH_SESSION_PARAMS_SCHEMA; list_sessions is where those ids come from, finding 8, and its
 * rows are exactly what this verb resolves against) and moves this connection onto it. Same
 * {cancelled} veto contract as new_session (H2); an unresolvable session_id raises
 * INVALID_PARAMS instead — a bad id is a caller mistake the schema cannot catch syntactically,
 * not a veto. E5: the result carries the LOADED session's cursor. Same TURN_STILL_RUNNING
 * failure mode as new_session (Finding 1) — checked after resolution, so a bad id still fails
 * INVALID_PARAMS even with an in-flight turn.
 */
export type SwitchSessionParams = {
  /** An exact session id, or a unique id prefix, scoped to this process's cwd — the same resolution --session REF uses headlessly (SessionCatalog.resolve_ref). Every acceptable value is a `session_id` list_sessions returned (finding 8): resolve_ref is built on the same list(cwd) that verb publishes, so the two cannot disagree. */
  session_id: string;
};
export type SwitchSessionResult = {
  /** True if a session_before_switch extension hook vetoed (H2). When true, `session`/`cursor` are absent — nothing was touched. An in-flight turn that did not stop in time is a DIFFERENT outcome and never reaches this shape — see TURN_STILL_RUNNING. */
  cancelled: boolean;
  /** F2's session tuple: {store, session_id, lane, cursor, addressable}. `lane` is always 'primary' in v1 (lanes are Tier C, not this phase). Present only when cancelled is false. `addressable` (finding 7 of the Tier B review) is the field that says whether `session_id` is a value ANOTHER call can use: true means list_sessions returns this id and switch_session resolves it; false means this session exists in memory only — it is `new_session {"persist": false}`'s product, switch_session answers -32602 for it, list_sessions never shows it, and the verbs D-7 rule 1 governs (set_model/set_session_name/compact) refuse on it. `store` names the store THIS CONNECTION's catalog is on, which is not a claim that this session is in it: when addressable is false, nothing was written to that store. */
  session?: Record<string, unknown>;
  /** The resulting session_log.cursor, duplicated at top level (E5/F3 — every mutating response returns the resulting cursor). Present only when cancelled is false. */
  cursor?: string | null;
  [key: string]: unknown;
};

/** Every verb on the wire, mapped to its params and result. */
export interface Commands {
  abort: { params: AbortParams; result: AbortResult };
  answer_request: { params: AnswerRequestParams; result: AnswerRequestResult };
  commit_branch: { params: CommitBranchParams; result: CommitBranchResult };
  compact: { params: CompactParams; result: CompactResult };
  complete_message_id: { params: CompleteMessageIdParams; result: CompleteMessageIdResult };
  complete_path: { params: CompletePathParams; result: CompletePathResult };
  disable_extension: { params: DisableExtensionParams; result: DisableExtensionResult };
  elide_span: { params: ElideSpanParams; result: ElideSpanResult };
  enable_extension: { params: EnableExtensionParams; result: EnableExtensionResult };
  enumerate_domain: { params: EnumerateDomainParams; result: EnumerateDomainResult };
  fork: { params: ForkParams; result: ForkResult };
  get_capabilities: { params: GetCapabilitiesParams; result: GetCapabilitiesResult };
  get_commands: { params: GetCommandsParams; result: GetCommandsResult };
  get_entry: { params: GetEntryParams; result: GetEntryResult };
  get_extension_config: { params: GetExtensionConfigParams; result: GetExtensionConfigResult };
  get_extension_state: { params: GetExtensionStateParams; result: GetExtensionStateResult };
  get_last_assistant_text: { params: GetLastAssistantTextParams; result: GetLastAssistantTextResult };
  get_messages: { params: GetMessagesParams; result: GetMessagesResult };
  get_models: { params: GetModelsParams; result: GetModelsResult };
  get_pending_request: { params: GetPendingRequestParams; result: GetPendingRequestResult };
  get_session_name: { params: GetSessionNameParams; result: GetSessionNameResult };
  get_session_stats: { params: GetSessionStatsParams; result: GetSessionStatsResult };
  get_state: { params: GetStateParams; result: GetStateResult };
  get_tools: { params: GetToolsParams; result: GetToolsResult };
  get_tree: { params: GetTreeParams; result: GetTreeResult };
  list_managed_extensions: { params: ListManagedExtensionsParams; result: ListManagedExtensionsResult };
  list_sessions: { params: ListSessionsParams; result: ListSessionsResult };
  navigate: { params: NavigateParams; result: NavigateResult };
  new_session: { params: NewSessionParams; result: NewSessionResult };
  next_step: { params: NextStepParams; result: NextStepResult };
  paste_subtree: { params: PasteSubtreeParams; result: PasteSubtreeResult };
  prompt: { params: PromptParams; result: PromptResult };
  reload_extension: { params: ReloadExtensionParams; result: ReloadExtensionResult };
  set_auto_compaction: { params: SetAutoCompactionParams; result: SetAutoCompactionResult };
  set_extension_config: { params: SetExtensionConfigParams; result: SetExtensionConfigResult };
  set_model: { params: SetModelParams; result: SetModelResult };
  set_session_name: { params: SetSessionNameParams; result: SetSessionNameResult };
  submit: { params: SubmitParams; result: SubmitResult };
  summarize_and_navigate: { params: SummarizeAndNavigateParams; result: SummarizeAndNavigateResult };
  switch_session: { params: SwitchSessionParams; result: SwitchSessionResult };
}

export type CommandName = keyof Commands;
export type CommandParams<M extends CommandName> = Commands[M]["params"];
export type CommandResult<M extends CommandName> = Commands[M]["result"];

/** The tier each verb belongs to, for a host that surfaces the distinction. */
export const COMMAND_TIERS: Readonly<Record<CommandName, "A" | "B" | "C">> = {
  abort: "A",
  answer_request: "C",
  commit_branch: "C",
  compact: "B",
  complete_message_id: "C",
  complete_path: "B",
  disable_extension: "C",
  elide_span: "C",
  enable_extension: "C",
  enumerate_domain: "C",
  fork: "A",
  get_capabilities: "A",
  get_commands: "A",
  get_entry: "C",
  get_extension_config: "C",
  get_extension_state: "C",
  get_last_assistant_text: "B",
  get_messages: "A",
  get_models: "B",
  get_pending_request: "C",
  get_session_name: "B",
  get_session_stats: "B",
  get_state: "A",
  get_tools: "A",
  get_tree: "C",
  list_managed_extensions: "C",
  list_sessions: "B",
  navigate: "C",
  new_session: "A",
  next_step: "C",
  paste_subtree: "C",
  prompt: "A",
  reload_extension: "C",
  set_auto_compaction: "B",
  set_extension_config: "C",
  set_model: "B",
  set_session_name: "B",
  submit: "C",
  summarize_and_navigate: "C",
  switch_session: "A",
};

/**
 * The full `get_capabilities` result, exactly as the wire declares it.
 *
 * Some of its array fields are typed (e.g. `commands` items in command
 * schemas have `items`), but the top-level `commands` and `declined`
 * arrays remain `unknown[]` because they are bare arrays on the wire.
 * Element shapes for the typed arrays come from the generator now.
 */
export type Capabilities = GetCapabilitiesResult;
