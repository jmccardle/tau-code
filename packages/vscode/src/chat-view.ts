import * as vscode from 'vscode';
import { ServeRelay } from './relay.js';
import type { PageState } from './webview/messages.js';

/**
 * The agent in the sidebar.
 *
 * Same UI as the editor tab, in a narrower place. VS Code creates the webview lazily --
 * `resolveWebviewView` runs the first time the view is actually shown -- so a sidebar the user
 * never opens never starts a server. It opens the folder's newest session, or the one it showed
 * before a reload.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = 'tau-code.chat';

  #relay: ServeRelay | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.LogOutputChannel,
  ) {}

  resolveWebviewView(view: vscode.WebviewView, context: vscode.WebviewViewResolveContext<unknown>): void {
    const state = context.state as PageState | undefined;
    const relay = new ServeRelay(
      this.context,
      this.output,
      view.webview,
      'sidebar',
      state?.session ? { session: state.session } : 'continue',
    );
    this.#relay = relay;

    view.onDidDispose(() => {
      if (this.#relay === relay) this.#relay = null;
      relay.dispose();
    });
  }

  /** The sidebar's relay, once the user has opened the view. */
  get relay(): ServeRelay | null {
    return this.#relay;
  }

  restart(): void {
    this.#relay?.restart();
  }

  dispose(): void {
    this.#relay?.dispose();
    this.#relay = null;
  }
}
