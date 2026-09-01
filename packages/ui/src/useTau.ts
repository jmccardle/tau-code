import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { TauClient, TauRpcError, type Capabilities, type Transport } from '@tau-code/protocol';
import { Conversation, type ConversationState } from './conversation.js';

export type ConnectionPhase = 'connecting' | 'ready' | 'failed' | 'closed';

export interface TauConnection {
  client: TauClient | null;
  conversation: Conversation | null;
  phase: ConnectionPhase;
  capabilities: Capabilities | null;
  /** Why the connection failed or closed. Never a bare "something went wrong". */
  detail: string | null;
}

/**
 * Build a client over `transport`, negotiate, and keep the phase in state.
 *
 * The transport is supplied by the HOST -- a WebSocket in the browser, a
 * `postMessage` bridge in the VS Code webview. This hook never learns which,
 * which is the whole reason the same components run in both.
 */
export function useTauConnection(transport: Transport | null): TauConnection {
  const [connection, setConnection] = useState<TauConnection>({
    client: null,
    conversation: null,
    phase: 'connecting',
    capabilities: null,
    detail: null,
  });

  useEffect(() => {
    if (!transport) return;
    let disposed = false;

    const client = new TauClient(transport);
    const conversation = new Conversation(client);

    const offClose = client.on('close', (reason) => {
      if (disposed) return;
      setConnection((previous) => ({ ...previous, phase: 'closed', detail: reason }));
    });

    client
      .connect()
      .then((capabilities) => {
        if (disposed) return;
        setConnection({ client, conversation, phase: 'ready', capabilities, detail: null });
        return conversation.refresh();
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setConnection({
          client: null,
          conversation: null,
          phase: 'failed',
          capabilities: null,
          detail: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      disposed = true;
      offClose();
      conversation.dispose();
      client.close();
    };
  }, [transport]);

  return connection;
}

/** Subscribe a component to the conversation store. */
export function useConversation(conversation: Conversation | null): ConversationState {
  const empty = useMemo<ConversationState>(
    () => ({
      messages: [],
      live: [],
      liveTools: [],
      running: false,
      turnIndex: null,
      endReason: null,
      error: null,
      cursor: null,
      notice: null,
    }),
    [],
  );

  const subscribe = useCallback(
    (listener: () => void) => conversation?.subscribe(listener) ?? (() => {}),
    [conversation],
  );
  const snapshot = useCallback(() => conversation?.state ?? empty, [conversation, empty]);

  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export interface Submitter {
  submit(text: string): Promise<void>;
  abort(): Promise<void>;
  /** The last submission error, in words the user can act on. */
  error: string | null;
  busy: boolean;
}

/**
 * Send prompts and abort turns.
 *
 * `submit` has TWO completions: this promise resolves when tau ACCEPTS the
 * submission, not when the turn finishes. The turn's end arrives later as an
 * `agent_end` event, which the `Conversation` store handles. A UI that treats
 * this promise as "the answer is ready" will be wrong on every call.
 */
export function useSubmitter(client: TauClient | null): Submitter {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const counter = useRef(0);

  const submit = useCallback(
    async (text: string) => {
      if (!client) {
        setError('Not connected.');
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await client.call('submit', {
          text,
          source: 'rpc',
          submitter: 'tau-code',
          submission_id: newSubmissionId(counter),
          // 'reject' is tau's default and the honest one for a chat box: a
          // second prompt sent during a running turn is refused with a
          // structured error the UI can show, rather than silently queued
          // behind an answer the user is still reading.
          multitask_strategy: 'reject',
        });
      } catch (raw) {
        setError(describe(raw));
      } finally {
        setBusy(false);
      }
    },
    [client],
  );

  const abort = useCallback(async () => {
    if (!client) return;
    try {
      await client.call('abort', {});
    } catch (raw) {
      setError(describe(raw));
    }
  }, [client]);

  return { submit, abort, error, busy };
}

function newSubmissionId(counter: React.MutableRefObject<number>): string {
  counter.current += 1;
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `tau-code-${counter.current}-${random}`;
}

/**
 * Turn an error into something a user can act on.
 *
 * The structured RPC codes each mean a specific, recoverable thing, and saying
 * which one it was is the difference between "try again in a moment" and
 * "this will never work".
 */
export function describe(raw: unknown): string {
  if (raw instanceof TauRpcError) {
    switch (raw.code) {
      case -32000:
        return 'tau refused the prompt: a turn is already running. Wait for it, or stop it first.';
      case -32001:
        return 'That is a command this head has to handle itself; tau will not run it over RPC.';
      case -32002:
        return 'The running turn did not stop in time. Nothing was changed. Try again.';
      case -32004:
        return 'This session is not persisted, so tau refused to write to it. Start a persisted session.';
      case -32601:
        return `tau does not implement '${raw.method}'. If it is a declined verb, its reason says why.`;
      default:
        return raw.message;
    }
  }
  return raw instanceof Error ? raw.message : String(raw);
}
