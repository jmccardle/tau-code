import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TauClient } from '@tau-code/protocol';
import type { ConversationState, LiveToolCall } from './conversation.js';
import { blocksToText, readEntries, type ContentBlock, type Entry } from './messages.js';
import { useSubmitter, type ConnectionPhase } from './useTau.js';

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

/* -------------------------------------------------------------- statusbar */

export interface StatusBarProps {
  phase: ConnectionPhase;
  detail: string | null;
  state: ConversationState;
  model?: string | null;
}

export function StatusBar({ phase, detail, state, model }: StatusBarProps): JSX.Element {
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
      {model ? <span className="tau-status-model">{model}</span> : null}
      {detail ? <span className="tau-status-detail">{detail}</span> : null}
    </div>
  );
}

/* --------------------------------------------------------------- chat app */

export interface ChatProps {
  client: TauClient | null;
  phase: ConnectionPhase;
  detail: string | null;
  state: ConversationState;
  enterSubmits?: boolean;
}

/** The whole chat-only head: status, transcript, composer. */
export function Chat({ client, phase, detail, state, enterSubmits }: ChatProps): JSX.Element {
  const [model, setModel] = useState<string | null>(null);

  useEffect(() => {
    if (!client || phase !== 'ready') return;
    let cancelled = false;
    client
      .call('get_state', {})
      .then((result) => {
        if (cancelled) return;
        const record = result.model as Record<string, unknown> | null;
        setModel(record && typeof record['id'] === 'string' ? record['id'] : null);
      })
      .catch(() => {
        // The status bar shows no model rather than a wrong one. The
        // connection phase already reports whether the link is healthy.
      });
    return () => {
      cancelled = true;
    };
  }, [client, phase, state.running]);

  return (
    <div className="tau-app">
      <StatusBar phase={phase} detail={detail} state={state} model={model} />
      <Transcript state={state} />
      <Composer
        client={client}
        running={state.running}
        {...(enterSubmits === undefined ? {} : { enterSubmits })}
      />
    </div>
  );
}
