import * as vscode from 'vscode';
/**
 * The chat panel, and the bridge underneath it.
 *
 * The extension host owns the tau process and speaks stdio to it. The webview
 * speaks the SAME JSON-RPC over `postMessage`, so `@tau-code/ui` runs unchanged
 * here and in the browser -- the only difference is which `Transport` it is
 * handed. This is why the shared UI never imports `acquireVsCodeApi`.
 *
 * The bridge is a relay and not a client: it does not parse or interpret the
 * messages, it moves them. Request ids belong to the webview and come back
 * untouched, so there is no id rewriting here (unlike the server's Hub, which
 * has several clients to keep apart).
 */
export declare class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    #private;
    private readonly context;
    private readonly output;
    static readonly viewType = "tau-code.chat";
    constructor(context: vscode.ExtensionContext, output: vscode.LogOutputChannel);
    resolveWebviewView(view: vscode.WebviewView): void;
    restart(): void;
    dispose(): void;
}
//# sourceMappingURL=chat-view.d.ts.map