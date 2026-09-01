import type { Capabilities } from './generated.js';

/**
 * Element shapes for the arrays in `get_capabilities`.
 *
 * These are hand-written on purpose. tau's schemas declare `commands` and
 * `declined` as bare arrays with no `items`, so the element shape is genuinely
 * NOT on the wire. The generator emits `unknown[]`, which is the truthful
 * translation; refining it is a client-side claim, and a client-side claim
 * belongs in code a reader can see and a test can break -- not smuggled into a
 * generated file where it would look like the protocol said so.
 *
 * Each reader below CHECKS before it narrows, and throws naming the field when
 * the check fails. That is the Fail Early trade: a protocol change surfaces
 * here, once, with a message, instead of as `undefined` somewhere downstream.
 */

export interface CommandDescriptor {
  name: string;
  tier: string;
  since: string;
  notes: string;
  params_schema: Record<string, unknown>;
  result_schema: Record<string, unknown>;
}

export interface DeclinedEntry {
  name: string;
  reason: string;
}

function assertArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`get_capabilities().${field} is not an array (got ${typeof value}).`);
  }
  return value;
}

function assertKeys<T>(value: unknown, keys: readonly string[], field: string, index: number): T {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`get_capabilities().${field}[${index}] is not an object.`);
  }
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (!(key in record)) {
      throw new TypeError(`get_capabilities().${field}[${index}] has no '${key}'.`);
    }
  }
  return value as T;
}

const COMMAND_KEYS = ['name', 'tier', 'since', 'notes', 'params_schema', 'result_schema'] as const;
const DECLINED_KEYS = ['name', 'reason'] as const;

/** Every live verb, with its schemas. */
export function commandsOf(caps: Capabilities): CommandDescriptor[] {
  return assertArray(caps.commands, 'commands').map((entry, index) =>
    assertKeys<CommandDescriptor>(entry, COMMAND_KEYS, 'commands', index),
  );
}

/**
 * Every verb tau deliberately does not implement, with its reason.
 *
 * Worth surfacing in a UI rather than hiding: calling one of these returns a
 * bare `METHOD_NOT_FOUND`, and the reason here is the only place that says WHY.
 */
export function declinedOf(caps: Capabilities): DeclinedEntry[] {
  return assertArray(caps.declined, 'declined').map((entry, index) =>
    assertKeys<DeclinedEntry>(entry, DECLINED_KEYS, 'declined', index),
  );
}

/** The ten agent lifecycle event type names this peer will send. */
export function eventsOf(caps: Capabilities): string[] {
  return assertArray(caps.events, 'events').map((entry, index) => {
    if (typeof entry !== 'string') {
      throw new TypeError(`get_capabilities().events[${index}] is not a string.`);
    }
    return entry;
  });
}

/**
 * Reverse-channel methods this peer can call ON the client.
 *
 * `[]` on every tau shipped so far, which is RC3's honest statement that the
 * channel does not exist yet rather than a promise that it never will.
 */
export function uiMethodsOf(caps: Capabilities): string[] {
  const value = caps.ui_methods;
  if (value === undefined || value === null) return [];
  return assertArray(value, 'ui_methods').map((entry, index) => {
    if (typeof entry !== 'string') {
      throw new TypeError(`get_capabilities().ui_methods[${index}] is not a string.`);
    }
    return entry;
  });
}
