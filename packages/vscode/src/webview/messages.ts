/**
 * What the webview and the extension host say to each other.
 *
 * Shared by both sides so neither invents a shape the other does not read.
 * Protocol frames ride inside `frame` untouched; everything else here is the
 * host's own business -- which connection, why it closed, which τ it found.
 */

import type { HostNotice } from '@ffwf/tau-code-ui';

export type { HostNotice };

/** What the host knows that the webview needs, written into the page. */
export interface WebviewContext {
  /** The workspace folder new sessions are created in, or null with none open. */
  cwd: string | null;
  /** The `tau-code.model` setting: the model new sessions start on, or null for τ's default. */
  model: string | null;
  /** The `tau-code.token` setting, for a daemon with `serve.token` set. */
  token: string | null;
}

export type FromWebview =
  | { tauCode: 'open'; connection: number }
  | { tauCode: 'frame'; connection: number; frame: unknown }
  | { tauCode: 'close'; connection: number }
  | { tauCode: 'command'; command: string; argument?: string };

export type ToWebview =
  | { tauCode: 'frame'; connection: number; frame: unknown }
  | { tauCode: 'closed'; connection: number; reason: string; code: number | null }
  | { tauCode: 'notice'; notice: HostNotice };
