import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { commandsOf, type Capabilities, type TauClient } from '@ffwf/tau-code-protocol';
import type { Conversation, ConversationState, LiveToolCall } from './conversation.js';
import { blocksToText, readEntries, type ContentBlock, type Entry } from './messages.js';
import {
  formatWhen,
  readScope,
  readSessionRows,
  sessionLabel,
  storeDirectory,
  type SessionRow,
  type SessionScope,
} from './sessions.js';
import {
  applyCandidate,
  commandSpan,
  completeCommand,
  completePath,
  nextIndex,
  type CommandInfo,
  type Completions,
} from './completion.js';
import {
  activeNames,
  modelLabel,
  readActiveModel,
  readModelRows,
  type ActiveModel,
  type ModelRow,
} from './models.js';
import { loadCommands, performCommand, VIEWS, type CommandResult } from './commands.js';
import { loadPendingRequest, type ExtensionRequest } from './requests.js';
import { RequestPanel } from './request-panel.js';
import { TreePanel } from './tree-panel.js';
import type { FlowStep } from './flows.js';
import { FlowDialog } from './flow-dialog.js';
import { ExtensionPanel } from './extension-panel.js';
import { LiveMarkdown, Markdown } from './markdown.js';
import {
  describe,
  useSubmitter,
  type AttachmentReport,
  type ConnectionPhase,
} from './useTau.js';

/* ------------------------------------------------------------------ blocks */

/**
 * One content block.
 *
 * `markdown` is a per-ROLE decision, not a global setting. The model writes
 * Markdown and means it. The user wrote characters into a textarea and meant
 * those: rendering their message as Markdown would eat the `*` in a filename
 * and hide the `<attachment>` block that says what was actually sent, which
 * would make the transcript disagree with the wire. Tool output is neither --
 * it is a program's stdout, and `tau-pre` already renders it as one.
 */
function Block({ block, markdown = false }: { block: ContentBlock; markdown?: boolean }): JSX.Element | null {
  switch (block.type) {
    case 'text':
      return markdown ? <Markdown text={block.text} /> : <div className="tau-text">{block.text}</div>;
    case 'thinking':
      return (
        <details className="tau-thinking">
          <summary>Reasoning</summary>
          {markdown ? (
            <Markdown text={block.thinking} />
          ) : (
            <div className="tau-text">{block.thinking}</div>
          )}
        </details>
      );
    case 'image':
      return (
        <img
          className="tau-image"
          src={`data:${block.mime_type};base64,${block.data}`}
          alt="attachment"
        />
      );
    case 'toolCall':
      return (
        <details className="tau-toolcall">
          <summary>
            <span className="tau-tool-name">{block.name}</span>
            <span className="tau-tool-args-preview">{previewArgs(block.arguments)}</span>
          </summary>
          <pre className="tau-pre">{JSON.stringify(block.arguments, null, 2)}</pre>
        </details>
      );
  }
}

function previewArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    const rendered = typeof value === 'string' ? value : JSON.stringify(value);
    parts.push(`${key}=${truncate(rendered ?? '', 60)}`);
    if (parts.join(' ').length > 90) break;
  }
  return parts.join(' ');
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/* ---------------------------------------------------------------- entries */

function EntryView({ entry }: { entry: Entry }): JSX.Element {
  switch (entry.kind) {
    case 'user':
      return (
        <div className="tau-entry tau-entry-user">
          <div className="tau-role">You</div>
          {entry.blocks.map((block, i) => (
            <Block key={i} block={block} />
          ))}
        </div>
      );
    case 'assistant':
      return (
        <div className="tau-entry tau-entry-assistant">
          <div className="tau-role">Agent</div>
          {entry.blocks.map((block, i) => (
            <Block key={i} block={block} markdown />
          ))}
        </div>
      );
    case 'toolResult':
      return (
        <details className={`tau-entry tau-entry-result${entry.isError ? ' tau-error' : ''}`}>
          <summary>
            <span className="tau-tool-name">{entry.toolName}</span>
            <span className="tau-tool-args-preview">
              {entry.isError ? 'failed' : truncate(blocksToText(entry.blocks).split('\n')[0] ?? '', 80)}
            </span>
          </summary>
          {entry.blocks.map((block, i) => (
            <Block key={i} block={block} />
          ))}
          {entry.details ? <pre className="tau-pre">{JSON.stringify(entry.details, null, 2)}</pre> : null}
        </details>
      );
    case 'system':
      return (
        <details className="tau-entry tau-entry-system">
          <summary>System prompt</summary>
          <div className="tau-text">{entry.text}</div>
        </details>
      );
    case 'unknown':
      // Rendered, not skipped. A message this client cannot read is a fact the
      // reader should see, rather than a silent hole in the transcript.
      return (
        <div className="tau-entry tau-entry-unknown">
          <div className="tau-role">Unreadable message</div>
          <pre className="tau-pre">{JSON.stringify(entry.raw, null, 2)}</pre>
        </div>
      );
  }
}

/* ------------------------------------------------------------------- live */

function LiveTool({ call }: { call: LiveToolCall }): JSX.Element {
  const label =
    call.status === 'running'
      ? 'running…'
      : call.status === 'blocked'
        ? `blocked by ${call.blockedBy ?? 'an extension'}`
        : call.status === 'error'
          ? 'failed'
          : 'done';
  return (
    <div className={`tau-live-tool tau-status-${call.status}`}>
      <span className="tau-tool-name">{call.name}</span>
      <span className="tau-tool-args-preview">{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------- transcript */

export interface TranscriptProps {
  state: ConversationState;
}

/**
 * The transcript.
 *
 * Autoscroll follows the tail ONLY while the reader is already at the bottom.
 * The TUI learned this the hard way (TUI-STEERING.md section 1): a transcript
 * that always scrolls to the tail makes reading history during a turn
 * impossible, because every token drags the view away.
 */
export function Transcript({ state }: TranscriptProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const atTail = useRef(true);

  const onScroll = (): void => {
    const node = ref.current;
    if (!node) return;
    atTail.current = node.scrollHeight - node.scrollTop - node.clientHeight < 40;
  };

  useLayoutEffect(() => {
    const node = ref.current;
    if (node && atTail.current) node.scrollTop = node.scrollHeight;
  });

  const entries = readEntries(state.messages);

  return (
    <div className="tau-transcript" ref={ref} onScroll={onScroll}>
      {entries.map((entry, i) => (
        <EntryView key={i} entry={entry} />
      ))}

      {state.live.length > 0 || state.liveTools.length > 0 ? (
        <div className="tau-entry tau-entry-assistant tau-live">
          <div className="tau-role">Agent</div>
          {/* Markdown while it streams, not only once the turn ends. A half
              written fence renders as a code block that grows, which is what
              the reader expects; switching renderer at `agent_end` would
              reflow the whole answer at the moment it finished. `LiveMarkdown`
              rather than `Markdown` because a growing message defeats the memo
              -- see the measurements in markdown.tsx. */}
          {state.live.map((block, i) =>
            block.kind === 'thinking' ? (
              <details key={i} className="tau-thinking" open>
                <summary>Reasoning</summary>
                <LiveMarkdown text={block.text} />
              </details>
            ) : (
              <LiveMarkdown key={i} text={block.text} />
            ),
          )}
          {state.liveTools.map((call) => (
            <LiveTool key={call.toolCallId} call={call} />
          ))}
        </div>
      ) : null}

      {state.endReason === 'max_turns' || state.endReason === 'repeat_tool_calls' ? (
        <div className="tau-notice tau-warn">
          The answer is truncated, not finished: the loop stopped because of{' '}
          <code>{state.endReason}</code>.
        </div>
      ) : null}
      {state.error ? <div className="tau-notice tau-warn">The agent loop raised: {state.error}</div> : null}
      {state.notice ? <div className="tau-notice">{state.notice}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ popup */

function CompletionPopup({
  completions,
  selected,
  onPick,
}: {
  completions: Completions;
  selected: number;
  onPick(index: number): void;
}): JSX.Element {
  const sigil = completions.kind === 'command' ? '/' : '@';

  if (completions.candidates.length === 0) {
    // Empty is INFORMATION, not an absence of it, and the two kinds mean
    // different things. An unknown slash is sent to the model as prose --
    // deliberate in tau, and until this line existed, completely invisible.
    return (
      <div className="tau-popup tau-popup-empty">
        {completions.kind === 'command'
          ? `No command called /${completions.token}. This will be sent to the model as ordinary text.`
          : `Nothing here matches @${completions.token}.`}
      </div>
    );
  }

  return (
    <div className="tau-popup">
      <ul className="tau-popup-list">
        {completions.candidates.map((candidate, index) => (
          <li key={candidate.value}>
            <button
              type="button"
              className={[
                'tau-popup-row',
                index === selected ? 'tau-popup-selected' : '',
                candidate.available ? '' : 'tau-popup-unavailable',
              ]
                .filter(Boolean)
                .join(' ')}
              // The mouse must not steal focus from the textarea: the whole
              // point of the popup is that the editor keeps what will be sent.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onPick(index)}
            >
              <span className="tau-popup-value">
                {sigil}
                {candidate.value}
              </span>
              <span className="tau-popup-detail">
                {candidate.available ? candidate.detail : 'not available in this head'}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {completions.total > completions.candidates.length ? (
        <div className="tau-popup-more">
          showing {completions.candidates.length} of {completions.total}
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- composer */

export interface ComposerProps {
  client: TauClient | null;
  running: boolean;
  /** Enter sends. Set false for the tau TUI's convention (Ctrl+Enter sends). */
  enterSubmits?: boolean;
  /** `get_commands`, for the `/` popup. Empty until the connection is ready. */
  commands?: CommandInfo[];
  /**
   * False when the connected tau predates protocol 1.4, which has no
   * `complete_path`. The composer then says `@` completion is unavailable
   * rather than offering a popup that would error.
   */
  pathCompletion?: boolean;
  /** Perform a frontend command. Absent means none can be performed. */
  onCommand?: (name: string, args: string) => Promise<CommandResult>;
  /**
   * The connection phase, used for the placeholder alone -- what the composer
   * can DO is decided by `client` being null. The two are separate because
   * "waiting" and "gone" are both unusable and need different words.
   */
  phase?: ConnectionPhase;
  /**
   * Text to put in the editor, from somewhere other than the keyboard.
   *
   * The tree browser's "ask this differently" is the one producer: it moves the
   * cursor to a user message's parent and hands the message back here to be
   * edited. Sent as a prop rather than as an imperative handle so the editor
   * stays the one owner of what is in it.
   */
  draft?: string | null;
  /** Called once `draft` has been taken, so the same text is not re-applied. */
  onDraftTaken?: () => void;
  /**
   * Called when tau refuses a submission.
   *
   * An extension lock is one of the causes, and the refusal is the first moment
   * this head can know one arrived: a lock is appended by a hook mid-turn and
   * nothing on the event stream announces it. The caller re-reads
   * `get_pending_request` so the panel opens instead of leaving the reader with
   * a sentence about a form they cannot see.
   */
  onRefused?: () => void;
}

/**
 * The editor.
 *
 * Tab is the only completion key, which is a decision and not a shortage. Escape
 * closes, Enter sends and the arrows move the cursor -- all spent before this
 * feature existed. So repeated Tab cycles the candidates and writes each one
 * straight into the text, which means the editor always holds exactly what will
 * be sent. There is no mode to be in and no state to get out of.
 */
export function Composer({
  client,
  running,
  enterSubmits = true,
  commands = [],
  pathCompletion = true,
  onCommand,
  phase = 'ready',
  draft = null,
  onDraftTaken,
  onRefused,
}: ComposerProps): JSX.Element {
  const [text, setText] = useState('');
  /**
   * The open popup, plus the text the span was measured against.
   *
   * `baseText` is not redundant. Every Tab REWRITES the editor, so after the
   * first one the live text no longer contains the word the span describes.
   * Applying the next candidate to the live text inserts it at an offset that
   * moved -- measured, before this field existed: cycling `/compact` then
   * Shift+Tab produced `/compact tree `. Each candidate is applied to the text
   * as it stood when the popup opened, which is what makes cycling reversible.
   */
  const [open, setOpen] = useState<{ completions: Completions; baseText: string } | null>(null);
  const [selected, setSelected] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const { submit, abort, error } = useSubmitter(client);
  useEffect(() => {
    if (error !== null) onRefused?.();
  }, [error, onRefused]);
  const area = useRef<HTMLTextAreaElement>(null);
  // Every path lookup is a round trip, and a stale one must not overwrite a
  // newer answer. The counter is the only thing that makes the popup's contents
  // correspond to the cursor as it is NOW rather than as it was two keystrokes
  // ago.
  const lookup = useRef(0);

  // A draft REPLACES what is typed, because it arrives from a gesture the reader
  // just made in another panel -- appending would leave them editing two
  // messages at once.
  useEffect(() => {
    if (draft === null) return;
    setText(draft);
    onDraftTaken?.();
    requestAnimationFrame(() => area.current?.focus());
  }, [draft, onDraftTaken]);

  const completions = open?.completions ?? null;

  const dismiss = (): void => {
    setOpen(null);
    setSelected(0);
  };

  const write = (next: string, cursor: number): void => {
    setText(next);
    // React re-renders before the DOM value is what we just set, so the
    // selection has to be applied after the paint or it lands on stale text.
    requestAnimationFrame(() => {
      const node = area.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(cursor, cursor);
    });
  };

  /** Put candidate `index` into the editor, measured against `baseText`. */
  const apply = (found: Completions, baseText: string, index: number): void => {
    const candidate = found.candidates[index];
    if (!candidate) return;
    setSelected(index);
    const applied = applyCandidate(baseText, found, candidate);
    write(applied.text, applied.cursor);
    if (found.kind === 'path' && candidate.value.endsWith('/')) {
      // Descending: the level below is a different listing, so re-ask against
      // the text that now ends in the directory.
      void openCompletions(applied.text, applied.cursor);
    }
  };

  /**
   * Open the popup and apply its FIRST candidate.
   *
   * Applying immediately is what makes Tab one key rather than two. There is no
   * "accept" step, so the editor always holds what will be sent, and the reader
   * never has to remember whether the highlighted row is committed.
   */
  const openCompletions = async (source?: string, at?: number): Promise<void> => {
    const node = area.current;
    if (!node || !client) return;
    const baseText = source ?? text;
    const cursor = at ?? node.selectionStart;

    // Nothing is greyed today: this head performs both of tau's views, drives
    // every flow through `next_step`, and sends the rest through `submit`. The
    // set stays a parameter rather than becoming an empty literal, because the
    // day tau declares a third view this head has no panel for, that name has to
    // be able to appear greyed rather than falsely offered.
    const command = completeCommand(baseText, commands, unavailableCommands(commands));
    if (command !== null) {
      setOpen({ completions: command, baseText });
      setSelected(0);
      if (command.candidates.length > 0) apply(command, baseText, 0);
      return;
    }

    if (!pathCompletion) {
      // Said, not silently skipped. A Tab that does nothing reads as a bug.
      setNotice('This tau is older than protocol 1.4, which is where @ completion lives.');
      return;
    }

    const ticket = (lookup.current += 1);
    try {
      const paths = await completePath(client, baseText, cursor);
      if (ticket !== lookup.current) return;
      if (paths === null) {
        dismiss();
        return;
      }
      setOpen({ completions: paths, baseText });
      setSelected(0);
      if (paths.candidates.length > 0) apply(paths, baseText, 0);
    } catch (raw) {
      if (ticket !== lookup.current) return;
      setNotice(describe(raw));
    }
  };

  const cycle = (backwards: boolean): void => {
    if (!open || open.completions.candidates.length === 0) return;
    apply(
      open.completions,
      open.baseText,
      nextIndex(selected, open.completions.candidates.length, backwards),
    );
  };

  const send = async (): Promise<void> => {
    const trimmed = text.trim();
    if (trimmed === '' || !client) return;
    dismiss();
    setNotice(null);

    // Every `/word` tau knows is dispatched HERE, not through `submit`. A
    // built-in flow sent with `expand_commands` earns a COMMAND_NOT_SUPPORTED,
    // correctly -- the wire has no screen to render a step on -- so this head
    // steps it itself and calls the mutation the step names. A word tau does not
    // know comes back as `prose` and falls through to the model, which is what
    // tau would have done with it anyway.
    const span = commandSpan(trimmed);
    const named = commands.find((c) => c.name === span?.token);
    if (span && named && onCommand) {
      const args = trimmed.slice(span.end).trim();
      const outcome = await onCommand(named.name, args);
      if (outcome.kind !== 'prose') {
        if (outcome.kind !== 'cancelled' && outcome.notice !== '') setNotice(outcome.notice);
        if (outcome.kind === 'performed') setText('');
        return;
      }
    }

    // Clear only after tau accepts, so a rejected prompt is not lost. Fail
    // Early applies to the editor too: never discard the user's text on a
    // failure they can retry.
    const report = await submit(trimmed);
    setText('');
    setNotice(attachmentNotice(report));
    area.current?.focus();
  };

  return (
    <div className="tau-composer">
      {error ? <div className="tau-notice tau-warn">{error}</div> : null}
      {notice ? <div className="tau-notice">{notice}</div> : null}
      {completions ? (
        <CompletionPopup
          completions={completions}
          selected={selected}
          onPick={(index) => {
            if (!open) return;
            apply(open.completions, open.baseText, index);
            dismiss();
          }}
        />
      ) : null}
      <textarea
        ref={area}
        className="tau-input"
        rows={3}
        value={text}
        placeholder={
          // A composer inviting a question it cannot send is the same defect
          // one level down: it looks ready and is not. Waiting and gone are
          // told apart, because only one of them has a message above to read.
          client === null
            ? phase === 'connecting'
              ? 'Connecting to tau…'
              : 'No agent is connected — see the message above.'
            : running
              ? 'A turn is running…'
              : 'Ask tau something — / for commands, @ for files'
        }
        onChange={(event) => {
          setText(event.target.value);
          // Typing invalidates whatever the popup was describing. It reopens on
          // the next Tab, against the text as it is then.
          dismiss();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Tab') {
            event.preventDefault();
            if (completions && completions.candidates.length > 0) cycle(event.shiftKey);
            else void openCompletions();
            return;
          }
          if (event.key === 'Escape' && completions) {
            event.preventDefault();
            dismiss();
            return;
          }
          const sends = enterSubmits ? !event.shiftKey : event.ctrlKey || event.metaKey;
          if (event.key === 'Enter' && sends) {
            event.preventDefault();
            void send();
          }
        }}
      />
      <div className="tau-composer-row">
        <button className="tau-button" onClick={() => void send()} disabled={!client || text.trim() === ''}>
          Send
        </button>
        <button className="tau-button tau-button-quiet" onClick={() => void abort()} disabled={!running}>
          Stop
        </button>
        <span className="tau-composer-hint">Tab completes</span>
      </div>
    </div>
  );
}

/**
 * What to say about an expansion, or nothing.
 *
 * Silence when every reference resolved: a line saying "1 file attached" after
 * every message is noise, and the attachment is visible in the transcript
 * anyway. The two failure kinds are NOT silent, for the opposite reason.
 */
function attachmentNotice(report: AttachmentReport | null): string | null {
  if (!report) return null;
  const parts: string[] = [];
  if (report.unresolved.length > 0) {
    parts.push(
      `Not a file, so sent as ordinary text: ${report.unresolved.map((t) => `@${t}`).join(', ')}.`,
    );
  }
  for (const failure of report.failures) parts.push(`Attachment failed: ${failure}`);
  return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * The commands this head cannot perform, for greying in the popup.
 *
 * A VIEW is the only kind that can be missing: a flow reaches its mutation over
 * the wire, and an extension command goes through `submit`. This head has a
 * panel for both of tau's views, so the set is empty today -- and it is computed
 * rather than written as `new Set()` so that a third view, declared by a later
 * tau, appears greyed instead of falsely offered.
 */
function unavailableCommands(commands: CommandInfo[]): ReadonlySet<string> {
  const missing = new Set<string>();
  for (const command of commands) {
    if (command.origin !== 'builtin' || command.flow) continue;
    if (!VIEWS.has(command.name)) missing.add(command.name);
  }
  return missing;
}

/* ---------------------------------------------------------- session picker */

/**
 * Has anyone said anything in this session?
 *
 * A user message, specifically. A fresh session is not empty on the wire: it
 * carries the system prompt, and tau's own store adds a `model_change` entry
 * before a word is typed. Counting messages would call that a conversation.
 */
function hasUserMessage(messages: unknown[]): boolean {
  return readEntries(messages).some((entry) => entry.kind === 'user');
}

export interface SessionPickerProps {
  client: TauClient | null;
  conversation: Conversation | null;
  currentSessionId: string | null;
  running: boolean;
  onClose(): void;
  /**
   * Why the picker is open, when the reader did not open it.
   *
   * A panel that lands on a list nobody asked for reads as a lost transcript.
   * One sentence is the difference between that and an offer.
   */
  reason?: string;
  /** The word on the close button. "Close" when the reader opened this. */
  closeLabel?: string;
}

/**
 * Switch, start, and fork sessions.
 *
 * `list_sessions` is scoped to this process's working directory, because
 * `switch_session` could not reach anything else. The scope line says so rather
 * than leaving the reader to wonder where the rest of their sessions went.
 *
 * The store directory is shown for the same reason. `--mode rpc` defaults to a
 * private `<tmp>/.tau-<uid>/sessions` and the TUI to `~/.tau/sessions`, so two
 * identical-looking lists can be two different universes. That is a fact about
 * the setup, and it is displayed rather than assumed.
 */
export function SessionPicker({
  client,
  conversation,
  currentSessionId,
  running,
  onClose,
  reason,
  closeLabel = 'Close',
}: SessionPickerProps): JSX.Element {
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [scope, setScope] = useState<SessionScope>({ store: null, cwd: null });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!client) return;
    setError(null);
    try {
      const result = await client.call('list_sessions', {});
      setRows(readSessionRows(result.sessions ?? []));
      setScope(readScope(result.scope));
    } catch (raw) {
      setError(describe(raw));
      setRows([]);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (what: () => Promise<boolean>): Promise<void> => {
    if (!conversation) return;
    setBusy(true);
    setError(null);
    try {
      if (await what()) onClose();
      else await load();
    } catch (raw) {
      setError(describe(raw));
    } finally {
      setBusy(false);
    }
  };

  const storeDir = rows?.map((r) => storeDirectory(r.ref)).find((d) => d !== null) ?? null;

  return (
    <div className="tau-sessions">
      <div className="tau-sessions-head">
        <strong>Sessions</strong>
        <button className="tau-button tau-button-quiet" onClick={onClose}>
          {closeLabel}
        </button>
      </div>

      {reason ? <div className="tau-sessions-reason">{reason}</div> : null}

      <div className="tau-sessions-scope">
        {scope.cwd ? (
          <div>
            Working directory: <code>{scope.cwd}</code>
          </div>
        ) : null}
        {storeDir ? (
          <div>
            Store: <code>{storeDir}</code>
          </div>
        ) : null}
      </div>

      <div className="tau-composer-row">
        <button
          className="tau-button"
          disabled={busy || running || !conversation}
          onClick={() => void act(() => conversation!.newSession())}
        >
          New session
        </button>
        <button
          className="tau-button tau-button-quiet"
          disabled={busy || running || !conversation}
          onClick={() => void act(() => conversation!.fork())}
        >
          Fork this one
        </button>
        <button className="tau-button tau-button-quiet" disabled={busy} onClick={() => void load()}>
          Reload
        </button>
      </div>

      {running ? (
        <div className="tau-notice tau-warn">
          A turn is running. Switching sessions has to stop it first, so those actions wait.
        </div>
      ) : null}
      {error ? <div className="tau-notice tau-warn">{error}</div> : null}

      {rows === null ? (
        <div className="tau-notice">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="tau-notice">
          No sessions in this working directory yet. tau writes this one to the store as soon
          as the agent starts, so it appears here after the next reload whether or not you
          send anything.
        </div>
      ) : (
        <ul className="tau-session-list">
          {rows.map((row) => {
            const current = row.sessionId === currentSessionId;
            return (
              <li key={row.sessionId}>
                <button
                  className={`tau-session-row${current ? ' tau-session-current' : ''}`}
                  disabled={busy || running || current || !conversation}
                  onClick={() => void act(() => conversation!.switchTo(row.sessionId))}
                  title={row.ref ?? row.sessionId}
                >
                  <span className="tau-session-title">{sessionLabel(row)}</span>
                  <span className="tau-session-meta">
                    {current ? 'current · ' : ''}
                    {row.messageCount !== null ? `${row.messageCount} msg · ` : ''}
                    {formatWhen(row.modified)}
                    {row.parent ? ' · forked' : ''}
                  </span>
                  {/* tau lists a session it could not read and says why. Hiding
                      that row would undo the reporting it did on purpose. */}
                  {row.error ? <span className="tau-session-error">unreadable: {row.error}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- model picker */

export interface ModelPickerProps {
  client: TauClient | null;
  /** What `get_state` says is running, or null when that read failed. */
  active: ActiveModel | null;
  running: boolean;
  onClose: () => void;
  /**
   * The model `set_model` installed. Its result is the projection tau publishes
   * after the switch, so it is taken as authoritative and nothing re-reads
   * `get_state` to confirm it.
   */
  onSwitched: (active: ActiveModel) => void;
}

/**
 * Switch the model this session uses.
 *
 * The list is tau's, not this head's: `get_models` resolves every config name
 * through the same component `set_model` itself calls, so what is offered here
 * is what a switch would actually install. This client reads no config file.
 *
 * **No capability gate.** `@` completion checks the peer's command list before
 * offering anything, because it has to decide before the reader types and a
 * silently wrong completion is invisible. Here the reader clicks and gets an
 * answer, so a tau without `get_models` produces one visible sentence from
 * `describe` rather than a control that quietly is not there.
 *
 * Switching is refused while a turn runs -- tau's own guard, and the rows say
 * so rather than failing on the click. A switch that lands takes effect on the
 * next turn; tau never changes model mid-stream.
 */
export function ModelPicker({
  client,
  active,
  running,
  onClose,
  onSwitched,
}: ModelPickerProps): JSX.Element {
  const [rows, setRows] = useState<ModelRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!client) return;
    setError(null);
    try {
      const result = await client.call('get_models', {});
      setRows(readModelRows(result.models ?? []));
    } catch (raw) {
      setError(describe(raw));
      setRows([]);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const choose = async (name: string): Promise<void> => {
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      const result = await client.call('set_model', { name });
      const installed = readActiveModel(result.model);
      // A switch tau reported without a model projection is a switch this head
      // cannot describe. Say so instead of leaving the old name on the bar.
      if (!installed) {
        setError('tau switched the model but did not say to what. Reload to read the current one.');
        return;
      }
      onSwitched(installed);
      onClose();
    } catch (raw) {
      setError(describe(raw));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModelPanel
      rows={rows}
      active={active}
      running={running}
      busy={busy || !client}
      error={error}
      onClose={onClose}
      onReload={() => void load()}
      onChoose={(name) => void choose(name)}
    />
  );
}

export interface ModelPanelProps {
  /** The list, or null while `get_models` has not answered yet. */
  rows: ModelRow[] | null;
  active: ActiveModel | null;
  running: boolean;
  /** A call is in flight, or there is no client to make one with. */
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onReload: () => void;
  onChoose: (name: string) => void;
}

/**
 * What the model picker looks like. Everything, and no calls.
 *
 * Split from `ModelPicker` so the markup can be rendered from a fixture. The
 * interesting states -- a name that matches nothing, two names that match the
 * same model -- are reachable only after an async load, and a panel whose
 * appearance can only be checked by clicking through it is a panel nothing
 * checks.
 */
export function ModelPanel({
  rows,
  active,
  running,
  busy,
  error,
  onClose,
  onReload,
  onChoose,
}: ModelPanelProps): JSX.Element {
  const names = rows ? activeNames(rows, active) : [];
  const label = modelLabel(active);

  return (
    <div className="tau-sessions">
      <div className="tau-sessions-head">
        <strong>Model</strong>
        <button className="tau-button tau-button-quiet" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="tau-sessions-scope">
        {label ? (
          <div>
            Running: <code>{label}</code>
          </div>
        ) : (
          <div>tau did not report a running model.</div>
        )}
      </div>

      {/* The three cases are three different facts, and only the first one lets
          a row be marked. See `activeNames` for why guessing is not on. */}
      {rows !== null && rows.length > 0 && names.length === 0 ? (
        <div className="tau-sessions-reason">
          The running model has no entry in tau&apos;s config, so it was set at startup rather
          than chosen from this list. Switching away from it is one way: nothing below can
          bring it back.
        </div>
      ) : null}
      {names.length > 1 ? (
        <div className="tau-sessions-reason">
          {names.length} names resolve to the running model. Which of them is active is not
          something tau reports, so all of them are marked.
        </div>
      ) : null}

      <div className="tau-composer-row">
        <button className="tau-button tau-button-quiet" disabled={busy} onClick={onReload}>
          Reload
        </button>
      </div>

      {running ? (
        <div className="tau-notice tau-warn">
          A turn is running. tau will not change model mid-stream, so switching waits.
        </div>
      ) : null}
      {error ? <div className="tau-notice tau-warn">{error}</div> : null}

      {rows === null ? (
        <div className="tau-notice">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="tau-notice">
          tau&apos;s config declares no models to switch between. They live in the
          <code> models </code> map of <code>~/.tau/config.json</code>.
        </div>
      ) : (
        <ul className="tau-session-list">
          {rows.map((row) => {
            const current = names.includes(row.name);
            return (
              <li key={row.name}>
                <button
                  className={`tau-session-row${current ? ' tau-session-current' : ''}`}
                  disabled={busy || running || current}
                  onClick={() => onChoose(row.name)}
                  title={`set_model ${row.name}`}
                >
                  <span className="tau-session-title">{row.name}</span>
                  <span className="tau-session-meta">
                    {current ? 'active · ' : ''}
                    {/* The id is what the name RESOLVED to, and it is often a
                        different string. Showing both is the point. */}
                    {row.provider ? `${row.provider}/` : ''}
                    {row.id ?? '(tau reported no id)'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- disconnected */

export interface DisconnectedProps {
  phase: ConnectionPhase;
  /** The reason, as a whole sentence, from whoever knows it. */
  detail: string | null;
  /**
   * One host-specific line about where to look next -- the command palette
   * entry in VS Code, a server log in the browser. Optional, and supplied by
   * the host: this component is shared, so it must not name one.
   */
  hint?: string;
}

/**
 * Why there is no agent, said where the reader is looking.
 *
 * The status bar has room for one word and a fragment. That was enough while
 * the only failures were connection-shaped, and it stopped being enough the
 * first time a start was REFUSED for a reason the reader could act on -- no
 * folder open, a `tau-code.binary` naming nothing. Those need a sentence, and
 * a sentence needs a block.
 *
 * `detail` is shown verbatim and never summarised. The summary is what the
 * status bar already is, and the whole defect this fixes was a summary standing
 * in for a reason.
 */
export function Disconnected({ phase, detail, hint }: DisconnectedProps): JSX.Element | null {
  if (phase === 'ready' || phase === 'connecting') return null;
  return (
    <div className="tau-disconnected" role="alert">
      <div className="tau-disconnected-head">
        {phase === 'failed' ? 'No agent is running.' : 'The agent stopped.'}
      </div>
      <div className="tau-disconnected-why">
        {detail ??
          'No reason was reported, which is itself a fault — nothing should fail without saying why.'}
      </div>
      {hint ? <div className="tau-disconnected-hint">{hint}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------- statusbar */

export interface StatusBarProps {
  phase: ConnectionPhase;
  detail: string | null;
  state: ConversationState;
  /** The running model's id. Not its config name: the two differ, often. */
  model?: string | null;
  onToggleSessions?: () => void;
  sessionsOpen?: boolean;
  onToggleModels?: () => void;
  modelsOpen?: boolean;
  onToggleTree?: () => void;
  treeOpen?: boolean;
}

export function StatusBar({
  phase,
  detail,
  state,
  model,
  onToggleSessions,
  sessionsOpen,
  onToggleModels,
  modelsOpen,
  onToggleTree,
  treeOpen,
}: StatusBarProps): JSX.Element {
  const label =
    phase === 'ready'
      ? state.running
        ? `running${state.turnIndex !== null ? ` · turn ${state.turnIndex}` : ''}`
        : 'idle'
      : phase;
  return (
    <div className={`tau-status tau-status-${phase}`}>
      <span className="tau-status-dot" />
      <span>{label}</span>
      {detail ? <span className="tau-status-detail">{detail}</span> : null}
      <span className="tau-status-spacer" />
      {/* The label is the model ID, because that is what tau reports as
          running and the config NAME cannot be derived from it. When the read
          failed there is still a control, named rather than valued: an empty
          space would be a picker the reader cannot find. */}
      {onToggleModels ? (
        <button
          className="tau-status-button tau-status-model"
          onClick={onToggleModels}
          aria-pressed={modelsOpen === true}
          title="Switch the model this session uses"
        >
          {model ?? 'Model'}
        </button>
      ) : model ? (
        <span className="tau-status-model">{model}</span>
      ) : null}
      {onToggleTree ? (
        <button
          className="tau-status-button"
          onClick={onToggleTree}
          aria-pressed={treeOpen === true}
          title="Browse and edit the conversation tree"
        >
          Tree
        </button>
      ) : null}
      {onToggleSessions ? (
        <button
          className="tau-status-button"
          onClick={onToggleSessions}
          aria-pressed={sessionsOpen === true}
          title="Switch, start, or fork a session"
        >
          Sessions
        </button>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- chat app */

export interface ChatProps {
  client: TauClient | null;
  conversation?: Conversation | null;
  phase: ConnectionPhase;
  detail: string | null;
  state: ConversationState;
  enterSubmits?: boolean;
  /**
   * The connected tau's capability document. Used for ONE decision: whether
   * `complete_path` is on this peer's command list, which is how `@` completion
   * finds out it is talking to a pre-1.4 tau without calling and failing.
   */
  capabilities?: Capabilities | null;
  /**
   * Where to look when there is no agent. Host-specific, so the host supplies
   * it: this component runs in a browser tab and in an editor panel, and only
   * one of those has a command palette.
   */
  disconnectedHint?: string;
}

/** The whole chat head: status, session picker, transcript, composer. */
export function Chat({
  client,
  conversation,
  phase,
  detail,
  state,
  enterSubmits,
  capabilities,
  disconnectedHint,
}: ChatProps): JSX.Element {
  const [model, setModel] = useState<ActiveModel | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  // Two panels, one slot. Both push the transcript down, and opening the second
  // over the first would leave the reader with two lists and one status bar.
  const [modelsOpen, setModelsOpen] = useState(false);
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const [treeOpen, setTreeOpen] = useState(false);
  const [extensionsOpen, setExtensionsOpen] = useState(false);
  const [revised, setRevised] = useState<string | null>(null);
  /**
   * The extension request at the cursor, and whether it has been set aside.
   *
   * A lock is a TREE NODE, not a modal: it survives the process and refuses
   * every prompt until it is answered. Re-read at every cursor move -- after a
   * turn, after a command, after a session change -- because that is the only
   * place it can appear or vanish.
   */
  const [request, setRequest] = useState<ExtensionRequest | null>(null);
  const [requestDismissed, setRequestDismissed] = useState<string | null>(null);
  /** Bumped by anything that could have made a request appear. */
  const [requestPoll, setRequestPoll] = useState(0);
  /** The flow step waiting for an answer, and the promise it will settle. */
  const [flowStep, setFlowStep] = useState<{
    step: FlowStep;
    settle: (value: unknown | null) => void;
  } | null>(null);
  // True only while the picker is up because nothing was there to show. Clicking
  // `Sessions` later is a different thing and must not inherit the sentence.
  const [landed, setLanded] = useState(false);
  const decided = useRef(false);

  /**
   * Land on the session picker when this session has nothing in it.
   *
   * The agent is started when the panel opens, and tau writes the session to
   * the store at that moment rather than at the first message -- so a user who
   * opens the panel four times has four sessions, all empty, and the picker
   * fills with rows that are indistinguishable from each other. Opening the
   * panel is not the same act as starting a conversation, and this is what
   * separates them: an empty session shows the list it belongs to, so the
   * obvious next click is an existing conversation rather than a fifth blank
   * one.
   *
   * Decided ONCE, on the first pull. Re-deciding would reopen the picker every
   * time `new_session` empties the transcript, which is the one moment the
   * reader has already said what they want.
   */
  useEffect(() => {
    if (decided.current || phase !== 'ready' || !state.loaded) return;
    decided.current = true;
    if (hasUserMessage(state.messages)) return;
    setSessionsOpen(true);
    setLanded(true);
  }, [phase, state.loaded, state.messages]);

  // The vocabulary is per-session: an extension can register commands, and
  // switching sessions can load a different set. Re-read at every session
  // change rather than once at connect.
  useEffect(() => {
    if (!client || phase !== 'ready') return;
    let cancelled = false;
    loadCommands(client)
      .then((loaded) => {
        if (!cancelled) setCommands(loaded);
      })
      .catch(() => {
        // An empty vocabulary means the popup offers nothing, which is the
        // truthful rendering of "this head could not read the command list".
        // Every slash then falls through to the model as prose, exactly as an
        // unknown one already does.
        if (!cancelled) setCommands([]);
      });
    return () => {
      cancelled = true;
    };
  }, [client, phase, state.notice]);

  const pathCompletion =
    capabilities === undefined || capabilities === null
      ? true
      : commandsOf(capabilities).some((command) => command.name === 'complete_path');

  const onCommand = useCallback(
    async (name: string, args: string): Promise<CommandResult> => {
      if (!client || !conversation) {
        return { kind: 'refused', notice: 'Not connected.' };
      }
      return performCommand(name, args, commands, {
        client,
        refresh: () => conversation.refresh(),
        openSessions: () => setSessionsOpen(true),
        openTree: () => {
          setSessionsOpen(false);
          setModelsOpen(false);
          setTreeOpen(true);
        },
        openExtensions: () => {
          setSessionsOpen(false);
          setModelsOpen(false);
          setExtensionsOpen(true);
        },
        // One step at a time, and the promise is what the flow loop awaits. A
        // dialog rather than a second composer: two prompts must never coexist,
        // and the flow's question is not something to type into the chat box.
        askStep: (step) =>
          new Promise<unknown | null>((resolve) => {
            setFlowStep({
              step,
              settle: (value) => {
                setFlowStep(null);
                resolve(value);
              },
            });
          }),
      });
    },
    [client, conversation, commands],
  );

  // The cursor moved if a turn ended, a command ran, or the session changed.
  // Each of those is what `state.notice`/`state.cursor`/`state.running` report.
  useEffect(() => {
    if (!client || phase !== 'ready') return;
    let cancelled = false;
    loadPendingRequest(client)
      .then((found) => {
        if (!cancelled) setRequest(found);
      })
      .catch(() => {
        // An older tau has no such verb. A head that cannot ask has no request
        // to draw, which is the truthful rendering -- and the composer still
        // reports the refusal if one arrives.
        if (!cancelled) setRequest(null);
      });
    return () => {
      cancelled = true;
    };
  }, [client, phase, state.running, state.notice, state.cursor, requestPoll]);

  useEffect(() => {
    if (!client || phase !== 'ready') return;
    let cancelled = false;
    client
      .call('get_state', {})
      .then((result) => {
        if (cancelled) return;
        setModel(readActiveModel(result.model));
        setSessionId(typeof result.session_id === 'string' ? result.session_id : null);
      })
      .catch(() => {
        // The status bar shows no model rather than a wrong one. The
        // connection phase already reports whether the link is healthy.
      });
    return () => {
      cancelled = true;
    };
    // `notice` is in the deps because a session change sets it -- that is the
    // signal the session id may have moved under this component.
  }, [client, phase, state.running, state.notice]);

  return (
    <div className="tau-app">
      <StatusBar
        phase={phase}
        detail={detail}
        state={state}
        model={model?.id ?? null}
        sessionsOpen={sessionsOpen}
        modelsOpen={modelsOpen}
        treeOpen={treeOpen}
        {...(phase === 'ready'
          ? {
              onToggleSessions: () => {
                setModelsOpen(false);
                setSessionsOpen((open) => !open);
              },
              onToggleModels: () => {
                setSessionsOpen(false);
                setLanded(false);
                setModelsOpen((open) => !open);
              },
              onToggleTree: () => {
                setSessionsOpen(false);
                setModelsOpen(false);
                setLanded(false);
                setTreeOpen((open) => !open);
              },
            }
          : {})}
      />
      <Disconnected phase={phase} detail={detail} {...(disconnectedHint ? { hint: disconnectedHint } : {})} />
      {sessionsOpen ? (
        <SessionPicker
          client={client}
          conversation={conversation ?? null}
          currentSessionId={sessionId}
          running={state.running}
          onClose={() => {
            setSessionsOpen(false);
            setLanded(false);
          }}
          {...(landed
            ? {
                reason:
                  'This session is empty. Pick one to carry on with, or dismiss this and start typing here.',
                closeLabel: 'Start here',
              }
            : {})}
        />
      ) : null}
      {modelsOpen ? (
        <ModelPicker
          client={client}
          active={model}
          running={state.running}
          onClose={() => setModelsOpen(false)}
          onSwitched={setModel}
        />
      ) : null}
      {/* A lock refuses every prompt, so it goes ABOVE the transcript rather
          than below it: a reader who has to scroll to find out why their
          message bounced has been told nothing in time to act on. */}
      {request !== null && requestDismissed !== request.entryId ? (
        <RequestPanel
          client={client}
          request={request}
          onAnswered={async () => {
            setRequestDismissed(null);
            await conversation?.refresh();
          }}
          onDismiss={() => setRequestDismissed(request.entryId)}
        />
      ) : null}
      {treeOpen ? (
        <TreePanel
          client={client}
          running={state.running}
          onChanged={() => conversation?.refresh() ?? Promise.resolve()}
          onRevise={setRevised}
          onClose={() => setTreeOpen(false)}
        />
      ) : null}
      {extensionsOpen ? (
        <ExtensionPanel client={client} onClose={() => setExtensionsOpen(false)} />
      ) : null}
      {flowStep !== null ? (
        <FlowDialog
          client={client}
          step={flowStep.step}
          onSubmit={(value) => flowStep.settle(value)}
          onCancel={() => flowStep.settle(null)}
        />
      ) : null}
      <Transcript state={state} />
      {/* Both notices are tau's own readings, and both say something the
          transcript cannot: a completion cut off by the output cap reads
          exactly like one that finished, and a prompt cache that was never
          consulted is invisible except in the bill. */}
      {state.truncation ? (
        <div className="tau-notice tau-warn">
          The model hit its output cap, so that answer is a PREFIX and not a finished one
          {state.truncation.droppedToolCalls !== null
            ? `, and ${state.truncation.droppedToolCalls} tool call${
                state.truncation.droppedToolCalls === 1 ? '' : 's'
              } were dropped mid-argument`
            : ''}
          . Raise <code>max_tokens</code> for this model in <code>~/.tau/config.json</code>, or ask
          for less at a time.
        </div>
      ) : null}
      {state.cacheNotice ? <div className="tau-notice tau-warn">{state.cacheNotice}</div> : null}
      <Composer
        // Null once the phase leaves `ready`, which disables Send and changes
        // the placeholder. `useTauConnection` keeps the client object across a
        // close so the transcript survives, but every call it can make now
        // fails -- and a composer that invites a message it cannot deliver is
        // the same defect as a status bar that says `connecting` forever.
        client={phase === 'ready' ? client : null}
        phase={phase}
        running={state.running}
        commands={commands}
        pathCompletion={pathCompletion}
        onCommand={onCommand}
        draft={revised}
        onDraftTaken={() => setRevised(null)}
        onRefused={() => setRequestPoll((n) => n + 1)}
        {...(enterSubmits === undefined ? {} : { enterSubmits })}
      />
    </div>
  );
}
