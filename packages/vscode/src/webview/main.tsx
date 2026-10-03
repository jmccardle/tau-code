import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Transport } from '@ffwf/tau-code-protocol';
import { Chat, useDaemon, type HostNotice } from '@ffwf/tau-code-ui';
import '@ffwf/tau-code-ui/styles.css';
import type { WebviewContext } from './messages.js';
import { Relay } from './vscode-transport.js';

/** One per page: `acquireVsCodeApi()` throws if called twice. */
const relay = new Relay();

function readContext(root: HTMLElement): WebviewContext {
  const raw = root.dataset['context'];
  if (!raw) throw new Error('The webview page carries no context; the host wrote it without one.');
  return JSON.parse(raw) as WebviewContext;
}

function App({ context }: { context: WebviewContext }): JSX.Element {
  const open = useCallback((): Transport => relay.open(), []);
  const { daemon, state } = useDaemon(open, 'tau-code-vscode', context.token);

  // What the extension host decided before any daemon was dialled: which τ it
  // ran, and what else it found. Accumulated by id, so a restart replacing a
  // notice does not stack two of them.
  const [notices, setNotices] = useState<readonly HostNotice[]>([]);
  useEffect(() => {
    relay.onNotice((notice) => {
      setNotices((was) => [...was.filter((old) => old.id !== notice.id), notice]);
    });
  }, []);

  const remembered = useMemo(() => relay.rememberedSession, []);

  // Enter inserts a newline and Ctrl+Enter sends, matching τ's own TUI
  // default (`enter_key: "newline"`, docs/ENTER-KEY.md). An agent prompt is
  // usually several lines, and the editor this sits beside treats Enter the
  // same way.
  return (
    <Chat
      daemon={daemon}
      daemonState={state}
      defaultCwd={context.cwd}
      defaultModel={context.model}
      initialSession={remembered}
      onSessionChanged={(sessionId) => relay.remember(sessionId)}
      disconnectedHint='Run "tau: Show Agent Log" from the command palette for what the extension tried.'
      enterSubmits={false}
      notices={notices}
      // The webview cannot run an editor command itself. It says which one it
      // wants and the host runs it.
      onNoticeAction={(notice) => {
        if (notice.action) relay.command(notice.action.command, notice.action.argument);
      }}
    />
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('The webview HTML has no #root element.');

createRoot(root).render(
  <StrictMode>
    <App context={readContext(root)} />
  </StrictMode>,
);
