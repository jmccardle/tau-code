import * as vscode from 'vscode';
import { TauSession } from './session.js';

/**
 * An agent in an editor tab.
 *
 * A `WebviewPanel` sits in the editor area, so it can be split, moved between
 * groups, and dragged to a second window like any other tab -- which is what a
 * transcript beside the code it is editing wants. The sidebar view is the same
 * UI in a narrower place; neither is a wrapper around the other, because
 * `WebviewView` and `WebviewPanel` are different VS Code types that happen to
 * both expose a `Webview`. `TauSession` is what they share.
 */
export class ChatPanel implements vscode.Disposable {
  static readonly viewType = 'tau-code.panel';

  static readonly #open = new Set<ChatPanel>();

  #panel: vscode.WebviewPanel;
  #session: TauSession;

  private constructor(
    context: vscode.ExtensionContext,
    output: vscode.LogOutputChannel,
    panel: vscode.WebviewPanel,
    start: boolean,
  ) {
    this.#panel = panel;
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.svg');

    this.#session = new TauSession(context, output, panel.webview, `tab ${panel.title}`);
    if (start) this.#session.start();

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
    return new ChatPanel(context, output, panel, true);
  }

  /**
   * Rebuild a panel VS Code restored after a window reload.
   *
   * The agent process did NOT survive the reload -- it was a child of the old
   * extension host. So this starts a new one rather than pretending to
   * reattach. The transcript is not lost: it is in tau's session store, and a
   * later `switch_session` reaches it.
   */
  static restore(
    context: vscode.ExtensionContext,
    output: vscode.LogOutputChannel,
    panel: vscode.WebviewPanel,
  ): void {
    const restored = new ChatPanel(context, output, panel, false);
    restored.#session.start();
  }

  /** The focused agent tab, or null when none has focus. */
  static active(): ChatPanel | null {
    for (const panel of ChatPanel.#open) {
      if (panel.#panel.active) return panel;
    }
    return null;
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
