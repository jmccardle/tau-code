import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  NO_AGENT,
  TauClient,
  TauRpcError,
  type Capabilities,
  type Transport,
} from '@ffwf/tau-code-protocol';
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
 * Why the connection failed, in the words worth showing a reader.
 *
 * A relay's `NO_AGENT` refusal is already a finished sentence: the host wrote
 * it, it names the cause and what to do about it, and WHICH request happened to
 * receive it is an accident. So that one case is unwrapped, and everything else
 * keeps the method and code that make an unexpected error diagnosable.
 */
function whyItFailed(error: unknown): string {
  if (error instanceof TauRpcError && error.code === NO_AGENT) return error.raw;
  return error instanceof Error ? error.message : String(error);
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
          detail: whyItFailed(error),
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
      loaded: false,
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

/**
 * What `expand_attachments` did, read off the acceptance response.
 *
 * `unresolved` names the `@words` that matched no file and were therefore left
 * in the text as prose. `failures` names the ones that resolved but could not
 * be sent. Both are shown: the model is told the same thing through a
 * `<reference error=…>` block, and a head that showed neither would turn a
 * failure tau reported on purpose back into a silent one.
 */
export interface AttachmentReport {
  expanded: number;
  images: number;
  unresolved: string[];
  failures: string[];
}

export interface Submitter {
  submit(text: string): Promise<AttachmentReport | null>;
  abort(): Promise<void>;
  /** The last submission error, in words the user can act on. */
  error: string | null;
  busy: boolean;
}

function readAttachmentReport(value: unknown): AttachmentReport | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const strings = (key: string): string[] =>
    Array.isArray(record[key]) ? (record[key] as unknown[]).map(String) : [];
  return {
    expanded: Number(record['expanded'] ?? 0),
    images: Number(record['images'] ?? 0),
    unresolved: strings('unresolved'),
    failures: strings('failures'),
  };
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
    async (text: string): Promise<AttachmentReport | null> => {
      if (!client) {
        setError('Not connected.');
        return null;
      }
      setBusy(true);
      setError(null);
      try {
        const result = await client.call('submit', {
          text,
          source: 'rpc',
          submitter: 'tau-code',
          submission_id: newSubmissionId(counter),
          // 'reject' is tau's default and the honest one for a chat box: a
          // second prompt sent during a running turn is refused with a
          // structured error the UI can show, rather than silently queued
          // behind an answer the user is still reading.
          multitask_strategy: 'reject',
          // Protocol 1.4. Without it `@notes.txt` reaches the model as those
          // eleven literal characters, which is a composer that completes a
          // path and then does not attach it.
          //
          // The composer intercepts every FRONTEND command before it gets here
          // (a `/tree` sent with expand_commands would earn a -32001), so what
          // this flag reaches is the extension-registered vocabulary. An
          // unknown `/word` still falls through to the model as prose, which is
          // tau's own rule and not a fallback added here.
          expand_attachments: true,
          expand_commands: true,
        });
        return readAttachmentReport(result.attachments);
      } catch (raw) {
        setError(describe(raw));
        return null;
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
