import { StrictMode, useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Transport } from '@ffwf/tau-code-protocol';
import { Chat, useDaemon } from '@ffwf/tau-code-ui';
import '@ffwf/tau-code-ui/styles.css';
import './app.css';
import { WebSocketTransport, socketUrlFromLocation, tokenFromLocation } from './ws-transport.js';

function App(): JSX.Element {
  // Stable on purpose: `useDaemon` keys its link on this identity, and each
  // call opens a socket -- which is what a reconnect wants and a render does not.
  const open = useCallback((): Transport => new WebSocketTransport(socketUrlFromLocation()), []);
  const { daemon, state } = useDaemon(open, 'tau-code-web', tokenFromLocation());
  // Read once: after this the hash follows the session, not the other way round.
  const [initialSession] = useState(sessionFromLocation);

  return (
    <Chat
      daemon={daemon}
      daemonState={state}
      initialSession={initialSession}
      onSessionChanged={rememberSession}
      disconnectedHint="`tau serve` logs to its terminal, or to ~/.tau/serve.log when started with -d."
    />
  );
}

/**
 * The session this tab is on lives in the URL's hash, `#session=<id>`: a reload
 * comes back to it, each tab keeps its own, and the address is a link to it.
 * The hash, and not the query, because the query is where `?daemon=` and
 * `?token=` live and a session is not a connection setting.
 */
function sessionFromLocation(): string | null {
  return new URLSearchParams(location.hash.slice(1)).get('session');
}

/** `replaceState`, so moving between sessions does not fill the back button. */
function rememberSession(sessionId: string | null): void {
  const hash = sessionId ? `#session=${encodeURIComponent(sessionId)}` : '';
  if (location.hash === hash) return;
  history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
}

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
