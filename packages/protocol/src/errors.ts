/**
 * Error codes from tau's RPC protocol.
 *
 * Source of truth: `docs/RPC-PROTOCOL.md` "Error codes" in the tau repo, which
 * is itself generated from `tau_agent_core.rpc.commands`. These are transcribed
 * rather than generated because a client branches on them by name in ordinary
 * control flow, and a name that disappears should break the build.
 */
export const RpcErrorCode = {
  /** Bytes that are not valid JSON, or not valid UTF-8 at all. */
  PARSE_ERROR: -32700,
  /** Valid JSON, but not a Request object. */
  INVALID_REQUEST: -32600,
  /** No such method, OR a method tau deliberately declined. Check `declined`. */
  METHOD_NOT_FOUND: -32601,
  /** `params` failed the method's schema. */
  INVALID_PARAMS: -32602,
  /** The handler raised something it did not raise on purpose. */
  INTERNAL_ERROR: -32603,
  /** Admission refused the Submission. Expected, structured; not a crash. */
  SUBMISSION_REJECTED: -32000,
  /**
   * `expand_commands: true` resolved to a frontend command. The core says WHAT
   * it is and refuses to silently no-op it. THIS HEAD must implement the four:
   * `/tree`, `/fork`, `/extensions`, `/compact`. See `FRONTEND_COMMANDS`.
   */
  COMMAND_NOT_SUPPORTED: -32001,
  /** A session switch waited for the in-flight turn and it did not free the lock. */
  TURN_STILL_RUNNING: -32002,
  /** An appending verb was called on a session with no durable location. */
  SESSION_NOT_PERSISTED: -32004,
} as const;

export type RpcErrorCodeValue = (typeof RpcErrorCode)[keyof typeof RpcErrorCode];

/**
 * The four commands tau resolves but refuses to perform over RPC, because the
 * wire has no screen to push a panel onto. A head that wants them implements
 * them itself; two of them have a verb that does the same job.
 */
export const FRONTEND_COMMANDS = {
  '/tree': 'No verb. This head renders the conversation tree itself.',
  '/fork': 'Use the `fork` verb.',
  '/compact': 'Use the `compact` verb.',
  '/extensions': 'No verb. This head renders the extension list itself.',
} as const;

/** A JSON-RPC error object as it arrives on the wire. */
export interface RpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

/** Thrown when tau answers a request with an error object. */
export class TauRpcError extends Error {
  readonly code: number;
  readonly data: unknown;
  readonly method: string;

  constructor(method: string, error: RpcErrorObject) {
    super(`${method}: ${error.message} (${error.code})`);
    this.name = 'TauRpcError';
    this.code = error.code;
    this.data = error.data;
    this.method = method;
  }

  /** True when retrying later could plausibly succeed. */
  get isRetryable(): boolean {
    return this.code === RpcErrorCode.TURN_STILL_RUNNING;
  }
}

/**
 * Thrown when the peer's protocol MAJOR does not match what this client was
 * built against. Fail Early: refuse to send anything else rather than
 * discovering the mismatch on some later request's malformed result.
 */
export class ProtocolVersionError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(
      `tau speaks protocol ${actual}; this client was built against ${expected}. ` +
        `MAJOR differs, so something already on the wire has changed meaning. Refusing to continue.`,
    );
    this.name = 'ProtocolVersionError';
  }
}
