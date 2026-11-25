import * as vscode from 'vscode';
import { ChatPanel, ChatPanelSerializer } from './chat-panel.js';
import { ChatViewProvider } from './chat-view.js';
import { describe, invalidate, RUNTIME_EXTENSION_ID, tauRuntime } from './runtime.js';
import { ServeRelay } from './relay.js';
import type { SessionChoice } from './serve.js';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('tau', { log: true });
  context.subscriptions.push(output);

  const sidebar = new ChatViewProvider(context, output);

  context.subscriptions.push(
    sidebar,

    // Which tau is a cached answer, and these are the three things that can
    // change it: a setting, an extension being installed or removed, and the
    // user asking for a restart because they just did one of those.
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration('tau-code.binary') ||
        event.affectsConfiguration('tau-code.runtime')
      ) {
        invalidate();
      }
    }),
    vscode.extensions.onDidChange(() => invalidate()),

    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, sidebar, {
      // The agent keeps running while the panel is hidden either way. Retaining
      // the DOM only avoids re-pulling the transcript when the user returns.
      webviewOptions: { retainContextWhenHidden: true },
    }),

    // Bring agent tabs back after a window reload. The session lives in its
    // `tau serve`, so the restored tab reopens the one it was showing.
    vscode.window.registerWebviewPanelSerializer(
      ChatPanel.viewType,
      new ChatPanelSerializer(context, output),
    ),

    // The folder's newest session (or a new one, in a folder with none), and a
    // new session. One `tau serve` is one session, so each tab is one session;
    // two tabs on the same session are two clients of one server.
    vscode.commands.registerCommand('tau-code.open', () => openPanel(context, output, 'continue')),
    vscode.commands.registerCommand('tau-code.newSession', () => openPanel(context, output, 'new')),

    // Offered by the banner when nothing was found. It is `installExtension` and
    // not a link to the listing, because the answer to "there is no tau" should
    // be one click rather than a browser tab and a search.
    vscode.commands.registerCommand('tau-code.installRuntime', async () => {
      if (vscode.extensions.getExtension(RUNTIME_EXTENSION_ID)) {
        void vscode.window.showInformationMessage(
          `${RUNTIME_EXTENSION_ID} is already installed. It starts the server the next time none is running.`,
        );
        return;
      }
      try {
        await vscode.commands.executeCommand('workbench.extensions.installExtension', RUNTIME_EXTENSION_ID);
        invalidate();
        void vscode.window.showInformationMessage(
          'The tau runtime is installed. It starts the server the next time none is running; "tau: Reconnect to tau serve" checks now.',
        );
      } catch (error) {
        // Named rather than swallowed: the usual cause is a marketplace with no
        // build for this platform, and "nothing happened" is the worst possible
        // rendering of that.
        const detail = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Could not install ${RUNTIME_EXTENSION_ID}: ${detail}`);
      }
    }),

    // Offered by the banner when two taus disagree. It shows what was found, so
    // the choice is made while looking at both versions rather than from memory.
    vscode.commands.registerCommand('tau-code.chooseRuntime', async () => {
      const resolution = await tauRuntime(output);
      const choice = await vscode.window.showQuickPick(
        [
          {
            label: 'auto',
            description: 'The bundled runtime when it is installed, otherwise tau on PATH',
            detail: describe(resolution),
          },
          { label: 'bundled', description: 'Only the tau runtime extension. An error when it is absent.' },
          { label: 'system', description: 'Only tau on PATH or a configured path. Ignore the runtime extension.' },
        ],
        { title: 'Which tau should this extension run?', placeHolder: 'tau-code.runtime' },
      );
      if (!choice) return;
      await vscode.workspace
        .getConfiguration('tau-code')
        .update('runtime', choice.label, vscode.ConfigurationTarget.Global);
      invalidate();
      void vscode.window.showInformationMessage(
        `tau-code.runtime is now "${choice.label}". It applies the next time a server starts; a server already running keeps running.`,
      );
    }),

    vscode.commands.registerCommand('tau-code.restart', () => {
      // The user's reason for restarting is often that they changed which tau
      // is installed, so the cached decision is dropped before anything starts.
      invalidate();
      // The focused tab if there is one, otherwise the sidebar. Restarting
      // something the user cannot see would be worse than doing nothing.
      const panel = ChatPanel.active();
      if (panel) {
        panel.restart();
        return;
      }
      if (sidebar.relay) {
        sidebar.restart();
        return;
      }
      void vscode.window.showInformationMessage('No tau panel is open. Run "tau: Open Agent".');
    }),

    // Stop the focused panel's server and start this window's τ in its place.
    // Offered by the notice that says another τ is serving. Modal, because the
    // server is shared: every editor tab, browser tab and `tau -c` on that
    // session is disconnected, and a running step is stopped.
    vscode.commands.registerCommand('tau-code.restartDaemon', async () => {
      // The focused tab; else the only tab; else the sidebar.
      const tabs = ChatPanel.all();
      const relay = (ChatPanel.active() ?? (tabs.length === 1 ? tabs[0] : null))?.relay ?? sidebar.relay;
      if (!relay?.session) {
        void vscode.window.showInformationMessage('No tau panel is connected to a server. Run "tau: Open Agent".');
        return;
      }
      const confirm = 'Restart';
      const choice = await vscode.window.showWarningMessage(
        `Restart the tau server of session ${relay.session}?`,
        {
          modal: true,
          detail:
            'Every client of it (other editor tabs and windows, browser tabs, tau -c) is disconnected and ' +
            'reconnects to the new one. A step that is running is stopped. The session is kept.',
        },
        confirm,
      );
      if (choice !== confirm) return;
      invalidate();
      try {
        await relay.restartServer();
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        output.error(`Could not stop the server: ${detail}`);
        void vscode.window.showErrorMessage(`Could not stop the tau server: ${detail}`);
      }
    }),

    vscode.commands.registerCommand('tau-code.showLog', () => output.show()),
  );
}

function openPanel(context: vscode.ExtensionContext, output: vscode.LogOutputChannel, choice: SessionChoice): void {
  if (!ServeRelay.workingDirectory()) {
    void vscode.window
      .showWarningMessage('tau needs a working directory. Open the project folder first.', 'Open folder')
      .then((picked) => {
        if (picked === 'Open folder') void vscode.commands.executeCommand('vscode.openFolder');
      });
    return;
  }
  ChatPanel.create(context, output, choice);
}

export function deactivate(): void {
  // Every disposable is registered on the context. Servers are left running:
  // a detached `tau serve` outlives its clients and exits after ten idle minutes.
}
