import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TauClient } from '@tau-code/protocol';
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
import { describe, useSubmitter, type ConnectionPhase } from './useTau.js';

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

/* --------------------------------------------------------------- composer */

export interface ComposerProps {
  client: TauClient | null;
  running: boolean;
  /** Enter sends. Set false for the tau TUI's convention (Ctrl+Enter sends). */
  enterSubmits?: boolean;
}

export function Composer({ client, running, enterSubmits = true }: ComposerProps): JSX.Element {
  const [text, setText] = useState('');
  const { submit, abort, error } = useSubmitter(client);
  const area = useRef<HTMLTextAreaElement>(null);

  const send = async (): Promise<void> => {
    const trimmed = text.trim();
    if (trimmed === '' || !client) return;
    // Clear only after tau accepts, so a rejected prompt is not lost. Fail
    // Early applies to the editor too: never discard the user's text on a
    // failure they can retry.
    await submit(trimmed);
    setText('');
    area.current?.focus();
  };

  return (
    <div className="tau-composer">
      {error ? <div className="tau-notice tau-warn">{error}</div> : null}
      <textarea
        ref={area}
        className="tau-input"
        rows={3}
        value={text}
        placeholder={running ? 'A turn is running…' : 'Ask tau something'}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
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
      </div>
    </div>
  );
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
}

/** The whole chat head: status, session picker, transcript, composer. */
export function Chat({
  client,
  conversation,
  phase,
  detail,
  state,
  enterSubmits,
}: ChatProps): JSX.Element {
  const [model, setModel] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionsOpen, setSessionsOpen] = useState(false);

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
        client={client}
        running={state.running}
        {...(enterSubmits === undefined ? {} : { enterSubmits })}
      />
    </div>
  );
}
