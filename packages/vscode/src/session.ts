import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import WebSocket from 'ws';
import { CLOSE_NOTHING_TO_DIAL } from '@ffwf/tau-code-protocol';
import { findDaemon, forgetDaemon, NoDaemon, socketUrl } from './daemon.js';
import { versionMismatch, type TauResolution } from './runtime.js';
import type { FromWebview, HostNotice, ToWebview, WebviewContext } from './webview/messages.js';

/** One slot for "which τ": what is installed, replaced by what is serving once that is known. */
const VERSION_NOTICE = 'tau-version';

/**
 * One webview's link to `tau serve`, relayed through the extension host.
 *
 * The webview cannot dial the daemon itself: under Remote SSH, WSL or a
 * devcontainer it renders on the user's machine while the daemon runs next to
 * the files, and even locally a webview's origin is not one the daemon would
 * accept. So the host dials -- from Node, which sends no Origin header -- and
 * moves frames both ways without reading them.
 *
 * ## Connections, not a connection
 *
 * The webview asks for a connection (`open`, numbered) and gets frames tagged
 * with that number until it closes. A reconnect is a new number, so a frame
 * from a socket the webview has already given up on can never be mistaken for
 * one from its replacement.
 *
 * ## A request is answered, never dropped
 *
 * The client in the webview waits on requests with no deadline, because a turn
 * takes as long as it takes. A relay that dropped a request would leave it
 * waiting forever. So when there is nothing to dial, the relay CLOSES the
 * connection with the reason -- which rejects every pending request with that
 * sentence -- and uses `CLOSE_NOTHING_TO_DIAL`, so the webview knows a retry
 * would give the same answer until the user changes something.
 *
 * **Many panels, one daemon, shared sessions.** Unlike the RPC child each
 * panel used to own, the daemon holds the sessions; two panels on the same
 * session both see it and both can drive it, as the TUI under `--connect` can.
 */
export class DaemonRelay implements vscode.Disposable {
  #webview: vscode.Webview;
  /**
   * Every connection the webview has asked for and not closed. `socket` is
   * null while the daemon is being found and dialled; frames that arrive then
   * wait in `queue`, because the webview says `hello` in the same tick it asks
   * for the connection.
   */
  #connections = new Map<number, { socket: WebSocket | null; queue: string[] }>();
  #disposed = false;
  /** Notices from the last daemon lookup, re-sent to a reloaded page. */
  #notices: HostNotice[] = [];
  /** Which τ this window would start, from the last lookup. */
  #resolution: TauResolution | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.LogOutputChannel,
    webview: vscode.Webview,
    private readonly label: string,
  ) {
    this.#webview = webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist-webview')],
    };
    webview.onDidReceiveMessage((message: FromWebview) => this.#fromWebview(message));
    webview.html = this.html();
  }

  /** The directory new sessions are created in: the active file's folder, else the first. */
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

  /** Close every connection and reload the page, which dials again. */
  restart(): void {
    forgetDaemon();
    this.#closeAll('restarting');
    this.#webview.html = this.html();
  }

  dispose(): void {
    this.#disposed = true;
    this.#closeAll('the panel closed');
  }

  #post(message: ToWebview): void {
    void this.#webview.postMessage(message);
  }

  #fromWebview(message: FromWebview): void {
    switch (message.tauCode) {
      case 'open':
        this.#connections.set(message.connection, { socket: null, queue: [] });
        void this.#open(message.connection);
        return;
      case 'frame': {
        const connection = this.#connections.get(message.connection);
        const text = JSON.stringify(message.frame);
        if (connection?.socket?.readyState === WebSocket.OPEN) {
          connection.socket.send(text);
          return;
        }
        if (connection && (connection.socket === null || connection.socket.readyState === WebSocket.CONNECTING)) {
          connection.queue.push(text);
          return;
        }
        // A frame for a connection that is gone is a request that would never
        // be answered. Close that connection, so the client rejects it.
        this.#post({
          tauCode: 'closed',
          connection: message.connection,
          reason: 'The connection to tau serve is not open.',
          code: null,
        });
        return;
      }
      case 'close': {
        const connection = this.#connections.get(message.connection);
        this.#connections.delete(message.connection);
        connection?.socket?.close(1000, 'client closed');
        return;
      }
      case 'command':
        void vscode.commands.executeCommand(message.command, ...(message.argument === undefined ? [] : [message.argument]));
        return;
      case 'daemon':
        this.#compareDaemon(message.version, message.pid);
        return;
    }
  }

  async #open(connection: number): Promise<void> {
    let url: string;
    try {
      const found = await findDaemon(this.output);
      this.#noticesFor(found.resolution);
      url = socketUrl(found.start.address);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.output.error(`[${this.label}] ${reason}`);
      if (error instanceof NoDaemon && error.resolution && !error.resolution.chosen) {
        this.#notices = [
          {
            id: 'tau-missing',
            level: 'warn',
            text: reason,
            action: { label: 'Install the runtime extension', command: 'tau-code.installRuntime' },
          },
        ];
        this.#flushNotices();
      }
      this.#connections.delete(connection);
      this.#post({ tauCode: 'closed', connection, reason, code: CLOSE_NOTHING_TO_DIAL });
      return;
    }
    const entry = this.#connections.get(connection);
    // The webview gave up on this connection while the daemon was being found.
    if (this.#disposed || !entry) return;

    const socket = new WebSocket(url, { maxPayload: 0 });
    entry.socket = socket;
    let opened = false;

    socket.on('open', () => {
      opened = true;
      this.output.info(`[${this.label}] connection ${connection} open to ${url}`);
      for (const text of entry.queue.splice(0)) socket.send(text);
    });
    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        this.output.warn(`[${this.label}] the daemon sent a binary frame; dropped.`);
        return;
      }
      let frame: unknown;
      try {
        frame = JSON.parse(data.toString());
      } catch {
        this.output.error(`[${this.label}] the daemon sent an unparseable frame: ${data.toString().slice(0, 400)}`);
        return;
      }
      this.#post({ tauCode: 'frame', connection, frame });
    });
    socket.on('error', (error) => {
      this.output.warn(`[${this.label}] connection ${connection}: ${error.message}`);
    });
    socket.on('close', (code, reasonBuffer) => {
      if (this.#connections.get(connection)?.socket !== socket) return; // closed by the webview
      this.#connections.delete(connection);
      if (!opened) {
        // The address went stale: the daemon stopped since it was found. Ask
        // τ again on the next open, which starts one if none answers.
        forgetDaemon();
      }
      const reason = opened
        ? `tau serve closed the connection (code ${code}${reasonBuffer.length ? `: ${reasonBuffer.toString()}` : ''}).`
        : `Could not connect to tau serve at ${url}.`;
      this.#post({ tauCode: 'closed', connection, reason, code });
    });
  }

  /**
   * Say so when the daemon answering is not the τ this window would start.
   *
   * `tau serve -d` reuses a daemon that is already running, whichever τ
   * started it -- last week's PATH install, say, while the bundled runtime is
   * newer. That is the right behaviour (one daemon per store), and it is
   * exactly the "two τs" case the banner exists for, so it is reported against
   * the τ that is actually serving rather than the one that was resolved.
   */
  #compareDaemon(version: string, pid: number): void {
    const chosen = this.#resolution?.chosen;
    if (!chosen || chosen.version === null || chosen.version === version) return;
    // The same id as the "two taus installed" notice, so it takes that one's
    // place: once the daemon has said hello, which τ is SERVING is the fact,
    // and which one this window would start is the footnote.
    const notice: HostNotice = {
      id: VERSION_NOTICE,
      level: 'warn',
      text:
        `This panel is served by τ ${version}, a daemon that was already running (pid ${pid}). ` +
        `This window would start τ ${chosen.version}, from ${chosen.where}, once that daemon stops.`,
      action: { label: 'Restart', command: 'tau-code.restartDaemon' },
    };
    this.#notices = [...this.#notices.filter((old) => old.id !== VERSION_NOTICE), notice];
    this.output.warn(`[${this.label}] ${notice.text}`);
    this.#flushNotices();
  }

  #noticesFor(resolution: TauResolution): void {
    this.#resolution = resolution;
    const mismatch = versionMismatch(resolution);
    this.#notices = mismatch
      ? [
          {
            id: VERSION_NOTICE,
            level: 'warn',
            text: mismatch,
            action: { label: 'Choose', command: 'tau-code.chooseRuntime' },
          },
        ]
      : [];
    this.#flushNotices();
  }

  #flushNotices(): void {
    for (const notice of this.#notices) this.#post({ tauCode: 'notice', notice });
  }

  #closeAll(reason: string): void {
    const connections = [...this.#connections.values()];
    this.#connections.clear();
    for (const { socket } of connections) socket?.close(1000, reason);
  }

  html(): string {
    const asset = (name: string): vscode.Uri =>
      this.#webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist-webview', name));
    const nonce = randomBytes(16).toString('base64');
    const config = vscode.workspace.getConfiguration('tau-code');
    const context: WebviewContext = {
      cwd: DaemonRelay.workingDirectory(),
      model: config.get<string>('model')?.trim() || null,
      token: config.get<string>('token')?.trim() || null,
    };

    // `default-src 'none'` and then only what is genuinely needed. Styles need
    // 'unsafe-inline' because the editor injects its theme variables as an
    // inline style block; scripts do not, so they are nonce-gated. There is no
    // `connect-src`: the webview opens no socket, the host does.
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
    <div id="root" data-context="${escapeAttribute(JSON.stringify(context))}"></div>
    <script nonce="${nonce}" type="module" src="${asset('webview.js').toString()}"></script>
  </body>
</html>`;
  }
}

function escapeAttribute(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
