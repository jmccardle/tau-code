import { ERROR_CODES, PROTOCOL } from './generated.js';
import type { Error as WireError, ErrorCode } from './generated.js';

/** An error code's name, as the schema's `x-names` gives it (`"Busy"`, `"NotFound"`, ...). */
export type ErrorName = keyof typeof ERROR_CODES;

const NAMES = new Map<number, ErrorName>(
  Object.entries(ERROR_CODES).map(([name, code]) => [code, name as ErrorName]),
);

/** The name of a code, or null for a code the schema does not list. */
export function errorName(code: number): ErrorName | null {
  return NAMES.get(code) ?? null;
}

/** The server sent something protocol 2 does not allow. The connection is closed for it. */
export class ProtocolViolation extends Error {
  constructor(detail: string) {
    super(`protocol violation: ${detail}`);
    this.name = 'ProtocolViolation';
  }
}

/**
 * A call the server answered with a JSON-RPC error.
 *
 * `detail` is τ's own sentence, verbatim: the server writes it for a person. Branch on
 * `errorName` (`error.is('Busy')` reads better than -32001); `data` carries what a few codes add
 * (`ProtocolMismatch`: `server`; `UnknownCommand`: `name`).
 */
export class ServeError extends Error {
  readonly method: string;
  readonly code: ErrorCode;
  /** The code's name from the schema. */
  readonly errorName: ErrorName;
  readonly detail: string;
  readonly data: Record<string, unknown> | null;

  constructor(method: string, error: WireError) {
    const name = errorName(error.code);
    if (name === null) {
      // The schema's enum is closed: a code outside it is a server newer than this client.
      throw new ProtocolViolation(`${method} failed with code ${error.code}, which protocol ${PROTOCOL} does not name`);
    }
    super(`${method}: ${name}: ${error.message}`);
    this.name = 'ServeError';
    this.method = method;
    this.code = error.code;
    this.errorName = name;
    this.detail = error.message;
    this.data = error.data ?? null;
  }

  /** Whether this is the error named `name`. */
  is(name: ErrorName): boolean {
    return this.errorName === name;
  }
}

/**
 * Why a connection to the HTTP edge could not be opened.
 *
 * `kind` says whether trying again can help:
 * - `unreachable`: nothing answered (no server, a timeout). A server may come back.
 * - `unauthorized`: `401`, the token is missing or wrong. Final until the token changes.
 * - `forbidden`: `403`, the page's origin is not allowed (D29 §3). Final.
 * - `not-an-edge`: something answered, but not with τ's event stream. Final.
 */
export class EdgeError extends Error {
  readonly kind: 'unreachable' | 'unauthorized' | 'forbidden' | 'not-an-edge';
  readonly status: number | null;

  constructor(kind: EdgeError['kind'], message: string, status: number | null = null) {
    super(message);
    this.name = 'EdgeError';
    this.kind = kind;
    this.status = status;
  }

  /** Whether opening again, unchanged, could succeed. */
  get retryable(): boolean {
    return this.kind === 'unreachable';
  }
}

/** A call that was in flight, or made, when the connection closed. `reason` says why it closed. */
export class ConnectionClosed extends Error {
  readonly reason: string;

  constructor(method: string, reason: string) {
    super(`${method}: the connection closed: ${reason}`);
    this.name = 'ConnectionClosed';
    this.reason = reason;
  }
}
