/**
 * Where the browser client's bearer token comes from.
 *
 * `tau serve` prints `open: http://127.0.0.1:3393/#token=…` (D29 §7). A fragment never reaches a
 * server, so the token travels only from the user's terminal to this page. The page:
 *
 * 1. reads `token=` from `location.hash`;
 * 2. keeps it in `sessionStorage`, so a reload of this tab still has it (and no other tab does);
 * 3. removes it from the address bar with `history.replaceState`, so it does not sit in history,
 *    bookmarks or a screen share. Decided by John on 2026-11-24 (Q-I); this is the one place
 *    that does it.
 *
 * No token at all is not an error here: the page then sends none, which is right behind a
 * same-origin proxy that adds it (`npm run dev`); τ itself answers 401, and the page says how to
 * get one.
 */

/** The parts of `window` this needs, so a test can hand in its own. */
export interface TokenPlace {
  location: { hash: string; pathname: string; search: string };
  history: { replaceState(data: unknown, unused: string, url: string): void };
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
}

export const TOKEN_KEY = 'tau.token';

/** The token for this tab: from the address (then forgotten there), else from this tab's storage. */
export function takeToken(place: TokenPlace): string | null {
  const params = new URLSearchParams(place.location.hash.replace(/^#/, ''));
  const fromAddress = params.get('token');
  if (fromAddress) {
    place.storage.setItem(TOKEN_KEY, fromAddress);
    params.delete('token');
    const rest = params.toString();
    place.history.replaceState(null, '', `${place.location.pathname}${place.location.search}${rest ? `#${rest}` : ''}`);
    return fromAddress;
  }
  return place.storage.getItem(TOKEN_KEY);
}

/**
 * This tab's client id for `hello`: `web@<host>:<tab>`. Stable across reloads of the tab (a
 * question addressed to it still reaches it), different per tab.
 */
export function clientId(host: string, storage: TokenPlace['storage'], random: () => string): string {
  const key = 'tau.tab';
  let tab = storage.getItem(key);
  if (!tab) {
    tab = random();
    storage.setItem(key, tab);
  }
  return `web@${host}:${tab}`;
}
