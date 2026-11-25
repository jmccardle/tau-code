import { randomBytes } from 'node:crypto';
import { hostname, userInfo } from 'node:os';
import * as vscode from 'vscode';
import { EdgeError, HttpTransport } from '@ffwf/tau-code-protocol';
import { versionMismatch, type TauResolution } from './runtime.js';
import { NoServer, startServer, stopServer, type SessionChoice, type Started } from './serve.js';
import type { FromWebview, ToWebview, WebviewContext } from './webview/messages.js';

/**
 * One webview's link to its session's `tau serve`, relayed through the extension host.
 *
 * The webview does not dial the server itself (HE-14): under Remote SSH, WSL or a devcontainer it
 * renders on the user's machine while the server listens on the remote's loopback; and dialling
 * from the page would need the bearer token in the page and τ to allow a `vscode-webview://`
 * origin (`--allow-origin`), which changes per install. So the host holds the serve record, opens
 * the HTTP edge with `HttpTransport` (Node's `fetch`, no Origin), and moves whole JSON-RPC
 * messages both ways without reading them.
 *
 * ## Connections, not a connection
 *
 * The webview asks for a connection (`open`, numbered) and gets messages tagged with that number
 * until it closes. A reconnect is a new number, so a message from a stream the page has already
 * given up on can never be mistaken for one from its replacement.
 *
 * ## Which server
 *
 * One `tau serve` is one session. The first open starts (or finds) it with `choice`; later opens
 * reuse its record, and start it again when it is gone (a detached server exits after ten idle
 * minutes) or its token changed (it was restarted).
 */
export class ServeRelay implements vscode.Disposable {
  #webview: vscode.Webview;
  #choice: SessionChoice;
  #started: Started | null = null;
  #connections = new Map<number, HttpTransport | null>();
  #disposed = false;
  /** The version notice already shown, so a reconnect does not repeat it. */
  #warned: string | null = null;
  /** The incompatible-τ notice already shown. */
  #refused: string | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.LogOutputChannel,
    webview: vscode.Webview,
    private readonly label: string,
    choice: SessionChoice,
  ) {
    this.#webview = webview;
    this.#choice = choice;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist-webview')],
    };
    webview.onDidReceiveMessage((message: FromWebview) => this.#fromWebview(message));
    webview.html = this.html();
  }

  /** The directory sessions start in: the active file's workspace folder, else the first. */
  static workingDirectory(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return null;
    const active = vscode.window.activeTextEditor?.document.uri;
    if (active) {
      const owner = vscode.workspace.getWorkspaceFolder(active);
      if (owner) return owner.uri.fsPath;
    }
    return folders[0]?.uri.fsPath ?? null;
  }

  /** The session this panel is on, once a server has been found. */
  get session(): string | null {
    return this.#started?.record.session ?? null;
  }

  /** The folder this panel's server runs in. */
  get cwd(): string | null {
    return this.#started?.record.cwd ?? ServeRelay.workingDirectory();
  }

  /** Close every connection and reload the page, which opens again (reading the record afresh). */
  restart(): void {
    if (this.#started) this.#choice = { session: this.#started.record.session };
    this.#started = null;
    this.#closeAll();
    this.#webview.html = this.html();
  }

  /** Stop this panel's server (every client of it is disconnected), then reconnect, starting it again. */
  async restartServer(): Promise<void> {
    const session = this.session;
    const cwd = this.cwd;
    if (session && cwd) await stopServer(this.output, cwd, session);
    this.restart();
  }

  dispose(): void {
    this.#disposed = true;
    this.#closeAll();
  }

  #post(message: ToWebview): void {
    void this.#webview.postMessage(message);
  }

  #fromWebview(message: FromWebview): void {
    switch (message.tauCode) {
      case 'open':
        this.#connections.set(message.connection, null);
        void this.#open(message.connection);
        return;
      case 'message': {
        const transport = this.#connections.get(message.connection);
        if (transport) {
          transport.send(message.message as object);
          return;
        }
        // A message for a connection that is not open would never be answered: close it, so the
        // client rejects the call.
        this.#post({
          tauCode: 'closed',
          connection: message.connection,
          reason: 'the connection to tau serve is not open',
          violation: false,
        });
        return;
      }
      case 'close': {
        const transport = this.#connections.get(message.connection);
        this.#connections.delete(message.connection);
        transport?.close();
        return;
      }
      case 'command':
        void vscode.commands.executeCommand(message.command);
        return;
    }
  }

  async #open(connection: number): Promise<void> {
    let transport: HttpTransport;
    try {
      transport = await this.#dial();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.output.error(`[${this.label}] ${reason}`);
      if (error instanceof NoServer && error.resolution && !error.resolution.chosen) this.#offerRuntime(reason);
      if (error instanceof NoServer && error.incompatible) this.#offerChoice(reason);
      const kind = error instanceof EdgeError ? error.kind : 'unavailable';
      if (this.#connections.has(connection)) {
        this.#connections.delete(connection);
        this.#post({ tauCode: 'refused', connection, kind, reason });
      }
      return;
    }
    if (this.#disposed || !this.#connections.has(connection)) {
      // The page gave up on this connection while the server was being found.
      transport.close();
      return;
    }
    this.#connections.set(connection, transport);
    transport.onMessage((message) => this.#post({ tauCode: 'message', connection, message }));
    transport.onClose((reason, violation) => {
      if (this.#connections.get(connection) !== transport) return; // closed by the page
      this.#connections.delete(connection);
      this.output.info(`[${this.label}] connection ${connection} closed: ${reason}`);
      this.#post({ tauCode: 'closed', connection, reason, violation });
    });
    this.output.info(`[${this.label}] connection ${connection} open (stream ${transport.id})`);
    this.#post({ tauCode: 'opened', connection });
  }

  /**
   * Open the HTTP edge of this panel's server, starting it first if need be. A server that has gone
   * (unreachable) or been restarted (its old token refused) is started again once, from its
   * session id; anything else is the answer.
   */
  async #dial(): Promise<HttpTransport> {
    const known = this.#started;
    if (known) {
      try {
        return await this.#edge(known);
      } catch (error) {
        if (!(error instanceof EdgeError) || (error.kind !== 'unreachable' && error.kind !== 'unauthorized')) throw error;
        this.output.info(`[${this.label}] ${error.message}; asking tau serve -d again.`);
        this.#choice = { session: known.record.session };
        this.#started = null;
      }
    }
    return this.#edge(await this.#start());
  }

  #edge(started: Started): Promise<HttpTransport> {
    return HttpTransport.open({ url: started.record.url, token: started.record.token });
  }

  async #start(): Promise<Started> {
    const cwd = ServeRelay.workingDirectory();
    if (!cwd) {
      throw new NoServer('tau needs a working directory: open a folder, then "tau: Reconnect to tau serve".', null);
    }
    const started = await startServer(this.output, cwd, this.#choice);
    if (started.replaced) {
      void vscode.window.showInformationMessage(
        `tau has no session ${started.replaced} any more (a session is saved at its first message), so this panel started ${started.record.session}.`,
      );
    }
    this.#started = started;
    this.#choice = { session: started.record.session };
    this.#compareVersions(started.resolution, started.record.version);
    return started;
  }

  /**
   * Say so when the τ serving is not the τ this window would start, or when two τs are installed
   * and disagree. `-d` reuses a server that is already running, whichever τ started it, which is
   * right (one server per session) and exactly the case worth a sentence.
   */
  #compareVersions(resolution: TauResolution, serving: string): void {
    const chosen = resolution.chosen;
    let text: string | null = null;
    let action: { label: string; command: string } | null = null;
    if (chosen?.version && chosen.version !== serving) {
      text =
        `This panel is served by tau ${serving}, a server that was already running. This window would start ` +
        `tau ${chosen.version}, from ${chosen.where}, once that server stops.`;
      action = { label: 'Restart the server', command: 'tau-code.restartDaemon' };
    } else {
      text = versionMismatch(resolution);
      action = text ? { label: 'Choose', command: 'tau-code.chooseRuntime' } : null;
    }
    if (!text || text === this.#warned) return;
    this.#warned = text;
    this.output.warn(`[${this.label}] ${text}`);
    void vscode.window.showWarningMessage(text, ...(action ? [action.label] : [])).then((picked) => {
      if (action && picked === action.label) void vscode.commands.executeCommand(action.command);
    });
  }

  #offerRuntime(reason: string): void {
    const install = 'Install the runtime extension';
    void vscode.window.showWarningMessage(reason, install).then((picked) => {
      if (picked === install) void vscode.commands.executeCommand('tau-code.installRuntime');
    });
  }

  /**
   * A τ that speaks another protocol (a stale tau runtime, an old τ on PATH): said once per panel as
   * a notification too, because the fix is in the editor's settings, not in the page.
   */
  #offerChoice(reason: string): void {
    if (this.#refused === reason) return;
    this.#refused = reason;
    const choose = 'Choose Which tau';
    const log = 'Show Log';
    void vscode.window.showErrorMessage(reason, choose, log).then((picked) => {
      if (picked === choose) void vscode.commands.executeCommand('tau-code.chooseRuntime');
      if (picked === log) void vscode.commands.executeCommand('tau-code.showLog');
    });
  }

  #closeAll(): void {
    const transports = [...this.#connections.values()];
    this.#connections.clear();
    for (const transport of transports) transport?.close();
  }

  html(): string {
    const asset = (name: string): vscode.Uri =>
      this.#webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist-webview', name));
    const nonce = randomBytes(16).toString('base64');
    const context: WebviewContext = { where: `${safeUser()}@${hostname()}` };

    // `default-src 'none'` and then only what is needed. Styles need 'unsafe-inline' because the
    // editor injects its theme variables as an inline style block; scripts do not, so they are
    // nonce-gated. There is no `connect-src`: the page opens no connection, the host does.
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
      html, body, #root { height: 100%; margin: 0; padding: 0; }
    </style>
  </head>
  <body>
    <div id="root" data-context="${escapeAttribute(JSON.stringify(context))}"></div>
    <script nonce="${nonce}" type="module" src="${asset('webview.js').toString()}"></script>
  </body>
</html>`;
  }
}

function safeUser(): string {
  try {
    return userInfo().username;
  } catch {
    // No passwd entry (some containers): the id is still unique by its random part.
    return 'user';
  }
}

function escapeAttribute(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
