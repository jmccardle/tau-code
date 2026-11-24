import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HttpTransport, SessionLink } from '@ffwf/tau-code-protocol';
import { TauApp } from '@ffwf/tau-code-ui';
import '@ffwf/tau-code-ui/styles.css';
import './app.css';
import { clientId, takeToken } from './token.js';

// Everything browser-specific is here: the token from the address, this tab's id, and the stream
// on the page's own origin (`/stream`, where `tau serve` serves this page). The views are handed
// a SessionLink and know none of it.
const place = { location: window.location, history: window.history, storage: window.sessionStorage };
const token = takeToken(place);
const origin = `${window.location.origin}/`;
const link = new SessionLink({
  open: () => HttpTransport.open({ url: origin, token }),
  client: clientId(window.location.host, window.sessionStorage, () => crypto.randomUUID().slice(0, 8)),
});
link.start();

const hints = {
  unauthorized:
    token === null
      ? 'This page has no token. Open the address `tau serve` printed after "open:" (it ends in #token=…).'
      : 'The token this tab has is not this server\'s: a restarted `tau serve` has a new one. Open the address it printed after "open:".',
  forbidden: 'This page\'s origin is not allowed to call this server: open it from the address `tau serve` printed.',
};

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element.');
createRoot(root).render(
  <StrictMode>
    <TauApp link={link} hints={hints} />
  </StrictMode>,
);
