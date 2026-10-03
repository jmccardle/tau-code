import { StrictMode, useCallback } from 'react';
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

  return (
    <Chat
      daemon={daemon}
      daemonState={state}
      disconnectedHint="`tau serve` logs to its terminal, or to ~/.tau/serve.log when started with -d."
    />
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
