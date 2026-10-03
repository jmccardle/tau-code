import type { Error as WireError } from './generated.js';

/** The stable codes a `response` can fail with. Generated, so a removed one breaks the build. */
export type ServeErrorCode = WireError['code'];

/**
 * A request the daemon answered with `ok: false`.
 *
 * `message` is τ's own sentence, kept verbatim as `detail`: the daemon writes
 * it for a person, and a head that replaced it with a guess would tell the
 * reader something τ did not say. `code` is for branching.
 */
export class ServeError extends Error {
  readonly request: string;
  readonly code: ServeErrorCode;
  readonly detail: string;

  constructor(request: string, error: WireError) {
    super(`${request} failed (${error.code}): ${error.message}`);
    this.name = 'ServeError';
    this.request = request;
    this.code = error.code;
    this.detail = error.message;
  }
}

/** The daemon speaks a different protocol version than this client was generated against. */
export class ProtocolVersionError extends Error {
  constructor(
    readonly ours: string,
    readonly detail: string,
  ) {
    super(
      `This client speaks serve protocol ${ours} and the daemon refused it: ${detail} ` +
        `Upgrade whichever of tau-code and τ is older.`,
    );
    this.name = 'ProtocolVersionError';
  }
}
