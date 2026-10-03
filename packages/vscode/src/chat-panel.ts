import * as vscode from 'vscode';
import { DaemonRelay } from './session.js';

/**
 * An agent in an editor tab.
 *
 * A `WebviewPanel` sits in the editor area, so it can be split, moved between
 * groups, and dragged to a second window like any other tab -- which is what a
 * transcript beside the code it is editing wants. The sidebar view is the same
 * UI in a narrower place; neither is a wrapper around the other, because
 * `WebviewView` and `WebviewPanel` are different VS Code types that happen to
 * both expose a `Webview`. `DaemonRelay` is what they share.
 */
export class ChatPanel implements vscode.Disposable {
  static readonly viewType = 'tau-code.panel';

  static readonly #open = new Set<ChatPanel>();

  #panel: vscode.WebviewPanel;
  #session: DaemonRelay;

  private constructor(
    context: vscode.ExtensionContext,
    output: vscode.LogOutputChannel,
    panel: vscode.WebviewPanel,
  ) {
    this.#panel = panel;
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.svg');

    this.#session = new DaemonRelay(context, output, panel.webview, `tab ${panel.title}`);

    panel.onDidDispose(() => {
      ChatPanel.#open.delete(this);
      this.#session.dispose();
    });

    ChatPanel.#open.add(this);
  }

  /** Open a new agent tab beside the active editor. */
  static create(context: vscode.ExtensionContext, output: vscode.LogOutputChannel): ChatPanel {
    const panel = vscode.window.createWebviewPanel(
      ChatPanel.viewType,
      'tau',
      // Beside, not on top of, the code the agent is working on. That is the
      // whole reason to be in an editor tab rather than the sidebar.
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      {
        enableScripts: true,
        // The agent keeps running while the tab is in the background either
        // way; retaining the DOM only avoids re-pulling the transcript when
        // the user comes back to it.
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'dist-webview'),
          vscode.Uri.joinPath(context.extensionUri, 'media'),
        ],
      },
    );
    return new ChatPanel(context, output, panel);
  }

  /**
   * Rebuild a panel VS Code restored after a window reload.
   *
   * The session DID survive the reload: it is the daemon's, not the extension
   * host's. The page remembers which one it was on (webview state), and
   * re-attaches to it -- a turn that was running is still running.
   */
  static restore(
    context: vscode.ExtensionContext,
    output: vscode.LogOutputChannel,
    panel: vscode.WebviewPanel,
  ): void {
    new ChatPanel(context, output, panel);
  }

  /** The focused agent tab, or null when none has focus. */
  static active(): ChatPanel | null {
    for (const panel of ChatPanel.#open) {
      if (panel.#panel.active) return panel;
    }
    return null;
  }

  /** Every agent tab in this window, for a restart that replaces the daemon under all of them. */
  static all(): readonly ChatPanel[] {
    return [...ChatPanel.#open];
  }

  static get count(): number {
    return ChatPanel.#open.size;
  }

  restart(): void {
    this.#session.restart();
  }

  reveal(): void {
    this.#panel.reveal();
  }

  dispose(): void {
    this.#panel.dispose();
  }
}

/** Lets VS Code bring agent tabs back after a window reload. */
export class ChatPanelSerializer implements vscode.WebviewPanelSerializer {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.LogOutputChannel,
  ) {}

  async deserializeWebviewPanel(panel: vscode.WebviewPanel): Promise<void> {
    ChatPanel.restore(this.context, this.output, panel);
  }
}
