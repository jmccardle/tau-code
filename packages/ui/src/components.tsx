import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CommandInfo, CursorState, ModelRecord, SessionRow } from '@ffwf/tau-code-protocol';
import type { Daemon, DaemonState, Phase } from './daemon.js';
import { messageOf } from './daemon.js';
import type { LiveToolCall, SessionState, SessionStore } from './session.js';
import { blocksToText, hasUserMessage, itemsOf, type ContentBlock, type Item } from './messages.js';
import { formatWhen, groupByCwd, sessionLabel } from './sessions.js';
import { applyCandidate, commandSpan, completeCommand, completePath, nextIndex, type Completions } from './completion.js';
import { aliasesOf, modelLabel, recordFor } from './models.js';
import { performCommand, type CommandResult } from './commands.js';
import { warningsLabel, type ExtensionWarning } from './warnings.js';
import { initialValues, requestOf } from './requests.js';
import { AskBody, Field, RequestPanel } from './request-panel.js';
import { TreePanel } from './tree-panel.js';
import type { FlowStep } from './flows.js';
import { FlowDialog } from './flow-dialog.js';
import { ExtensionPanel } from './extension-panel.js';
import { LiveMarkdown, Markdown } from './markdown.js';
import { useSession, useSubmitter } from './useTau.js';

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
      // Reasoning the provider kept to itself (Anthropic's redacted or
      // summarised-away blocks) arrives as an artifact with no text. It
      // happened, and it is replayed, so it is drawn -- as a fact, not as an
      // empty disclosure.
      if (block.thinking === '') return <div className="tau-thinking-empty">Reasoning (the provider sent no text for it)</div>;
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


/* ------------------------------------------------------------------ items */

function Blocks({ blocks, markdown = false }: { blocks: readonly ContentBlock[]; markdown?: boolean }): JSX.Element {
  return (
    <>
      {blocks.map((block, i) => (
        <Block key={i} block={block} markdown={markdown} />
      ))}
    </>
  );
}

function ItemView({ item, writing }: { item: Item; writing: boolean }): JSX.Element {
  switch (item.kind) {
    case 'user':
      return (
        <div className="tau-entry tau-entry-user">
          <div className="tau-role">You</div>
          <Blocks blocks={item.blocks} />
        </div>
      );
    case 'assistant':
      return (
        <div className="tau-entry tau-entry-assistant">
          <div className="tau-role">Agent</div>
          <Blocks blocks={item.blocks} markdown />
          {/* A stopped answer is a prefix, and looks finished unless it says so. */}
          {item.stopReason === 'aborted' ? <div className="tau-muted">Stopped before it finished.</div> : null}
          {/* The `turn_error` entry after it says why, so this only marks the cut. */}
          {item.stopReason === 'error' ? (
            <div className="tau-muted" title={item.error ?? undefined}>
              The response stream failed here.
            </div>
          ) : null}
        </div>
      );
    case 'toolResult':
      return (
        <details className={`tau-entry tau-entry-result${item.isError ? ' tau-error' : ''}`}>
          <summary>
            <span className="tau-tool-name">{item.toolName}</span>
            <span className="tau-tool-args-preview">
              {item.isError ? 'failed' : truncate(blocksToText(item.blocks).split('\n')[0] ?? '', 80)}
            </span>
          </summary>
          <Blocks blocks={item.blocks} />
          {item.exception ? (
            <div className="tau-notice tau-warn">Not shown to the model: {item.exception}</div>
          ) : null}
          {item.details ? <pre className="tau-pre">{JSON.stringify(item.details, null, 2)}</pre> : null}
        </details>
      );
    case 'system':
      return (
        <details className="tau-entry tau-entry-system">
          <summary>System prompt</summary>
          <div className="tau-text">{item.text}</div>
        </details>
      );
    case 'custom':
      return (
        <div className="tau-entry tau-entry-custom">
          <div className="tau-role">{item.customType}</div>
          <Blocks blocks={item.blocks} markdown />
        </div>
      );
    case 'turnError':
      return (
        <div className="tau-entry tau-entry-failure">
          <Blocks blocks={item.blocks} />
        </div>
      );
    case 'marker':
      return (
        <details className="tau-entry tau-entry-marker">
          <summary>{item.label}</summary>
          {item.text ? <Markdown text={item.text} /> : null}
        </details>
      );
    case 'incomplete':
      // Being written, or never finished. Which one is a fact about the cursor,
      // not the entry: the same `"status": "incomplete"` is a message in flight
      // while the turn runs and an interrupted one once it is over.
      return writing ? (
        <div className="tau-entry tau-entry-assistant tau-live">
          <div className="tau-role">Agent</div>
          <Blocks blocks={item.blocks} markdown />
        </div>
      ) : (
        <div className="tau-entry tau-entry-interrupted">
          <div className="tau-role">Interrupted</div>
          <Blocks blocks={item.blocks} markdown={item.entryType === 'message'} />
          <div className="tau-muted">
            This {item.entryType === 'message' ? 'message' : item.entryType} was being written when the turn
            stopped, and was never finished.
          </div>
        </div>
      );
  }
}

/* ------------------------------------------------------------------- live */

function LiveTool({ call }: { call: LiveToolCall }): JSX.Element {
  return (
    <div className="tau-live-tool tau-status-running">
      <span className="tau-tool-name">{call.name}</span>
      <span className="tau-tool-args-preview">running…</span>
      {call.args ? <span className="tau-live-args">{previewArgs(call.args)}</span> : null}
    </div>
  );
}

/* ------------------------------------------------------------- transcript */

export interface TranscriptProps {
  state: SessionState;
}

/** A retry's wait: `1s`, `2.5s`. */
function formatSeconds(seconds: number): string {
  return `${Number(seconds.toFixed(1))}s`;
}

/**
 * The transcript: the path from this head's cursor to the root, and the turn
 * running on that cursor.
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

  const items = useMemo(() => itemsOf(state.path), [state.path]);
  const running = state.cursor?.busy === true;
  const { live } = state;
  const streaming = running && (live.blocks.length > 0 || live.tools.length > 0);
  // The message being streamed is already an incomplete entry at the end of
  // the path; the live blocks are its up-to-date text. Draw it once.
  const last = items[items.length - 1];
  const shown = streaming && last?.kind === 'incomplete' ? items.slice(0, -1) : items;

  return (
    <div className="tau-transcript" ref={ref} onScroll={onScroll}>
      {state.missingParent ? (
        <div className="tau-notice tau-warn">
          This view does not hold entry {state.missingParent}, so the conversation above it is not shown.
        </div>
      ) : null}
      {shown.map((item) => (
        <ItemView key={item.id} item={item} writing={running} />
      ))}

      {streaming ? (
        <div className="tau-entry tau-entry-assistant tau-live">
          <div className="tau-role">Agent</div>
          {/* Markdown while it streams, not only once the turn ends. A half
              written fence renders as a code block that grows, which is what
              the reader expects. `LiveMarkdown` because a growing message
              defeats the memo -- see the measurements in markdown.tsx. */}
          {live.blocks.map((block, i) =>
            block.kind === 'thinking' ? (
              <details key={i} className="tau-thinking" open>
                <summary>Reasoning</summary>
                <LiveMarkdown text={block.text} />
              </details>
            ) : (
              <LiveMarkdown key={i} text={block.text} />
            ),
          )}
          {live.tools.map((call) => (
            <LiveTool key={call.toolCallId} call={call} />
          ))}
        </div>
      ) : null}

      {live.retry ? (
        <div className="tau-notice tau-warn">
          {live.retry.error ?? 'The request failed'} — retrying
          {live.retry.delaySeconds !== null ? ` in ${formatSeconds(live.retry.delaySeconds)}` : ''}
          {live.retry.attempt !== null
            ? ` (attempt ${live.retry.attempt}${live.retry.maxRetries !== null ? ` of ${live.retry.maxRetries}` : ''})`
            : ''}
          .
        </div>
      ) : null}

      {live.droppedFollowUps && live.droppedFollowUps.length > 0 ? (
        <div className="tau-notice tau-warn">
          {/* Whole texts rather than τ's 40-character previews (follow_ups.py):
              nothing else holds them. Mostly they are this reader's own
              prompts, sent while the turn ran, so they are called messages. */}
          Stopped: dropped {live.droppedFollowUps.length} queued message
          {live.droppedFollowUps.length === 1 ? '' : 's'}, never sent:
          {live.droppedFollowUps.map((text, i) => (
            <pre key={i} className="tau-pre">
              {text}
            </pre>
          ))}
        </div>
      ) : null}

      {live.endReason === 'max_turns' || live.endReason === 'repeat_tool_calls' ? (
        <div className="tau-notice tau-warn">
          The answer is truncated, not finished: the loop stopped because of <code>{live.endReason}</code>.
        </div>
      ) : null}
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
  /** The session to send to; null before one is chosen (see `ensureSession`). */
  session: SessionStore | null;
  /** The session's state, for the attachment report. */
  state: SessionState | null;
  /** The link is up. False disables sending and changes the placeholder. */
  ready: boolean;
  phase: Phase;
  /** This head's cursor is running a turn. Sending still works: it queues. */
  running: boolean;
  /** Enter sends. Set false for the tau TUI's convention (Ctrl+Enter sends). */
  enterSubmits?: boolean;
  /** The session's vocabulary, for the `/` popup. */
  commands?: readonly CommandInfo[];
  /**
   * Run a `/command`, in `target` when given (a session just created for it),
   * else in the attached one. Absent means none can be run.
   */
  onCommand?: (name: string, args: string, target?: SessionStore) => Promise<CommandResult>;
  /**
   * Make a session to send to, when there is none.
   *
   * Opening a panel is not starting a conversation: a session is created when
   * the reader SENDS, so an opened-and-abandoned panel leaves nothing behind in
   * the store.
   */
  ensureSession?: () => Promise<SessionStore>;
  /** Where a new session would start, for the placeholder. */
  newSessionCwd?: string | null;
  /**
   * Text to put in the editor, from somewhere other than the keyboard. The tree
   * browser's "ask this differently" is the one producer.
   */
  draft?: string | null;
  /** Called once `draft` has been taken, so the same text is not re-applied. */
  onDraftTaken?: () => void;
}

/**
 * The editor.
 *
 * Tab is the only completion key, which is a decision and not a shortage. Escape
 * closes, Enter sends and the arrows move the cursor -- all spent before this
 * feature existed. So repeated Tab cycles the candidates and writes each one
 * straight into the text, which means the editor always holds exactly what will
 * be sent. There is no mode to be in and no state to get out of.
 *
 * ## Sending while a turn runs
 *
 * Allowed, and queued: the prompt runs after the current turn (`enqueue`). The
 * editor clears as soon as the text is sent rather than when the daemon
 * answers, because the answer comes when the submission ENDS. A refusal puts
 * the text back, so a prompt that was not taken is never lost.
 */
export function Composer({
  session,
  state,
  ready,
  phase,
  running,
  enterSubmits = true,
  commands = [],
  onCommand,
  ensureSession,
  newSessionCwd = null,
  draft = null,
  onDraftTaken,
}: ComposerProps): JSX.Element {
  const [text, setText] = useState('');
  /**
   * The open popup, plus the text the span was measured against.
   *
   * `baseText` is not redundant. Every Tab REWRITES the editor, so after the
   * first one the live text no longer contains the word the span describes.
   * Each candidate is applied to the text as it stood when the popup opened,
   * which is what makes cycling reversible.
   */
  const [open, setOpen] = useState<{ completions: Completions; baseText: string } | null>(null);
  const [selected, setSelected] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const { submit, abort, error, lastSubmissionId } = useSubmitter(session);
  const area = useRef<HTMLTextAreaElement>(null);
  // Every path lookup is a round trip, and a stale one must not overwrite a
  // newer answer.
  const lookup = useRef(0);

  // A draft REPLACES what is typed, because it arrives from a gesture the reader
  // just made in another panel.
  useEffect(() => {
    if (draft === null) return;
    setText(draft);
    onDraftTaken?.();
    requestAnimationFrame(() => area.current?.focus());
  }, [draft, onDraftTaken]);

  // What `@file` expansion did to THIS head's last submission. τ reports it on
  // `submission_start`, which is the moment the prompt was taken.
  const attachments = state?.attachments;
  useEffect(() => {
    if (!attachments || attachments.submissionId !== lastSubmissionId) return;
    setNotice(attachmentNotice(attachments.report));
  }, [attachments, lastSubmissionId]);

  const completions = open?.completions ?? null;

  const dismiss = (): void => {
    setOpen(null);
    setSelected(0);
  };

  const write = (next: string, caret: number): void => {
    setText(next);
    // React re-renders before the DOM value is what we just set, so the
    // selection has to be applied after the paint or it lands on stale text.
    requestAnimationFrame(() => {
      const node = area.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(caret, caret);
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
      // Descending: the level below is a different listing.
      void openCompletions(applied.text, applied.cursor);
    }
  };

  /** Open the popup and apply its FIRST candidate, so Tab is one key, not two. */
  const openCompletions = async (source?: string, at?: number): Promise<void> => {
    const node = area.current;
    if (!node) return;
    const baseText = source ?? text;
    const caret = at ?? node.selectionStart;

    // Nothing is greyed: every command this session lists reaches the daemon,
    // a flow through `next_step` and the rest through `submit`, and a view this
    // head has no panel for is refused by name when τ asks for it.
    if (!session && commandSpan(baseText) !== null) {
      // The vocabulary is a session's: built-ins plus whatever its extensions
      // registered. With none attached there is no honest list to show, and an
      // empty popup would claim every command is unknown.
      setNotice('Commands come from a session. Open one in Sessions, or send this to start one and run it there.');
      return;
    }
    const command = completeCommand(baseText, commands, new Set());
    if (command !== null) {
      setOpen({ completions: command, baseText });
      setSelected(0);
      if (command.candidates.length > 0) apply(command, baseText, 0);
      return;
    }

    if (!session) {
      // Said, not silently skipped. A Tab that does nothing reads as a bug.
      setNotice('@ completion lists files in a session’s working directory, and there is no session yet.');
      return;
    }

    const ticket = (lookup.current += 1);
    try {
      const paths = await completePath(session, baseText, caret);
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
      setNotice(messageOf(raw));
    }
  };

  const cycle = (backwards: boolean): void => {
    if (!open || open.completions.candidates.length === 0) return;
    apply(open.completions, open.baseText, nextIndex(selected, open.completions.candidates.length, backwards));
  };

  const send = async (): Promise<void> => {
    const trimmed = text.trim();
    if (trimmed === '' || !ready) return;
    dismiss();
    setNotice(null);

    let target = session;
    if (!target) {
      if (!ensureSession) return;
      try {
        target = await ensureSession();
      } catch (raw) {
        setNotice(`Could not start a session: ${messageOf(raw)}`);
        return;
      }
    }

    // Every `/word` the session knows is dispatched here: a flow is stepped,
    // a view is opened, and the rest goes through `submit` with
    // `expand_commands`. A template or skill comes back as `prompt`, and a word
    // τ does not know as `prose`: both fall through to `submit`, where τ
    // expands the first and sends the second to the model as it stands.
    // The vocabulary is the TARGET's, which is not yet in props when the
    // session was created a moment ago.
    const span = commandSpan(trimmed);
    const vocabulary = target === session ? commands : (target.state.attached?.surface.commands ?? []);
    const named = vocabulary.find((c) => c.name === span?.token);
    if (span && named && onCommand) {
      const args = trimmed.slice(span.end).trim();
      const outcome = await onCommand(named.name, args, target);
      if (outcome.kind !== 'prose' && outcome.kind !== 'prompt') {
        if (outcome.kind !== 'cancelled' && outcome.notice !== '') setNotice(outcome.notice);
        if (outcome.kind === 'performed') setText('');
        return;
      }
    }

    setText('');
    area.current?.focus();
    const outcome = await submit(trimmed, target);
    if (outcome.kind === 'refused' || outcome.kind === 'failed') {
      // Never discard text the reader can retry -- unless they have already
      // started typing something else.
      setText((current) => (current === '' ? trimmed : current));
    } else if (outcome.kind === 'command') {
      // A line this head did not recognise as a command, which τ did: the
      // vocabulary changed under it (an extension was just enabled, say).
      const command = outcome.command;
      if (command.arm === 'Performed') {
        const output = command.data['output'];
        setNotice(typeof output === 'string' && output ? output : `/${command.flow ?? command.mutation} done.`);
      } else {
        setNotice(
          `τ read that as /${command.arm === 'View' ? command.name : command.flow}, which needs more from this head ` +
            `than a line of text. Run it again from the / popup.`,
        );
      }
    }
  };

  const placeholder = !ready
    ? phase === 'connecting' || phase === 'reconnecting'
      ? 'Connecting to tau serve…'
      : 'Not connected — see the message above.'
    : !session
      ? `Send to start a new session${newSessionCwd ? ` in ${newSessionCwd}` : ''} — / for commands`
      : running
        ? 'A turn is running — what you send now runs after it.'
        : 'Ask tau something — / for commands, @ for files';

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
        placeholder={placeholder}
        onChange={(event) => {
          setText(event.target.value);
          // Typing invalidates whatever the popup was describing.
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
        <button className="tau-button" onClick={() => void send()} disabled={!ready || text.trim() === ''}>
          {running ? 'Queue' : 'Send'}
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
function attachmentNotice(report: { unresolved: readonly string[]; failures: readonly string[] }): string | null {
  const parts: string[] = [];
  if (report.unresolved.length > 0) {
    parts.push(`Not a file, so sent as ordinary text: ${report.unresolved.map((t) => `@${t}`).join(', ')}.`);
  }
  for (const failure of report.failures) parts.push(`Attachment failed: ${failure}`);
  return parts.length > 0 ? parts.join(' ') : null;
}

/* ---------------------------------------------------------- session picker */

export interface SessionPickerProps {
  daemon: Daemon | null;
  currentSessionId: string | null;
  /** The cwd a new session starts in, and the group listed first. */
  cwd: string | null;
  /** The model a new session starts on, or null for the daemon's default. */
  model: string | null;
  onClose(): void;
  /**
   * Why the picker is open, when the reader did not open it. A panel that
   * lands on a list nobody asked for reads as a lost transcript; one sentence
   * is the difference between that and an offer.
   */
  reason?: string;
  /** The word on the close button. "Close" when the reader opened this. */
  closeLabel?: string;
}

/**
 * Open, start and fork sessions.
 *
 * The daemon lists every session it holds, across every working directory, so
 * the list is grouped by cwd -- this head's cwd first. Opening one ATTACHES:
 * the session keeps running for every other head on it, and a turn running in
 * it is not stopped.
 */
export function SessionPicker({
  daemon,
  currentSessionId,
  cwd,
  model,
  onClose,
  reason,
  closeLabel = 'Close',
}: SessionPickerProps): JSX.Element {
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newCwd, setNewCwd] = useState(cwd ?? '');

  useEffect(() => setNewCwd(cwd ?? ''), [cwd]);

  const load = useCallback(async () => {
    const client = daemon?.client;
    if (!client) return;
    setError(null);
    try {
      setRows((await client.request('list_sessions', {})).sessions);
    } catch (raw) {
      setError(messageOf(raw));
      setRows([]);
    }
  }, [daemon]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (what: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await what();
      onClose();
    } catch (raw) {
      setError(messageOf(raw));
    } finally {
      setBusy(false);
    }
  };

  const groups = rows ? groupByCwd(rows, cwd) : [];

  return (
    <div className="tau-sessions">
      <div className="tau-sessions-head">
        <strong>Sessions</strong>
        <button className="tau-button tau-button-quiet" onClick={onClose}>
          {closeLabel}
        </button>
      </div>

      {reason ? <div className="tau-sessions-reason">{reason}</div> : null}

      <div className="tau-composer-row tau-sessions-new">
        <input
          className="tau-sessions-cwd"
          value={newCwd}
          onChange={(event) => setNewCwd(event.target.value)}
          placeholder="Working directory on the daemon's machine"
          aria-label="Working directory for a new session"
        />
        <button
          className="tau-button"
          disabled={busy || !daemon || newCwd.trim() === ''}
          onClick={() => void act(() => daemon!.create(newCwd.trim(), model))}
        >
          New session
        </button>
        <button
          className="tau-button tau-button-quiet"
          disabled={busy || !daemon || currentSessionId === null}
          onClick={() => void act(() => daemon!.fork(daemon!.state.session?.state.cursor?.leaf ?? null))}
        >
          Fork this one
        </button>
        <button className="tau-button tau-button-quiet" disabled={busy} onClick={() => void load()}>
          Reload
        </button>
      </div>

      {error ? <div className="tau-notice tau-warn">{error}</div> : null}

      {rows === null ? (
        <div className="tau-notice">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="tau-notice">The daemon holds no sessions yet. Start one above, or just send a message.</div>
      ) : (
        groups.map(([group, list]) => (
          <div key={group}>
            <div className="tau-session-group">
              <code>{group}</code>
            </div>
            {list.length === 0 ? (
              <div className="tau-muted">No sessions here yet.</div>
            ) : (
              <ul className="tau-session-list">
                {list.map((row) => {
                  const current = row.session_id === currentSessionId;
                  return (
                    <li key={row.session_id}>
                      <button
                        className={`tau-session-row${current ? ' tau-session-current' : ''}`}
                        disabled={busy || current || !daemon}
                        onClick={() => void act(() => daemon!.open(row.session_id))}
                        title={row.ref}
                      >
                        <span className="tau-session-title">{sessionLabel(row)}</span>
                        <span className="tau-session-meta">
                          {current ? 'current · ' : ''}
                          {`${row.message_count} msg · `}
                          {formatWhen(row.modified)}
                          {row.parent ? ' · forked' : ''}
                        </span>
                        {/* τ lists a session it could not read and says why. Hiding
                            that row would undo the reporting it did on purpose. */}
                        {row.error ? <span className="tau-session-error">unreadable: {row.error}</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))
      )}
    </div>
  );
}

/* ---------------------------------------------------------- model picker */

export interface ModelPickerProps {
  session: SessionStore | null;
  models: readonly ModelRecord[];
  /** The name this head's cursor runs on. */
  active: string | null;
  running: boolean;
  onClose: () => void;
}

/**
 * Switch the model this head's cursor uses.
 *
 * The list is the daemon's: every name in its config, with the model each
 * resolves to, as the attach answer carried it. This client reads no config
 * file. A switch is per CURSOR -- another head on the same session keeps its
 * own -- and takes effect on that cursor's next turn.
 */
export function ModelPicker({ session, models, active, running, onClose }: ModelPickerProps): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const choose = async (name: string): Promise<void> => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const { client, session_id, cursor_id } = session.at();
      await client.request('set_model', { session_id, cursor_id, name });
      onClose();
    } catch (raw) {
      setError(messageOf(raw));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModelPanel
      models={models}
      active={active}
      running={running}
      busy={busy || !session}
      error={error}
      onClose={onClose}
      onChoose={(name) => void choose(name)}
    />
  );
}

export interface ModelPanelProps {
  models: readonly ModelRecord[];
  active: string | null;
  running: boolean;
  /** A call is in flight, or there is no session to make one with. */
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onChoose: (name: string) => void;
}

/**
 * What the model picker looks like. Everything, and no calls -- split out so
 * the markup can be rendered from a fixture.
 */
export function ModelPanel({ models, active, running, busy, error, onClose, onChoose }: ModelPanelProps): JSX.Element {
  const record = recordFor(models, active);
  const aliases = aliasesOf(models, active).filter((name) => name !== active);

  return (
    <div className="tau-sessions">
      <div className="tau-sessions-head">
        <strong>Model</strong>
        <button className="tau-button tau-button-quiet" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="tau-sessions-scope">
        {active === null ? (
          <div>This view has no cursor yet, so no model.</div>
        ) : record ? (
          <div>
            Running: <code>{active}</code> → <code>{modelLabel(record)}</code>
          </div>
        ) : (
          <div>
            Running: <code>{active}</code>, which is no longer a name in the daemon&apos;s config.
          </div>
        )}
      </div>

      {aliases.length > 0 ? (
        <div className="tau-sessions-reason">
          {aliases.join(', ')} {aliases.length === 1 ? 'resolves' : 'resolve'} to the same model, so switching
          to {aliases.length === 1 ? 'it' : 'one of them'} changes nothing the model does.
        </div>
      ) : null}

      {running ? (
        <div className="tau-notice">A turn is running. A switch takes effect on this cursor&apos;s next turn.</div>
      ) : null}
      {error ? <div className="tau-notice tau-warn">{error}</div> : null}

      {models.length === 0 ? (
        <div className="tau-notice">
          The daemon&apos;s config declares no models to switch between. They live in the
          <code> models </code> map of <code>~/.tau/config.json</code> on the daemon&apos;s machine.
        </div>
      ) : (
        <ul className="tau-session-list">
          {models.map((row) => {
            const current = row.name === active;
            return (
              <li key={row.name}>
                <button
                  className={`tau-session-row${current ? ' tau-session-current' : ''}`}
                  disabled={busy || current}
                  onClick={() => onChoose(row.name)}
                  title={`set_model ${row.name}`}
                >
                  <span className="tau-session-title">{row.name}</span>
                  <span className="tau-session-meta">
                    {current ? 'active · ' : ''}
                    {/* The id is what the name RESOLVED to, and it is often a
                        different string. Showing both is the point. */}
                    {modelLabel(row)}
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
  phase: Phase;
  /** The reason, as a whole sentence, from whoever knows it. */
  detail: string | null;
  /** One host-specific line about where to look next. */
  hint?: string;
  /** The daemon refused the token: offer a field for one. */
  needsToken?: boolean;
  onRetry?: (token?: string) => void;
}

/**
 * Why there is no link, said where the reader is looking.
 *
 * `detail` is shown verbatim and never summarised. The summary is what the
 * status bar already is, and a summary standing in for a reason is the defect
 * this block exists to prevent.
 */
export function Disconnected({ phase, detail, hint, needsToken, onRetry }: DisconnectedProps): JSX.Element | null {
  const [token, setToken] = useState('');
  if (phase === 'ready' || phase === 'connecting') return null;
  return (
    <div className="tau-disconnected" role="alert">
      <div className="tau-disconnected-head">
        {phase === 'failed' ? 'Not connected to tau serve.' : 'Reconnecting to tau serve…'}
      </div>
      <div className="tau-disconnected-why">
        {detail ?? 'No reason was reported, which is itself a fault — nothing should fail without saying why.'}
      </div>
      {needsToken && onRetry ? (
        <form
          className="tau-composer-row"
          onSubmit={(event) => {
            event.preventDefault();
            onRetry(token.trim());
          }}
        >
          <input
            className="tau-input"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="The daemon's serve.token"
            aria-label="Token"
          />
          <button className="tau-button" type="submit" disabled={token.trim() === ''}>
            Connect
          </button>
        </form>
      ) : phase === 'failed' && onRetry ? (
        <div className="tau-composer-row">
          <button className="tau-button tau-button-quiet" onClick={() => onRetry()}>
            Try again
          </button>
        </div>
      ) : null}
      {hint ? <div className="tau-disconnected-hint">{hint}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------- statusbar */

export interface StatusBarProps {
  phase: Phase;
  cursor: CursorState | null;
  /** How many other cursors on this session are running a turn right now. */
  othersBusy: number;
  onToggleSessions?: () => void;
  sessionsOpen?: boolean;
  onToggleModels?: () => void;
  modelsOpen?: boolean;
  onToggleTree?: () => void;
  treeOpen?: boolean;
  /** The session's current extension warnings; marked while there are any. */
  warnings?: readonly ExtensionWarning[];
  onToggleExtensions?: () => void;
  extensionsOpen?: boolean;
}

export function StatusBar({
  phase,
  cursor,
  othersBusy,
  onToggleSessions,
  sessionsOpen,
  onToggleModels,
  modelsOpen,
  onToggleTree,
  treeOpen,
  warnings,
  onToggleExtensions,
  extensionsOpen,
}: StatusBarProps): JSX.Element {
  const marked = warnings ? warningsLabel(warnings) : null;
  const label = phase === 'ready' ? (cursor === null ? 'no session' : cursor.busy ? 'running' : 'idle') : phase;
  return (
    <div className={`tau-status tau-status-${phase}`}>
      <span className="tau-status-dot" />
      <span>{label}</span>
      {othersBusy > 0 ? (
        <span className="tau-status-detail">
          {othersBusy} other {othersBusy === 1 ? 'cursor' : 'cursors'} running
        </span>
      ) : null}
      <span className="tau-status-spacer" />
      {marked !== null && onToggleExtensions ? (
        <button
          className={`tau-status-button tau-status-warnings${warnings?.some((w) => w.severity === 'error') ? ' tau-status-errors' : ''}`}
          onClick={onToggleExtensions}
          aria-pressed={extensionsOpen === true}
          title="What extensions flagged on this session (/extensions)"
        >
          {marked}
        </button>
      ) : null}
      {onToggleModels ? (
        <button
          className="tau-status-button tau-status-model"
          onClick={onToggleModels}
          aria-pressed={modelsOpen === true}
          title="Switch the model this view's cursor uses"
        >
          {cursor?.model ?? 'Model'}
        </button>
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
          title="Open, start, or fork a session"
        >
          Sessions
        </button>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------- extension forms */

/**
 * An extension's form (`request` event): answered by whichever head answers
 * first, so every head on the session draws it and the first `answer` wins.
 */
function FormPanel({
  session,
  form,
}: {
  session: SessionStore;
  form: { requestId: string; spec: { title?: string; fields: readonly FieldSpec[] } };
}): JSX.Element {
  const [values, setValues] = useState<Record<string, unknown>>(() => initialValues(form.spec));
  const [error, setError] = useState<string | null>(null);

  const reply = async (value: Record<string, unknown> | null): Promise<void> => {
    try {
      const { client, session_id } = session.at();
      await client.request('answer', { session_id, request_id: form.requestId, value });
    } catch (raw) {
      setError(messageOf(raw));
    }
  };

  return (
    <section className="tau-panel tau-request">
      <header className="tau-panel-head">
        <h2>{form.spec.title ?? 'An extension asks'}</h2>
      </header>
      <div className="tau-request-fields">
        {form.spec.fields.map((field) => (
          <Field
            key={field.name}
            field={field}
            value={values[field.name]}
            onChange={(value) => setValues((previous) => ({ ...previous, [field.name]: value }))}
          />
        ))}
      </div>
      {error ? <p className="tau-notice tau-warn">{error}</p> : null}
      <div className="tau-composer-row">
        <button className="tau-button" onClick={() => void reply(values)}>
          Submit
        </button>
        <button className="tau-button tau-button-quiet" onClick={() => void reply(null)}>
          Cancel
        </button>
      </div>
    </section>
  );
}

type FieldSpec = Parameters<typeof Field>[0]['field'];

/* ---------------------------------------------------------- host notices */

/**
 * A sentence from whatever is hosting this client, about something tau cannot
 * report on its own.
 *
 * The case it exists for is two taus installed at different versions: the
 * decision of which to run is made by the host, before any process exists, so
 * there is no connection over which tau could mention it. A host with nothing
 * to say passes none of these, which is the browser client's whole involvement.
 *
 * `action` is a LABEL and an id, never a callback, because this module runs in
 * a browser tab and in a webview and knows about neither. The host is handed
 * the notice back and decides what running it means.
 */
export interface HostNotice {
  id: string;
  level: 'info' | 'warn';
  text: string;
  action?: { label: string; command: string; argument?: string };
}

/**
 * The banner strip, above everything.
 *
 * Above, and not in the transcript: a reader who has to scroll to find out that
 * the agent answering them is not the tau they think it is has been told
 * nothing in time to act on it -- the same reasoning that puts an extension
 * request above the transcript rather than below.
 *
 * Dismissible, and only in this document: a banner with no way to put it down
 * is a banner people learn to read past, and the condition it describes is one
 * the user may have decided is fine. It comes back on restart, because that is
 * when the answer could have changed.
 */
function NoticeStrip({
  notices,
  onAction,
}: {
  notices: readonly HostNotice[];
  onAction?: ((notice: HostNotice) => void) | undefined;
}): JSX.Element | null {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const live = notices.filter((notice) => !dismissed.has(notice.id));
  if (live.length === 0) return null;

  return (
    <>
      {live.map((notice) => (
        <div
          key={notice.id}
          className={`tau-notice tau-banner${notice.level === 'warn' ? ' tau-warn' : ''}`}
          role="status"
        >
          <span className="tau-banner-text">{notice.text}</span>
          {notice.action && onAction ? (
            <button className="tau-status-button" onClick={() => onAction(notice)}>
              {notice.action.label}
            </button>
          ) : null}
          <button
            className="tau-status-button"
            title="Dismiss until the agent restarts"
            aria-label="Dismiss"
            onClick={() => setDismissed((was) => new Set(was).add(notice.id))}
          >
            ✕
          </button>
        </div>
      ))}
    </>
  );
}


/* ------------------------------------------------------- extension display */

/**
 * What extensions asked every head to show: notifications, status lines and
 * panels (`ui` events). A status or panel is keyed, and a later one with the
 * same key replaces it -- or removes it, when its text or spec is null.
 */
function ExtensionDisplay({
  state,
  onAction,
}: {
  state: SessionState;
  onAction: (command: string, args: string) => void;
}): JSX.Element | null {
  const statuses = new Map<string, string>();
  const panels = new Map<string, NonNullable<Extract<SessionState['ui'][number]['data'], { op: 'panel' }>['spec']>>();
  const notes: Array<{ seq: number; level: string; message: string }> = [];
  for (const call of state.ui) {
    const data = call.data;
    if (data.op === 'status') {
      if (data.text === null) statuses.delete(data.key);
      else statuses.set(data.key, data.text);
    } else if (data.op === 'panel') {
      if (data.spec === null) panels.delete(data.key);
      else panels.set(data.key, data.spec);
    } else if (data.op === 'notify') {
      notes.push({ seq: call.seq, level: data.level, message: data.message });
    }
  }
  const recent = notes.slice(-3);
  if (statuses.size === 0 && panels.size === 0 && recent.length === 0) return null;

  return (
    <div className="tau-extension-display">
      {[...statuses.entries()].map(([key, text]) => (
        <div key={`status-${key}`} className="tau-notice">
          <strong>{key}</strong> {text}
        </div>
      ))}
      {recent.map((note) => (
        <div key={note.seq} className={`tau-notice${note.level === 'warning' || note.level === 'error' ? ' tau-warn' : ''}`}>
          {note.message}
        </div>
      ))}
      {[...panels.entries()].map(([key, spec]) => (
        <section key={`panel-${key}`} className="tau-panel">
          <header className="tau-panel-head">
            <h2>{spec.title}</h2>
          </header>
          <AskBody body={spec.body} />
          {spec.actions.length > 0 ? (
            <div className="tau-composer-row">
              {spec.actions.map((action) => (
                <button key={action.label} className="tau-button tau-button-quiet" onClick={() => onAction(action.command, action.args)}>
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- chat app */

export interface ChatProps {
  daemon: Daemon | null;
  daemonState: DaemonState;
  enterSubmits?: boolean;
  /**
   * The cwd a new session starts in. The VS Code host passes its workspace
   * folder; the browser passes nothing and the daemon's own cwd is used.
   */
  defaultCwd?: string | null;
  /** The model a new session starts on; null for the daemon's default. */
  defaultModel?: string | null;
  /** A session to attach to on connect -- a restored editor tab's. */
  initialSession?: string | null;
  /** Told whenever this head moves to another session, so a host can remember it. */
  onSessionChanged?: (sessionId: string | null) => void;
  /**
   * Where to look when there is no link. Host-specific, so the host supplies
   * it: this component runs in a browser tab and in an editor panel.
   */
  disconnectedHint?: string;
  /** Sentences from the host about its own decisions -- which τ it found. */
  notices?: readonly HostNotice[];
  /** Run a notice's action. The host decides what its `command` means. */
  onNoticeAction?: (notice: HostNotice) => void;
}

type Panel = 'sessions' | 'models' | 'tree' | 'extensions' | null;

/** The whole chat head: status, panels, transcript, composer. */
const PICK = 'Pick a session to carry on with, or close this and start typing to begin a new one.';

export function Chat({
  daemon,
  daemonState,
  enterSubmits,
  defaultCwd = null,
  defaultModel = null,
  initialSession = null,
  onSessionChanged,
  disconnectedHint,
  notices,
  onNoticeAction,
}: ChatProps): JSX.Element {
  const { phase, detail, needsToken, session, hello } = daemonState;
  const state = useSession(session);
  const ready = phase === 'ready';
  const [panel, setPanel] = useState<Panel>(null);
  // Why the picker is up, set only while it is because nothing was there to show.
  const [landed, setLanded] = useState<string | null>(null);
  const [revised, setRevised] = useState<string | null>(null);
  const [requestDismissed, setRequestDismissed] = useState<string | null>(null);
  const [flowStep, setFlowStep] = useState<{ step: FlowStep; settle: (value: unknown | null) => void } | null>(null);
  const tried = useRef(false);

  const cwd = defaultCwd ?? hello?.cwd ?? null;
  const cursor = state?.cursor ?? null;
  const running = cursor?.busy === true;
  const commands = state?.attached?.surface.commands ?? [];

  // "No session" is reported only once one was held and then left. Before the
  // first attach there is no session YET, and saying so would make the host
  // forget the one it asked for -- a reload that stops at a token prompt would
  // come back to the picker.
  const held = useRef(false);
  useEffect(() => {
    if (session) held.current = true;
    else if (!held.current) return;
    onSessionChanged?.(session?.sessionId ?? null);
  }, [session, onSessionChanged]);

  /**
   * On the first connect: re-attach to the session this view was on, else land
   * on the picker. Decided ONCE -- a reconnect re-attaches by itself, and a
   * reader who closed the picker has said what they want.
   */
  useEffect(() => {
    if (!ready || !daemon || tried.current) return;
    tried.current = true;
    if (session) return;
    if (initialSession) {
      daemon.open(initialSession).catch((error: unknown) => {
        // Gone, or never this daemon's: the host should stop asking for it,
        // and the reader hears why they are on the picker instead.
        onSessionChanged?.(null);
        setPanel('sessions');
        setLanded(`Could not reopen session ${initialSession}: ${messageOf(error).replace(/[.!?]?$/, '.')} ${PICK}`);
      });
      return;
    }
    setPanel('sessions');
    setLanded(PICK);
  }, [ready, daemon, session, initialSession, onSessionChanged]);

  // Land on the picker for an attached session with nothing said in it yet.
  const empty = state !== null && state.loaded && !hasUserMessage(state.path);
  useEffect(() => {
    if (empty && panel === null && !tried.current) setPanel('sessions');
  }, [empty, panel]);

  const openView = useCallback((name: string): boolean => {
    if (name !== 'tree' && name !== 'extensions') return false;
    setLanded(null);
    setPanel(name);
    return true;
  }, []);

  const onCommand = useCallback(
    async (name: string, args: string, target?: SessionStore): Promise<CommandResult> => {
      const on = target ?? session;
      if (!daemon || !on) return { kind: 'refused', notice: 'Start or open a session first.' };
      return performCommand(name, args, on.state.attached?.surface.commands ?? commands, {
        daemon,
        session: on,
        openSessions: () => setPanel('sessions'),
        openView,
        // One step at a time, and the promise is what the flow loop awaits. A
        // dialog rather than a second composer: two prompts must never coexist.
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
    [daemon, session, commands, openView],
  );

  const ensureSession = useCallback(async (): Promise<SessionStore> => {
    if (!daemon) throw new Error('Not connected to tau serve.');
    if (!cwd) throw new Error('No working directory to start a session in; pick one in Sessions.');
    setPanel(null);
    setLanded(null);
    return daemon.create(cwd, defaultModel);
  }, [daemon, cwd, defaultModel]);

  const toggle = (which: Exclude<Panel, null>) => (): void => {
    setLanded(null);
    setPanel((open) => (open === which ? null : which));
  };

  const request = cursor?.request ? requestOf(cursor.request) : null;
  const othersBusy = (state?.cursors ?? []).filter((c) => c.busy && c.cursor_id !== cursor?.cursor_id).length;

  return (
    <div className="tau-app">
      <StatusBar
        phase={phase}
        cursor={cursor}
        othersBusy={othersBusy}
        sessionsOpen={panel === 'sessions'}
        modelsOpen={panel === 'models'}
        treeOpen={panel === 'tree'}
        extensionsOpen={panel === 'extensions'}
        {...(state?.attached ? { warnings: state.attached.surface.warnings } : {})}
        {...(ready
          ? {
              onToggleSessions: toggle('sessions'),
              ...(session
                ? { onToggleModels: toggle('models'), onToggleTree: toggle('tree'), onToggleExtensions: toggle('extensions') }
                : {}),
            }
          : {})}
      />
      {/* First, above the disconnection notice as well: "which τ is this"
          explains a failure to connect at least as often as it accompanies a
          working one. */}
      <NoticeStrip notices={notices ?? []} onAction={onNoticeAction} />
      <Disconnected
        phase={phase}
        detail={detail}
        needsToken={needsToken}
        onRetry={(token) => daemon?.retry(token)}
        {...(disconnectedHint ? { hint: disconnectedHint } : {})}
      />
      {state?.failure ? <div className="tau-notice tau-warn">{state.failure}</div> : null}
      {panel === 'sessions' ? (
        <SessionPicker
          daemon={ready ? daemon : null}
          currentSessionId={session?.sessionId ?? null}
          cwd={cwd}
          model={defaultModel}
          onClose={() => {
            setPanel(null);
            setLanded(null);
          }}
          {...(landed ? { reason: landed, closeLabel: 'Start here' } : {})}
        />
      ) : null}
      {panel === 'models' && state ? (
        <ModelPicker
          session={session}
          models={state.attached?.models ?? []}
          active={cursor?.model ?? null}
          running={running}
          onClose={() => setPanel(null)}
        />
      ) : null}
      {/* A lock refuses every prompt, so it goes ABOVE the transcript: a reader
          who has to scroll to find out why their message bounced has been told
          nothing in time to act on. It is the cursor's own state, so it comes
          and goes with the cursor and nothing here asks for it. */}
      {request !== null && requestDismissed !== request.entryId ? (
        <RequestPanel
          session={session}
          request={request}
          onAnswered={() => setRequestDismissed(null)}
          onDismiss={() => setRequestDismissed(request.entryId)}
        />
      ) : null}
      {session && state
        ? state.forms.map((form) => <FormPanel key={form.requestId} session={session} form={form} />)
        : null}
      {panel === 'tree' && state ? (
        <TreePanel
          session={session}
          revision={state.revision}
          running={running}
          onRevise={setRevised}
          onClose={() => setPanel(null)}
        />
      ) : null}
      {panel === 'extensions' ? (
        <ExtensionPanel session={session} surface={state?.attached?.surface ?? null} onClose={() => setPanel(null)} />
      ) : null}
      {flowStep !== null ? (
        <FlowDialog
          session={session}
          step={flowStep.step}
          onSubmit={(value) => flowStep.settle(value)}
          onCancel={() => flowStep.settle(null)}
        />
      ) : null}
      {state ? <ExtensionDisplay state={state} onAction={(command, args) => void onCommand(command, args)} /> : null}
      {state ? <Transcript state={state} /> : <div className="tau-transcript" />}
      {/* Both notices are τ's own readings, and both say something the
          transcript cannot: a completion cut off by the output cap reads
          exactly like one that finished, and a prompt cache that was never
          consulted is invisible except in the bill. */}
      {state?.live.truncation ? (
        <div className="tau-notice tau-warn">
          The model hit its output cap, so that answer is a PREFIX and not a finished one
          {state.live.truncation.droppedToolCalls !== null
            ? `, and ${state.live.truncation.droppedToolCalls} tool call${
                state.live.truncation.droppedToolCalls === 1 ? '' : 's'
              } went unrun`
            : ''}
          . Raise <code>max_tokens</code> for this model in the daemon&apos;s <code>~/.tau/config.json</code>, or
          ask for less at a time.
        </div>
      ) : null}
      {state?.live.cacheNotice ? <div className="tau-notice tau-warn">{state.live.cacheNotice}</div> : null}
      {state?.compaction ? (
        <div className={`tau-notice${state.compaction.failed ? ' tau-warn' : ''}`}>{state.compaction.text}</div>
      ) : null}
      <Composer
        session={session}
        state={state}
        ready={ready}
        phase={phase}
        running={running}
        commands={commands}
        onCommand={onCommand}
        ensureSession={ensureSession}
        newSessionCwd={cwd}
        draft={revised}
        onDraftTaken={() => setRevised(null)}
        {...(enterSubmits === undefined ? {} : { enterSubmits })}
      />
    </div>
  );
}
