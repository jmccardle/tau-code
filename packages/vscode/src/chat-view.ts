import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { LineFramer } from '@tau-code/protocol';
import { TauProcess } from '@tau-code/runner';

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
export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = 'tau-code.chat';

  #view: vscode.WebviewView | null = null;
  #proc: TauProcess | null = null;
  #framer: LineFramer | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.LogOutputChannel,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.#view = view;
    view.webview.options = {
      enableScripts: true,
      // The webview may load only what this extension ships. Nothing else is
      // reachable, which is what makes the strict CSP below enforceable.
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist-webview')],
    };
    view.webview.html = this.#html(view.webview);

    view.webview.onDidReceiveMessage((message: unknown) => this.#toTau(message));
    view.onDidDispose(() => {
      this.#view = null;
      void this.#stop();
    });

    this.#start();
  }

  restart(): void {
    void this.#stop().then(() => {
      if (this.#view) {
        // A fresh page, so the webview's client renegotiates from nothing
        // rather than holding state from a process that no longer exists.
        this.#view.webview.html = this.#html(this.#view.webview);
        this.#start();
      }
    });
  }

  dispose(): void {
    void this.#stop();
  }

  #start(): void {
    const config = vscode.workspace.getConfiguration('tau-code');
    const model = config.get<string>('model')?.trim();
    const provider = config.get<string>('provider')?.trim();

    const proc = new TauProcess({
      bin: config.get<string>('binary')?.trim() || 'tau',
      // The workspace folder, so the agent's tools resolve paths where the
      // user's code is. With no folder open there is nothing honest to pick,
      // and tau's own default applies.
      ...(vscode.workspace.workspaceFolders?.[0]
        ? { cwd: vscode.workspace.workspaceFolders[0].uri.fsPath }
        : {}),
      ...(model ? { model } : {}),
      ...(provider ? { provider } : {}),
    });

    this.#framer = new LineFramer(
      (value) => {
        void this.#view?.webview.postMessage(value);
      },
      (line) => this.output.error(`tau sent an unparseable line: ${line.slice(0, 400)}`),
    );

    try {
      proc.start((chunk) => this.output.append(chunk));
    } catch (error) {
      this.#report(error);
      return;
    }

    proc.child.stdout.on('data', (chunk: string) => this.#framer?.push(chunk));

    void proc.waitForExit().then((exit) => {
      const how = exit.signal !== null ? `killed by ${exit.signal}` : `exited with code ${exit.code}`;
      this.output.warn(`tau ${how}`);
      // The webview is told, so it can say so rather than sit on a dead socket.
      void this.#view?.webview.postMessage({
        jsonrpc: '2.0',
        method: 'tau_code/process_exit',
        params: { reason: `tau ${how}` },
      });
    });

    this.#proc = proc;
    this.output.info(`tau started (pid ${proc.pid ?? '?'}): ${proc.argv.join(' ')}`);
  }

  #toTau(message: unknown): void {
    const proc = this.#proc;
    if (!proc || !proc.running) {
      this.output.warn('A webview message arrived with no running tau process; dropped.');
      return;
    }
    proc.child.stdin.write(JSON.stringify(message) + '\n');
  }

  async #stop(): Promise<void> {
    const proc = this.#proc;
    this.#proc = null;
    this.#framer = null;
    if (proc) await proc.stop();
  }

  #report(error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    this.output.error(detail);
    void vscode.window.showErrorMessage(`tau could not start: ${detail}`, 'Show log').then((choice) => {
      if (choice === 'Show log') this.output.show();
    });
  }

  #html(webview: vscode.Webview): string {
    const asset = (name: string): vscode.Uri =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist-webview', name));
    const nonce = randomBytes(16).toString('base64');

    // `default-src 'none'` and then only what is genuinely needed. Styles need
    // 'unsafe-inline' because the editor injects its theme variables as an
    // inline style block; scripts do not, so they are nonce-gated.
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="${asset('webview.css').toString()}" />
    <style>
      html, body, #root { height: 100%; margin: 0; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" type="module" src="${asset('webview.js').toString()}"></script>
  </body>
</html>`;
  }
}
