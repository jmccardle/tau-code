import * as vscode from 'vscode';
import { ServeRelay } from './relay.js';
import type { SessionChoice } from './serve.js';
import type { PageState } from './webview/messages.js';

/**
 * An agent in an editor tab.
 *
 * A `WebviewPanel` sits in the editor area, so it can be split, moved between
 * groups, and dragged to a second window like any other tab -- which is what a
 * transcript beside the code it is editing wants. The sidebar view is the same
 * UI in a narrower place; neither is a wrapper around the other, because
 * `WebviewView` and `WebviewPanel` are different VS Code types that happen to
 * both expose a `Webview`. `ServeRelay` is what they share.
 */
export class ChatPanel implements vscode.Disposable {
  static readonly viewType = 'tau-code.panel';

  static readonly #open = new Set<ChatPanel>();
  static #count = 1;

  #panel: vscode.WebviewPanel;
  #relay: ServeRelay;

  private constructor(
    context: vscode.ExtensionContext,
    output: vscode.LogOutputChannel,
    panel: vscode.WebviewPanel,
    choice: SessionChoice,
  ) {
    this.#panel = panel;
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.svg');

    this.#relay = new ServeRelay(context, output, panel.webview, `tab ${ChatPanel.#count++}`, choice);

    panel.onDidDispose(() => {
      ChatPanel.#open.delete(this);
      this.#relay.dispose();
    });

    ChatPanel.#open.add(this);
  }

  /**
   * Open a new agent tab beside the active editor: on the folder's newest session (`continue`), or
   * on a new one.
   */
  static create(context: vscode.ExtensionContext, output: vscode.LogOutputChannel, choice: SessionChoice): ChatPanel {
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
    return new ChatPanel(context, output, panel, choice);
  }

  /**
   * Rebuild a panel VS Code restored after a window reload.
   *
   * The session DID survive the reload: it is its `tau serve`'s, not the extension
   * host's. The page remembered which one it was on (webview state), and the panel
   * reopens it -- a turn that was running is still running.
   */
  static restore(
    context: vscode.ExtensionContext,
    output: vscode.LogOutputChannel,
    panel: vscode.WebviewPanel,
    state: PageState | undefined,
  ): void {
    new ChatPanel(context, output, panel, state?.session ? { session: state.session } : 'continue');
  }

  /** The focused agent tab, or null when none has focus. */
  static active(): ChatPanel | null {
    for (const panel of ChatPanel.#open) {
      if (panel.#panel.active) return panel;
    }
    return null;
  }

  /** Every agent tab in this window, for a command that acts on whichever has focus. */
  static all(): readonly ChatPanel[] {
    return [...ChatPanel.#open];
  }

  static get count(): number {
    return ChatPanel.#open.size;
  }

  get relay(): ServeRelay {
    return this.#relay;
  }

  restart(): void {
    this.#relay.restart();
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

  async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
    ChatPanel.restore(this.context, this.output, panel, (state ?? undefined) as PageState | undefined);
  }
}
