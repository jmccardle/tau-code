import * as vscode from 'vscode';
import { TauSession } from './session.js';

/**
 * The agent in the sidebar.
 *
 * Same UI as the editor tab, in a narrower place. VS Code creates the webview
 * lazily -- `resolveWebviewView` runs the first time the view is actually
 * shown -- so no tau process is started for a sidebar the user never opens.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = 'tau-code.chat';

  #session: TauSession | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.LogOutputChannel,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    const session = new TauSession(this.context, this.output, view.webview, 'sidebar');
    this.#session = session;
    session.start();

    view.onDidDispose(() => {
      if (this.#session === session) this.#session = null;
      session.dispose();
    });
  }

  /** True once the user has actually opened the sidebar view. */
  get isLive(): boolean {
    return this.#session !== null;
  }

  restart(): void {
    this.#session?.restart();
  }

  dispose(): void {
    this.#session?.dispose();
    this.#session = null;
  }
}
