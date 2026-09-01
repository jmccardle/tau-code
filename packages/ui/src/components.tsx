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
import { loadCommands, performCommand, PERFORMABLE, type CommandResult } from './commands.js';
import {
  describe,
  useSubmitter,
  type AttachmentReport,
  type ConnectionPhase,
} from './useTau.js';

/* ------------------------------------------------------------------ blocks */

function Block({ block }: { block: ContentBlock }): JSX.Element | null {
  switch (block.type) {
    case 'text':
      return <div className="tau-text">{block.text}</div>;
    case 'thinking':
      return (
        <details className="tau-thinking">
          <summary>Reasoning</summary>
          <div className="tau-text">{block.thinking}</div>
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
            <Block key={i} block={block} />
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
          {state.live.map((block, i) =>
            block.kind === 'thinking' ? (
              <details key={i} className="tau-thinking" open>
                <summary>Reasoning</summary>
                <div className="tau-text">{block.text}</div>
              </details>
            ) : (
              <div key={i} className="tau-text">
                {block.text}
              </div>
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
  const area = useRef<HTMLTextAreaElement>(null);
  // Every path lookup is a round trip, and a stale one must not overwrite a
  // newer answer. The counter is the only thing that makes the popup's contents
  // correspond to the cursor as it is NOW rather than as it was two keystrokes
  // ago.
  const lookup = useRef(0);

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

    const command = completeCommand(baseText, commands, PERFORMABLE);
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

    // A frontend command never reaches `submit`: tau would refuse it with
    // COMMAND_NOT_SUPPORTED, correctly, because the wire has no screen. This
    // head performs the ones it can and says why for the rest.
    const span = commandSpan(trimmed);
    const named = commands.find((c) => c.name === span?.token && c.performer === 'frontend');
    if (span && named && onCommand) {
      const args = trimmed.slice(span.end).trim();
      const outcome = await onCommand(named.name, args);
      if (outcome.notice !== '') setNotice(outcome.notice);
      if (outcome.kind === 'performed') setText('');
      return;
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

/* ---------------------------------------------------------- session picker */

export interface SessionPickerProps {
  client: TauClient | null;
  conversation: Conversation | null;
  currentSessionId: string | null;
  running: boolean;
  onClose(): void;
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
          Close
        </button>
      </div>

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
          No sessions in this working directory yet. The one you are in is created when it is
          first written to.
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
  model?: string | null;
  onToggleSessions?: () => void;
  sessionsOpen?: boolean;
}

export function StatusBar({
  phase,
  detail,
  state,
  model,
  onToggleSessions,
  sessionsOpen,
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
      {model ? <span className="tau-status-model">{model}</span> : null}
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
  const [model, setModel] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [commands, setCommands] = useState<CommandInfo[]>([]);

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
      return performCommand(name, args, {
        client,
        fork: () => conversation.fork(),
        openSessions: () => setSessionsOpen(true),
      });
    },
    [client, conversation],
  );

  useEffect(() => {
    if (!client || phase !== 'ready') return;
    let cancelled = false;
    client
      .call('get_state', {})
      .then((result) => {
        if (cancelled) return;
        const record = result.model as Record<string, unknown> | null;
        setModel(record && typeof record['id'] === 'string' ? record['id'] : null);
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
        model={model}
        sessionsOpen={sessionsOpen}
        {...(phase === 'ready' ? { onToggleSessions: () => setSessionsOpen((open) => !open) } : {})}
      />
      <Disconnected phase={phase} detail={detail} {...(disconnectedHint ? { hint: disconnectedHint } : {})} />
      {sessionsOpen ? (
        <SessionPicker
          client={client}
          conversation={conversation ?? null}
          currentSessionId={sessionId}
          running={state.running}
          onClose={() => setSessionsOpen(false)}
        />
      ) : null}
      <Transcript state={state} />
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
        {...(enterSubmits === undefined ? {} : { enterSubmits })}
      />
    </div>
  );
}
