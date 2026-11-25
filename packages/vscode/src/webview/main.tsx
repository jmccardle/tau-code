import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SessionLink } from '@ffwf/tau-code-protocol';
import { TauApp } from '@ffwf/tau-code-ui';
import '@ffwf/tau-code-ui/styles.css';
import type { WebviewContext } from './messages.js';
import { Relay } from './vscode-transport.js';

/**
 * The editor's page: the same `TauApp` the browser client mounts, over a `SessionLink` whose
 * transport is the extension host's relay instead of `fetch`. Everything editor-specific is here.
 */

const root = document.getElementById('root');
if (!root) throw new Error('The webview HTML has no #root element.');
const raw = root.dataset['context'];
if (!raw) throw new Error('The webview page carries no context; the host wrote it without one.');
const context = JSON.parse(raw) as WebviewContext;

/** One per page: `acquireVsCodeApi()` throws if called twice. */
const relay = new Relay();

// Stable across reloads of this page (a question addressed to it still reaches it), different per
// panel: `vscode@<user@host>:<random>`.
let client = relay.state.client;
if (!client) {
  client = `vscode@${context.where}:${crypto.randomUUID().slice(0, 8)}`;
  relay.remember({ client });
}

const link = new SessionLink({ open: () => relay.open(), client });
// The session this panel shows, for the host to reopen after a window reload.
let session: string | null = null;
link.subscribe((state) => {
  const now = state.welcome?.session ?? null;
  if (now && now !== session) {
    session = now;
    relay.remember({ session: now });
  }
});
link.start();

const showLog = 'Run "tau: Show Agent Log" from the command palette for what the extension ran.';
const hints = {
  unavailable: showLog,
  unauthorized: `The server's token changed under this panel. "tau: Reconnect to tau serve" reads it again. ${showLog}`,
  'not-an-edge': showLog,
};

createRoot(root).render(
  <StrictMode>
    <TauApp link={link} hints={hints} />
  </StrictMode>,
);
