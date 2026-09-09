import type { TauClient } from '@ffwf/tau-code-protocol';

/**
 * The flow loop's data, read off the wire.
 *
 * A flow is an ordered argument list ending in one mutation. `next_step` returns
 * either the next argument or the mutation, and a head renders whatever it gets.
 * The same two calls drive a modal wizard, a completion popup and a shell -- the
 * difference between them is the presenter, not the protocol.
 *
 * It has to be on the wire rather than computed here because tau's extensions
 * are unknown to this client: an extension that calls `register_flow` gets a
 * rendered form in this panel with no code written for it, and no code here
 * could have anticipated its name.
 *
 * ## `field_kind` is how a value is ASKED FOR, not how it is FOUND
 *
 * Those are two questions and tau answers them separately. `model_name` and
 * `session_id` are both computed by an enumerator; only the first says
 * `select`. A head may substitute a RICHER control than the declared one and
 * never a poorer one, which is what licenses the picker this head offers for
 * `session_id` and `message_id`: both declare `text` and both have an
 * enumerator, so a text box would make the reader type an id they can only have
 * got from a list.
 */

/** A domain: a named type, plus how its values are found. */
export interface FlowDomain {
  name: string;
  description: string;
  /** True when any string is a value. `values` and `enumerator` are then null. */
  free: boolean;
  /** A small fixed set, or null. */
  values: string[] | null;
  /** The read that lists the live set, or null. `enumerate_domain` calls it. */
  enumerator: string | null;
  /** How tau says to ask for it. A head may render something richer. */
  fieldKind: 'text' | 'number' | 'confirm' | 'select' | 'multiselect';
}

export interface FlowArgument {
  name: string;
  domain: string;
  description: string;
  cardinality: 'one' | 'many';
  required: boolean;
  scope: string | null;
}

/** One unbound argument, and everything needed to render a field for it. */
export interface FlowStep {
  flow: string;
  argument: FlowArgument;
  domain: FlowDomain;
  cursor: string | null;
  bound: Record<string, unknown>;
}

/** Every required argument is bound; this is what to perform, and with what. */
export interface FlowReady {
  flow: string;
  mutation: string;
  arguments: Record<string, unknown>;
}

/** One option in a rendered field. */
export interface DomainValue {
  value: string;
  label: string;
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`${what} is not an object.`);
  }
  return value as Record<string, unknown>;
}

function str(source: Record<string, unknown>, key: string, what: string): string {
  const value = source[key];
  if (typeof value !== 'string') throw new TypeError(`${what}.${key} is not a string.`);
  return value;
}

const FIELD_KINDS = new Set(['text', 'number', 'confirm', 'select', 'multiselect']);

/**
 * Read a `next_step` step.
 *
 * Checks before it narrows, the discipline `capabilities.ts` uses on every array
 * tau's schemas leave unrefined: a shape change surfaces here, once, naming the
 * field, rather than as `undefined` in a form field the reader is looking at.
 */
export function stepOf(value: unknown): FlowStep {
  const step = record(value, 'next_step().step');
  const argument = record(step['argument'], 'next_step().step.argument');
  const domain = record(step['domain'], 'next_step().step.domain');
  const fieldKind = str(domain, 'field_kind', 'next_step().step.domain');
  if (!FIELD_KINDS.has(fieldKind)) {
    throw new TypeError(`next_step().step.domain.field_kind is '${fieldKind}', which this head cannot render.`);
  }
  const values = domain['values'];
  return {
    flow: str(step, 'flow', 'next_step().step'),
    cursor: typeof step['cursor'] === 'string' ? step['cursor'] : null,
    bound: typeof step['bound'] === 'object' && step['bound'] !== null ? (step['bound'] as Record<string, unknown>) : {},
    argument: {
      name: str(argument, 'name', 'next_step().step.argument'),
      domain: str(argument, 'domain', 'next_step().step.argument'),
      description: typeof argument['description'] === 'string' ? argument['description'] : '',
      cardinality: argument['cardinality'] === 'many' ? 'many' : 'one',
      required: argument['required'] === true,
      scope: typeof argument['scope'] === 'string' ? argument['scope'] : null,
    },
    domain: {
      name: str(domain, 'name', 'next_step().step.domain'),
      description: typeof domain['description'] === 'string' ? domain['description'] : '',
      free: domain['free'] === true,
      values: Array.isArray(values) ? values.map(String) : null,
      enumerator: typeof domain['enumerator'] === 'string' ? domain['enumerator'] : null,
      fieldKind: fieldKind as FlowDomain['fieldKind'],
    },
  };
}

/** Read a `next_step` ready. */
export function readyOf(value: unknown): FlowReady {
  const ready = record(value, 'next_step().ready');
  const args = ready['arguments'];
  return {
    flow: str(ready, 'flow', 'next_step().ready'),
    mutation: str(ready, 'mutation', 'next_step().ready'),
    arguments: typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {},
  };
}

/**
 * The values a field offers, and whether the list is all of them.
 *
 * `total` above `values.length` means tau capped the listing, and saying so is
 * the difference between "these are the values" and "these are some of them".
 * A `free` domain has none, and that is the answer rather than a failure.
 */
export interface DomainListing {
  values: DomainValue[];
  total: number;
}

/** Ask tau for a domain's live values. */
export async function enumerateDomain(
  client: TauClient,
  domain: string,
  options: { query?: string; cursor?: string | null; limit?: number } = {},
): Promise<DomainListing> {
  const result = await client.call('enumerate_domain', {
    domain,
    ...(options.query === undefined ? {} : { query: options.query }),
    ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  });
  if (!Array.isArray(result.values)) {
    throw new TypeError('enumerate_domain().values is not an array.');
  }
  return {
    total: Number(result.total ?? result.values.length),
    values: result.values.map((entry, index) => {
      const row = record(entry, `enumerate_domain().values[${index}]`);
      return {
        value: str(row, 'value', `enumerate_domain().values[${index}]`),
        label: typeof row['label'] === 'string' ? row['label'] : str(row, 'value', `enumerate_domain().values[${index}]`),
      };
    }),
  };
}

/**
 * Whether this head offers a picker for a field tau declared as a text box.
 *
 * The richer-not-poorer rule, applied where tau's own TUI applies it. A domain
 * with an enumerator has a list behind it; asking the reader to type a value out
 * of a list they have not been shown is the poorer control, whatever the
 * declared `field_kind` says.
 */
export function offersPicker(domain: FlowDomain): boolean {
  return domain.fieldKind === 'select' || (!domain.free && domain.enumerator !== null);
}
