import * as vscode from 'vscode';
import { ChatPanel, ChatPanelSerializer } from './chat-panel.js';
import { ChatViewProvider } from './chat-view.js';
import { describe, invalidate, RUNTIME_EXTENSION_ID, tauRuntime } from './runtime.js';
import { TauSession } from './session.js';

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

    // Bring agent tabs back after a window reload. The process does not
    // survive; the serializer starts a fresh one rather than faking a reattach.
    vscode.window.registerWebviewPanelSerializer(
      ChatPanel.viewType,
      new ChatPanelSerializer(context, output),
    ),

    vscode.commands.registerCommand('tau-code.open', () => {
      if (!TauSession.workingDirectory()) {
        void vscode.window
          .showWarningMessage(
            'tau needs a working directory. Open the project folder first.',
            'Open folder',
          )
          .then((choice) => {
            if (choice === 'Open folder') void vscode.commands.executeCommand('vscode.openFolder');
          });
        return;
      }
      ChatPanel.create(context, output);
    }),

    // Offered by the banner when nothing was found. It is `installExtension` and
    // not a link to the listing, because the answer to "there is no tau" should
    // be one click rather than a browser tab and a search.
    vscode.commands.registerCommand('tau-code.installRuntime', async () => {
      if (vscode.extensions.getExtension(RUNTIME_EXTENSION_ID)) {
        void vscode.window.showInformationMessage(
          `${RUNTIME_EXTENSION_ID} is already installed. Run "tau: Restart Agent" to use it.`,
        );
        return;
      }
      try {
        await vscode.commands.executeCommand('workbench.extensions.installExtension', RUNTIME_EXTENSION_ID);
        invalidate();
        void vscode.window.showInformationMessage(
          'The tau runtime is installed. Run "tau: Restart Agent" to use it.',
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
        `tau-code.runtime is now "${choice.label}". Run "tau: Restart Agent" to apply it.`,
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
      if (sidebar.isLive) {
        sidebar.restart();
        return;
      }
      void vscode.window.showInformationMessage('No tau agent is open. Run "tau: Open Agent".');
    }),

    vscode.commands.registerCommand('tau-code.showLog', () => output.show()),
  );
}

export function deactivate(): void {
  // Every disposable is registered on the context, including each agent
  // process, so the editor's own teardown reaps them.
}
