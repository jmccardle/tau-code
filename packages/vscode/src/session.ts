import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { LineFramer } from '@tau-code/protocol';
import { TauProcess } from '@tau-code/runner';

/** Expand a leading `~` in a configured path. Returns undefined for empty. */
function expandHome(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return join(homedir(), value.slice(2));
  return value;
}

/**
 * One agent, bound to one webview.
 *
 * The extension host owns the tau process and speaks stdio to it. The webview
 * speaks the SAME JSON-RPC over `postMessage`, so `@tau-code/ui` runs unchanged
 * here and in the browser -- the only difference is which `Transport` it is
 * handed. This is why the shared UI never imports `acquireVsCodeApi`.
 *
 * The bridge is a relay and not a client: it does not parse or interpret the
 * messages, it moves them. Request ids belong to the webview and come back
 * untouched, so there is no id rewriting here (unlike the server's Hub, which
 * has several browser clients to keep apart).
 *
 * **One session per webview.** The sidebar view and each editor tab get their
 * own tau process and therefore their own conversation. That is deliberate:
 * sharing one process between two webviews would mean two writers on one
 * conversation, which tau's own rule forbids. The cost is that opening a tab
 * while the sidebar is open gives you two agents in the same working directory
 * -- which is a legitimate workflow, and is why the status bar names the
 * session.
 */
export class TauSession implements vscode.Disposable {
  #proc: TauProcess | null = null;
  #framer: LineFramer | null = null;
  #webview: vscode.Webview;
  #disposed = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.LogOutputChannel,
    webview: vscode.Webview,
    private readonly label: string,
  ) {
    this.#webview = webview;
    webview.options = {
      enableScripts: true,
      // The webview may load only what this extension ships. Nothing else is
      // reachable, which is what makes the strict CSP enforceable.
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist-webview')],
    };
    webview.html = this.html();
    webview.onDidReceiveMessage((message: unknown) => this.#toTau(message));
  }

  /** The directory the agent's tools resolve relative paths against. */
  static workingDirectory(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return null;

    // With one folder open the answer is obvious. With several, the folder
    // containing the active editor's file is the one the user is looking at;
    // falling straight to folders[0] would silently pick a different project.
    const active = vscode.window.activeTextEditor?.document.uri;
    if (active) {
      const owner = vscode.workspace.getWorkspaceFolder(active);
      if (owner) return owner.uri.fsPath;
    }
    return folders[0]?.uri.fsPath ?? null;
  }

  start(): void {
    if (this.#proc) return;
    const config = vscode.workspace.getConfiguration('tau-code');
    const model = config.get<string>('model')?.trim();
    const provider = config.get<string>('provider')?.trim();
    // `~` is not expanded by the shell here -- tau is spawned directly, with no
    // shell in between -- so the setting would land as a literal `~` directory
    // in the workspace. Expanding it is the difference between the setting
    // working as written and silently creating a folder called `~`.
    const sessionDir = expandHome(config.get<string>('sessionDir')?.trim());
    const cwd = TauSession.workingDirectory();

    if (!cwd) {
      // Fail Early: with no folder open there is no honest working directory,
      // and starting in whatever directory the editor happened to launch from
      // would let the agent write somewhere the user never chose.
      this.#tellWebview(
        'No folder is open, so there is no working directory for the agent. ' +
          'Open a folder or workspace and run "tau: Open Agent" again.',
      );
      this.output.warn('Refused to start: no workspace folder is open.');
      return;
    }

    const proc = new TauProcess({
      bin: config.get<string>('binary')?.trim() || 'tau',
      cwd,
      ...(model ? { model } : {}),
      ...(provider ? { provider } : {}),
      ...(sessionDir ? { sessionDir } : {}),
    });

    this.#framer = new LineFramer(
      (value) => {
        void this.#webview.postMessage(value);
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
      if (this.#disposed) return;
      const how = exit.signal !== null ? `killed by ${exit.signal}` : `exited with code ${exit.code}`;
      this.output.warn(`[${this.label}] tau ${how}`);
      this.#tellWebview(`tau ${how}. Run "tau: Restart Agent" to start it again.`);
    });

    this.#proc = proc;
    this.output.info(`[${this.label}] tau started in ${cwd} (pid ${proc.pid ?? '?'}): ${proc.argv.join(' ')}`);
  }

  /** Stop the agent and start a new one, on a fresh page. */
  restart(): void {
    void this.#stop().then(() => {
      if (this.#disposed) return;
      // A fresh page, so the webview's client renegotiates from nothing rather
      // than holding state from a process that no longer exists.
      this.#webview.html = this.html();
      this.start();
    });
  }

  dispose(): void {
    this.#disposed = true;
    void this.#stop();
  }

  #toTau(message: unknown): void {
    const proc = this.#proc;
    if (!proc || !proc.running) {
      this.output.warn(`[${this.label}] a webview message arrived with no running tau; dropped.`);
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

  /**
   * Tell the webview the connection is gone.
   *
   * A stdio transport has no close frame, so the host says so out of band and
   * `VsCodeTransport` turns it into the client's `close`. Without this the
   * webview sits on a dead process looking healthy.
   */
  #tellWebview(reason: string): void {
    void this.#webview.postMessage({
      jsonrpc: '2.0',
      method: 'tau_code/process_exit',
      params: { reason },
    });
  }

  #report(error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    this.output.error(detail);
    this.#tellWebview(`tau could not start: ${detail}`);
    void vscode.window
      .showErrorMessage(`tau could not start: ${detail}`, 'Show log', 'Open settings')
      .then((choice) => {
        if (choice === 'Show log') this.output.show();
        if (choice === 'Open settings') {
          void vscode.commands.executeCommand('workbench.action.openSettings', 'tau-code.binary');
        }
      });
  }

  html(): string {
    const asset = (name: string): vscode.Uri =>
      this.#webview.asWebviewUri(
        vscode.Uri.joinPath(this.context.extensionUri, 'dist-webview', name),
      );
    const nonce = randomBytes(16).toString('base64');

    // `default-src 'none'` and then only what is genuinely needed. Styles need
    // 'unsafe-inline' because the editor injects its theme variables as an
    // inline style block; scripts do not, so they are nonce-gated.
    const csp = [
      `default-src 'none'`,
      `img-src ${this.#webview.cspSource} data:`,
      `style-src ${this.#webview.cspSource} 'unsafe-inline'`,
      `font-src ${this.#webview.cspSource}`,
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
