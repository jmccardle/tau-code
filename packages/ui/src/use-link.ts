import { useSyncExternalStore } from 'react';
import type { LinkState, SessionLink } from '@ffwf/tau-code-protocol';

/**
 * The link's state, re-rendering on every change to it and to its current model (which is
 * mutable and versioned: a reconnect swaps it, an event bumps it).
 */
export function useLink(link: SessionLink): LinkState {
  const state = useSyncExternalStore(
    (listener) => link.subscribe(listener),
    () => link.state,
  );
  useSyncExternalStore(
    (listener) => state.model.subscribe(listener),
    () => state.model.version,
  );
  return state;
}
