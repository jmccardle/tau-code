import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Chat, useConversation, useTauConnection, type HostNotice } from '@ffwf/tau-code-ui';
import '@ffwf/tau-code-ui/styles.css';
import { VsCodeTransport } from './vscode-transport.js';

function App(): JSX.Element {
  const transport = useMemo(() => new VsCodeTransport(), []);
  const { client, conversation, phase, detail, capabilities } = useTauConnection(transport);
  const state = useConversation(conversation);

  // What the extension host decided before any tau existed: which one it ran,
  // and what else it found. Accumulated by id, so a restart replacing a notice
  // does not stack two of them.
  const [notices, setNotices] = useState<readonly HostNotice[]>([]);
  useEffect(() => {
    transport.onNotice((notice) => {
      setNotices((was) => [...was.filter((old) => old.id !== notice.id), notice]);
    });
  }, [transport]);

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
      notices={notices}
      // The webview cannot run an editor command itself. It says which one it
      // wants and the host runs it, which is the same relay the rest of this
      // file is built on.
      onNoticeAction={(notice) => {
        if (notice.action) transport.send({ jsonrpc: '2.0', method: notice.action.command });
      }}
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
