import * as vscode from 'vscode';
import { ChatPanel, ChatPanelSerializer } from './chat-panel.js';
import { ChatViewProvider } from './chat-view.js';
import { TauSession } from './session.js';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('tau', { log: true });
  context.subscriptions.push(output);

  const sidebar = new ChatViewProvider(context, output);

  context.subscriptions.push(
    sidebar,

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

    vscode.commands.registerCommand('tau-code.restart', () => {
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
