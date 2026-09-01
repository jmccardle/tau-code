import { StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import type { Transport } from '@tau-code/protocol';
import { Chat, useConversation, useTauConnection } from '@tau-code/ui';
import '@tau-code/ui/styles.css';
import './app.css';
import { WebSocketTransport, socketUrlFromLocation } from './ws-transport.js';

function App(): JSX.Element {
  // Built once, on purpose. A transport rebuilt on each render would open a
  // socket per render, and `useTauConnection` keys its effect on this identity.
  const transport = useMemo<Transport>(() => new WebSocketTransport(socketUrlFromLocation()), []);
  const { client, conversation, phase, detail } = useTauConnection(transport);
  const state = useConversation(conversation);

  return (
    <Chat client={client} conversation={conversation} phase={phase} detail={detail} state={state} />
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
