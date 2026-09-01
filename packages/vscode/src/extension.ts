import * as vscode from 'vscode';
import { ChatViewProvider } from './chat-view.js';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('tau', { log: true });
  context.subscriptions.push(output);

  const provider = new ChatViewProvider(context, output);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider, {
      // The agent keeps running while the panel is hidden, and its state lives
      // in the extension host either way. Retaining the webview's DOM only
      // avoids a re-pull of the transcript when the user comes back.
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('tau-code.restart', () => provider.restart()),
    vscode.commands.registerCommand('tau-code.showLog', () => output.show()),
    provider,
  );
}

export function deactivate(): void {
  // Every disposable is registered on the context, including the agent process.
}
