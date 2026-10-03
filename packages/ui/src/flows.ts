import type { FlowStep as WireStep, Ready } from '@ffwf/tau-code-protocol';
import type { SessionStore } from './session.js';

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
  /**
   * The entry the step was computed at -- a LEAF, despite the name, which is
   * the core dataclass's. `enumerate_domain` takes it as `leaf`, so a scoped
   * domain (`ancestors_of_cursor`) lists from the same place.
   */
  leaf: string | null;
  bound: Record<string, unknown>;
}

/** A flow's mutation with every argument bound: the generated `Ready`, sent back as-is. */
export type FlowReady = Ready;

export interface DomainValue {
  value: string;
  label: string;
}

const FIELD_KINDS = new Set(['text', 'number', 'confirm', 'select', 'multiselect']);

/**
 * The step this head renders, from the wire's `FlowStep` (or a submit's
 * `FlowStep` arm, which carries the same fields).
 *
 * `field_kind`, `free` and `required` are optional in the schema and always
 * sent; one that is missing, or a field kind this head cannot draw, is refused
 * by name rather than guessed at.
 */
export function stepOf(step: WireStep): FlowStep {
  const { argument, domain } = step;
  const fieldKind = domain.field_kind;
  if (fieldKind === undefined || !FIELD_KINDS.has(fieldKind)) {
    throw new TypeError(
      `next_step's domain ${domain.name} has field_kind ${JSON.stringify(fieldKind)}, which this head cannot render.`,
    );
  }
  if (domain.free === undefined) throw new TypeError(`next_step's domain ${domain.name} does not say whether it is free.`);
  if (argument.required === undefined) {
    throw new TypeError(`next_step's argument ${argument.name} does not say whether it is required.`);
  }
  return {
    flow: step.flow,
    leaf: step.cursor,
    bound: step.bound,
    argument: {
      name: argument.name,
      domain: argument.domain,
      description: argument.description,
      cardinality: argument.cardinality ?? 'one',
      required: argument.required,
      scope: argument.scope ?? null,
    },
    domain: {
      name: domain.name,
      description: domain.description,
      free: domain.free,
      values: domain.values ?? null,
      enumerator: domain.enumerator ?? null,
      fieldKind: fieldKind as FlowDomain['fieldKind'],
    },
  };
}

export interface DomainListing {
  values: DomainValue[];
  total: number;
}

/** Ask tau for a domain's live values. */
export async function enumerateDomain(
  session: SessionStore,
  domain: string,
  options: { query?: string; leaf?: string | null; limit?: number } = {},
): Promise<DomainListing> {
  const { client, session_id } = session.at();
  const result = await client.request('enumerate_domain', {
    session_id,
    domain,
    ...(options.query === undefined ? {} : { query: options.query }),
    ...(options.leaf === undefined ? {} : { leaf: options.leaf }),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  });
  return { total: result.total, values: result.values };
}

export function offersPicker(domain: FlowDomain): boolean {
  return domain.fieldKind === 'select' || (!domain.free && domain.enumerator !== null);
}
