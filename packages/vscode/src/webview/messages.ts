/**
 * What the webview and the extension host say to each other.
 *
 * Shared by both sides so neither invents a shape the other does not read. Protocol messages ride
 * inside `message` untouched; everything else is the host's own business: which connection, why
 * it could not open, why it closed.
 *
 * The bearer token never crosses this line. The host holds the serve record and dials the HTTP
 * edge itself (relay.ts); the page only ever sees JSON-RPC messages.
 */

import type { EdgeError } from '@ffwf/tau-code-protocol';

/** What the host knows that the webview needs, written into the page. */
export interface WebviewContext {
  /** `user@host` of the extension host, the prefix of this page's `hello` client id. */
  where: string;
}

/** What the page keeps in webview state, and the host reads back to restore a panel. */
export interface PageState {
  /** The session this page was on (`Welcome.session`). */
  session?: string;
  /** This page's client id, stable across reloads of the page. */
  client?: string;
}

export type FromWebview =
  /** Open connection `connection`: start or find the server, open its stream. */
  | { tauCode: 'open'; connection: number }
  | { tauCode: 'message'; connection: number; message: unknown }
  | { tauCode: 'close'; connection: number }
  /** Run an editor command (the page cannot). */
  | { tauCode: 'command'; command: string };

export type ToWebview =
  /** The stream is open: messages follow. */
  | { tauCode: 'opened'; connection: number }
  /** The connection could not be opened, and why (`EdgeError.kind` says whether a retry can help). */
  | { tauCode: 'refused'; connection: number; kind: EdgeError['kind']; reason: string }
  | { tauCode: 'message'; connection: number; message: unknown }
  /** The connection is gone (`Transport.onClose`). */
  | { tauCode: 'closed'; connection: number; reason: string; violation: boolean };
