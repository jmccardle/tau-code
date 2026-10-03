import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ServeError, type DispatchedCommand, type Transport } from '@ffwf/tau-code-protocol';
import { Daemon, messageOf, type DaemonState } from './daemon.js';
import type { SessionState, SessionStore } from './session.js';

export interface DaemonHandle {
  daemon: Daemon | null;
  state: DaemonState;
}

const NOT_STARTED: DaemonState = { phase: 'connecting', detail: null, needsToken: false, session: null, hello: null };

/**
 * Build a `Daemon` for this head and keep its state in React.
 *
 * `open` is supplied by the HOST -- a WebSocket in the browser, a relay in the
 * VS Code webview. This hook never learns which, which is the whole reason the
 * same components run in both. It must be stable (memoized by the host): a new
 * `open` is a new daemon link.
 */
export function useDaemon(open: (() => Transport) | null, client: string, token: string | null): DaemonHandle {
  const [daemon, setDaemon] = useState<Daemon | null>(null);

  useEffect(() => {
    if (!open) return;
    const created = new Daemon({ open, client, token });
    setDaemon(created);
    created.start();
    return () => {
      created.dispose();
      setDaemon(null);
    };
    // `token` is deliberately not a dependency: a new token is `retry(token)` on
    // the same daemon, not a new one, so the session this head is on survives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client]);

  const subscribe = useCallback((listener: () => void) => daemon?.subscribe(listener) ?? (() => {}), [daemon]);
  const snapshot = useCallback(() => daemon?.state ?? NOT_STARTED, [daemon]);
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  return { daemon, state };
}

/** Subscribe a component to a session store. */
export function useSession(session: SessionStore | null): SessionState | null {
  const subscribe = useCallback((listener: () => void) => session?.subscribe(listener) ?? (() => {}), [session]);
  const snapshot = useCallback(() => session?.state ?? null, [session]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export interface Submitter {
  /**
   * Send text to this head's cursor.
   *
   * Resolves at ADMISSION, as RPC's submit does: the prompt was taken (and a
   * `submission_end` with its id will follow once its turn ends), refused with
   * τ's sentence, or dispatched as a command whose outcome is the answer.
   */
  submit(text: string, target?: SessionStore): Promise<SubmitOutcome>;
  /**
   * The id of the last submission this head sent, so its `submission_start`
   * attachment report can be told apart from another head's.
   */
  lastSubmissionId: string | null;
  abort(): Promise<void>;
  /** The last submission error, in words the user can act on. */
  error: string | null;
  clearError(): void;
}

export type SubmitOutcome =
  | { kind: 'admitted' }
  | { kind: 'refused'; reason: string }
  | { kind: 'command'; command: DispatchedCommand }
  | { kind: 'failed'; reason: string };

/**
 * Prompts and aborts for one session.
 *
 * ## A busy cursor queues, it does not refuse
 *
 * `multitask_strategy: "enqueue"`: a prompt sent while this cursor runs a
 * turn waits for that turn and then runs as its own, which is what a person
 * typing a second thought expects. It replaces `reject`, which made the chat box bounce
 * the second message. A parallel turn is a different act -- a cursor of its
 * own -- and is asked for, not inferred.
 */
export function useSubmitter(session: SessionStore | null): Submitter {
  const [error, setError] = useState<string | null>(null);
  const [lastSubmissionId, setLastSubmissionId] = useState<string | null>(null);
  const counter = useRef(0);

  const submit = useCallback(
    async (text: string, target?: SessionStore): Promise<SubmitOutcome> => {
      setError(null);
      try {
        const to = target ?? session;
        if (!to) throw new Error('Not attached to a session.');
        const { client, session_id, cursor_id } = to.at();
        const submissionId = newSubmissionId(counter);
        setLastSubmissionId(submissionId);
        const result = await client.request('submit', {
          session_id,
          cursor_id,
          text,
          // Provenance, as RPC requires it: a person typing into this head.
          source: 'interactive',
          submitter: 'human',
          submission_id: submissionId,
          multitask_strategy: 'enqueue',
          // The composer dispatches every `/word` it can before it gets here --
          // a flow through `next_step`, a view into this head's own panel -- so
          // what this reaches is an extension command taking one opaque line,
          // or prose. An unknown `/word` reaches the model as prose: τ's rule.
          expand_commands: true,
          // Without it `@notes.txt` reaches the model as those eleven
          // characters: a composer that completes a path and does not attach it.
          expand_attachments: true,
        });
        if (result.dispatched) return { kind: 'command', command: result.dispatched };
        return { kind: 'admitted' };
      } catch (raw) {
        // A refusal -- an extension lock, a cursor that will not take it -- is
        // τ's sentence, carried as the error's message.
        if (raw instanceof ServeError && raw.code === 'submission_rejected') {
          setError(raw.detail);
          return { kind: 'refused', reason: raw.detail };
        }
        const reason = messageOf(raw);
        setError(reason);
        return { kind: 'failed', reason };
      }
    },
    [session],
  );

  const abort = useCallback(async () => {
    try {
      if (!session) return;
      const { client, session_id, cursor_id } = session.at();
      await client.request('abort', { session_id, cursor_id });
    } catch (raw) {
      setError(messageOf(raw));
    }
  }, [session]);

  const clearError = useCallback(() => setError(null), []);
  return useMemo(
    () => ({ submit, abort, error, clearError, lastSubmissionId }),
    [submit, abort, error, clearError, lastSubmissionId],
  );
}

function newSubmissionId(counter: React.MutableRefObject<number>): string {
  counter.current += 1;
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `tau-code-${counter.current}-${random}`;
}
