import type { Transport } from '@tau-code/protocol';
/**
 * A `Transport` over the webview's `postMessage` channel.
 *
 * The extension host relays these to tau's stdin verbatim, so what travels here
 * is ordinary JSON-RPC -- the same messages the browser sends over a
 * WebSocket. `@tau-code/ui` cannot tell the difference, which is the point.
 *
 * No framing: `postMessage` delivers structured values, already whole. The line
 * framer exists for byte streams and there is no byte stream here.
 */
export declare class VsCodeTransport implements Transport {
    #private;
    constructor();
    send(message: unknown): void;
    onMessage(handler: (message: unknown) => void): void;
    onClose(handler: (reason: string) => void): void;
    close(): void;
}
//# sourceMappingURL=vscode-transport.d.ts.map