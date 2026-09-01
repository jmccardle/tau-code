import { StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import type { Transport } from '@ffwf/tau-code-protocol';
import { Chat, useConversation, useTauConnection } from '@ffwf/tau-code-ui';
import '@ffwf/tau-code-ui/styles.css';
import { VsCodeTransport } from './vscode-transport.js';

function App(): JSX.Element {
  const transport = useMemo<Transport>(() => new VsCodeTransport(), []);
  const { client, conversation, phase, detail, capabilities } = useTauConnection(transport);
  const state = useConversation(conversation);

  // Enter inserts a newline and Ctrl+Enter sends, matching tau's own TUI
  // default (`enter_key: "newline"`, docs/ENTER-KEY.md). An agent prompt is
  // usually several lines, and the editor this sits beside treats Enter the
  // same way.
  return (
    <Chat
      client={client}
      conversation={conversation}
      phase={phase}
      detail={detail}
      state={state}
      capabilities={capabilities}
      disconnectedHint='Run "tau: Show Agent Log" from the command palette for the full output.'
      enterSubmits={false}
    />
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('The webview HTML has no #root element.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
