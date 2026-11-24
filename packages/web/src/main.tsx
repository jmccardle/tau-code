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
const origin = `${window.location.origin}/`;
const link = new SessionLink({
  // The token is read again for every connection: after a 401, opening the new `open:` address in
  // this tab (only its fragment changes, so the page does not reload) brings the new one.
  open: () => HttpTransport.open({ url: origin, token: takeToken(place) }),
  client: clientId(window.location.host, window.sessionStorage, () => crypto.randomUUID().slice(0, 8)),
});
window.addEventListener('hashchange', () => {
  if (new URLSearchParams(window.location.hash.slice(1)).has('token')) link.retry();
});
link.start();

const hints = {
  unauthorized:
    'This tab has no token for this server, or an old one (a restarted `tau serve` has a new one). ' +
    'Open the address `tau serve` printed after "open:" (it ends in #token=…), here or in a new tab.',
  forbidden: 'This page\'s origin is not allowed to call this server: open it from the address `tau serve` printed.',
};

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element.');
createRoot(root).render(
  <StrictMode>
    <TauApp link={link} hints={hints} />
  </StrictMode>,
);
