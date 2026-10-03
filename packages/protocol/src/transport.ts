/**
 * The transport seam.
 *
 * Everything above this file speaks whole protocol frames -- one JSON object
 * each -- and knows nothing about sockets or `postMessage`. It is what lets one
 * client serve both hosts:
 *
 *   - a WebSocket to `tau serve`       (the browser, the VS Code extension host)
 *   - `postMessage` through a relay    (the VS Code webview)
 *
 * The serve protocol frames by WebSocket message: one JSON object per text
 * frame. There is no line framing to reassemble, so a transport hands up whole
 * objects and nothing else.
 */
export interface Transport {
  /** Send one frame. */
  send(frame: unknown): void;
  /** Register the sink for inbound frames. Called once. */
  onMessage(handler: (frame: unknown) => void): void;
  /**
   * Register the "the peer is gone" sink. `reason` is a sentence a person can
   * act on; `code` is the WebSocket close code when there was one, because the
   * daemon's 4000 ("you fell too far behind") means something a reconnect can
   * fix and an auth refusal does not.
   */
  onClose(handler: (reason: string, code: number | null) => void): void;
  close(): void;
}

/**
 * The daemon closed this connection because it fell too far behind.
 *
 * Not an error to report: the client resumes by `since`, and the replay or
 * snapshot the next `attach` answers brings it current.
 */
export const CLOSE_TOO_FAR_BEHIND = 4000;
