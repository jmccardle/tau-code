import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  NO_AGENT,
  RpcErrorCode,
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
      truncation: null,
      cacheNotice: null,
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
          // The composer dispatches every `/word` tau declares before it gets
          // here -- a flow through `next_step`, a view into this head's own
          // panel -- so what this flag reaches is an extension command taking
          // one opaque line. An unknown `/word` still falls through to the model
          // as prose, which is tau's own rule and not a fallback added here.
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
 * ## tau's sentence wins
 *
 * This used to answer every structured code with a sentence of its own, and one
 * of them was wrong in a way that mattered. `SUBMISSION_REJECTED` (-32000) was
 * rendered as "a turn is already running" -- which is ONE of its causes. An
 * extension lock is another, and tau sends `refusal_reason` as the message: a
 * finished sentence naming the extension that stopped the session, what it said,
 * and the way out it declared. Replacing that with a guess told the reader to
 * wait for a turn that was not running, about a lock they were never shown.
 *
 * So a code whose message tau writes is passed through as `raw` -- the peer's
 * own sentence, without the method name and code `message` prefixes, which is
 * the form `TauRpcError` kept it in for exactly this. This only ADDS a sentence
 * where tau's is bare: `METHOD_NOT_FOUND`, which carries no body tau chose, and
 * where naming the method is the whole of the diagnosis.
 *
 * Anything that is not one of tau's own refusals keeps the prefixed `message`,
 * because there the request that failed is the first thing worth knowing.
 */
const TAU_WRITES_THE_SENTENCE = new Set([
  RpcErrorCode.SUBMISSION_REJECTED,
  RpcErrorCode.COMMAND_NOT_SUPPORTED,
  RpcErrorCode.TURN_STILL_RUNNING,
  RpcErrorCode.SESSION_NOT_PERSISTED,
  RpcErrorCode.INVALID_PARAMS,
]);

export function describe(raw: unknown): string {
  if (raw instanceof TauRpcError) {
    if (raw.code === RpcErrorCode.METHOD_NOT_FOUND) {
      return (
        `tau does not implement '${raw.method}'. Either this tau is older than the verb, ` +
        `or it is a declined verb whose reason says why.`
      );
    }
    return TAU_WRITES_THE_SENTENCE.has(raw.code as never) ? raw.raw : raw.message;
  }
  return raw instanceof Error ? raw.message : String(raw);
}
