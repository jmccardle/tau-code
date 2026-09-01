/**
 * The rule a relay obeys: a request is ALWAYS answered.
 *
 * The VS Code extension host is a relay. The webview writes JSON-RPC into it
 * and it writes that through to a tau child process. When there is no process
 * -- it was refused, it failed to spawn, it died -- the request reaches
 * nothing.
 *
 * Dropping it is what this file exists to prevent. `TauClient.call` has no
 * deadline, on purpose: a request that is being worked on may take as long as
 * it takes, and a timeout would cancel real turns. The price of that choice is
 * that a dropped request is indistinguishable from a slow one, forever. So the
 * relay must answer, and the answer must name the reason -- otherwise the host
 * knows why and the reader does not, which is exactly the shape of the bug
 * where the log said "Refused to start: no workspace folder is open" and the
 * panel said "connecting".
 *
 * This is the same obligation `TauClient` already carries in the other
 * direction (RC1): answer, at minimum with an error. It is a rule about the
 * wire rather than about VS Code, so it lives here and is tested here.
 */

/**
 * A relay's "there is nothing behind me" error.
 *
 * JSON-RPC reserves -32768..-32000 for the protocol itself, and tau has claimed
 * -32000..-32004 inside that band for its own conditions. A relay is neither,
 * so this sits below the reserved floor where it cannot collide with either.
 *
 * A client seeing this knows the request never reached tau. That is a different
 * fact from tau refusing it, and the two must not be confused: nothing was
 * attempted, so nothing was half-done.
 */
export const NO_AGENT = -32900;

export interface RelayRefusal {
  jsonrpc: '2.0';
  id: string | number;
  error: { code: number; message: string };
}

/**
 * The response a relay owes `message`, or null if it owes none.
 *
 * Null for a notification, which by JSON-RPC gets no response even when it
 * cannot be delivered, and null for anything that is not a request at all --
 * a response travelling the wrong way, or a value that is not a message.
 * Those are dropped, and the caller should say so in its log.
 *
 * `reason` is shown to a person, so it is a whole sentence and it says what to
 * do next. It is not a code name.
 */
export function relayRefusal(message: unknown, reason: string): RelayRefusal | null {
  if (typeof message !== 'object' || message === null) return null;
  const record = message as Record<string, unknown>;
  if (typeof record['method'] !== 'string') return null;
  const id = record['id'];
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  return { jsonrpc: '2.0', id, error: { code: NO_AGENT, message: reason } };
}
