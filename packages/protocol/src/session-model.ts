import { ProtocolViolation } from './errors.js';
import type { CursorView, Event, Live, Node, Retrying, Welcome } from './generated.js';

/** A tool call forming in a reply: `CallNamed`, then its `CallArgs`. */
export interface LiveCall {
  index: number;
  id: string;
  tool: string;
  args: string;
}

/** Output a running call has shown (`ToolProgress`), by the batch node and call id. */
export interface LiveProgress {
  node: number;
  callId: string;
  text: string;
}

/**
 * What a watched cursor's step is streaming that is not in the tree yet: a layer drawn over the
 * cursor (model.md §9). The node `Appended` brings is the record; the layer goes when the cursor
 * moves past `at` or comes to rest, by which time the tree holds what it said.
 */
export interface LiveLayer {
  /** The cursor's node when the layer began. */
  at: number | null;
  text: string;
  thinking: string;
  calls: LiveCall[];
  progress: LiveProgress[];
  /** The sample is waiting to try again; the next delta replaces this. */
  retrying: Retrying | null;
}

/** A `Notice` heard (or a notice of this client's own), numbered so a view can dismiss it. */
export interface HeardNotice {
  id: number;
  text: string;
}

/** How many notices are kept; older ones are dropped. */
export const NOTICES_KEPT = 50;

/**
 * What a client knows of one session, built from its events and the nodes it has read, and
 * nothing else (TC-03). No IO: `hear` takes an event, `insert` takes nodes a read returned.
 *
 * - `views`: each open cursor's `CursorView`, whole (the latest replaces the last);
 * - `gone`: each closed cursor and the node it ended at (`CursorGone`), for `reopen`;
 * - `labels`: every label and its cursor;
 * - `nodes`: a sparse cache of the tree. A node never changes, so it is never invalidated;
 *   `Appended` adds every new node, and `walk`/`nodes` reads fill in the past;
 * - `layers`: the `Live` layer of each watched cursor that is streaming;
 * - `notices`: the `Notice`s heard, newest last.
 *
 * On a reconnect there is no resume: a new connection gets a new model, rebuilt from the
 * snapshot. Mutable, with a `version` that every change bumps, for a view to subscribe to.
 */
export class SessionModel {
  welcome: Welcome | null = null;
  readonly views = new Map<number, CursorView>();
  readonly gone = new Map<number, number>();
  labels: [string, number][] = [];
  readonly nodes = new Map<number, Node>();
  readonly layers = new Map<number, LiveLayer>();
  notices: HeardNotice[] = [];
  /** Bumped on every change. */
  version = 0;
  readonly #children = new Map<number, number[]>();
  readonly #listeners = new Set<() => void>();
  #nextNotice = 0;

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #changed(): void {
    this.version++;
    for (const listener of this.#listeners) listener();
  }

  /** Take one event. A kind protocol 2 does not have is a `ProtocolViolation`. */
  hear(event: Event): void {
    switch (event.kind) {
      case 'CursorView':
        this.#view(event);
        break;
      case 'CursorGone':
        this.views.delete(event.cursor);
        this.layers.delete(event.cursor);
        this.gone.set(event.cursor, event.at);
        break;
      case 'Labels':
        this.labels = event.labels;
        break;
      case 'Appended':
        for (const node of event.nodes) {
          this.#settle(node);
          this.#insert(node);
        }
        break;
      case 'Notice':
        this.#notice(event.text);
        break;
      case 'Live':
        this.#live(event);
        break;
      default:
        throw new ProtocolViolation(`an event of unknown kind ${JSON.stringify((event as { kind: unknown }).kind)}`);
    }
    this.#changed();
  }

  /** Nodes a `walk`, `nodes` or `node` call returned. */
  insert(nodes: readonly Node[]): void {
    for (const node of nodes) this.#insert(node);
    this.#changed();
  }

  /** Add a notice of this client's own (a cursor it followed was closed, say). */
  notify(text: string): void {
    this.#notice(text);
    this.#changed();
  }

  #notice(text: string): void {
    this.notices = [...this.notices, { id: this.#nextNotice++, text }].slice(-NOTICES_KEPT);
  }

  /** Forget a notice. */
  dismiss(id: number): void {
    this.notices = this.notices.filter((notice) => notice.id !== id);
    this.#changed();
  }

  /** The open cursors, by id. */
  openCursors(): CursorView[] {
    return [...this.views.values()].sort((a, b) => a.cursor - b.cursor);
  }

  /** The labels on `cursor`, in label order. */
  labelsOf(cursor: number): string[] {
    return this.labels.filter(([, on]) => on === cursor).map(([label]) => label);
  }

  /** The nodes from the root to `id`, or null if one of them is not held (read it with `walk`). */
  walk(id: number): Node[] | null {
    const chain: Node[] = [];
    let next: number | null | undefined = id;
    while (next !== null && next !== undefined) {
      const node = this.nodes.get(next);
      if (!node) return null;
      chain.push(node);
      next = node.parent;
    }
    return chain.reverse();
  }

  /** The ids of the held children of `id`, in id (append) order. */
  childrenOf(id: number): readonly number[] {
    return this.#children.get(id) ?? [];
  }

  /** The held nodes without a parent: the root, in a whole tree. */
  roots(): Node[] {
    return [...this.nodes.values()].filter((node) => node.parent === null || node.parent === undefined);
  }

  #insert(node: Node): void {
    if (this.nodes.has(node.id)) return;
    this.nodes.set(node.id, node);
    const parent = node.parent;
    if (parent === null || parent === undefined) return;
    const siblings = this.#children.get(parent);
    if (!siblings) {
      this.#children.set(parent, [node.id]);
      return;
    }
    // Reads can arrive out of order (a walk, then a page); keep the ids sorted.
    let at = siblings.length;
    while (at > 0 && (siblings[at - 1] as number) > node.id) at--;
    siblings.splice(at, 0, node.id);
  }

  #view(view: CursorView): void {
    this.gone.delete(view.cursor);
    const layer = this.layers.get(view.cursor);
    // The layer is drawn over the node the cursor was on while it works: at rest, or on another
    // node, the tree holds what it said.
    if (layer && (!view.busy || (layer.at !== null && layer.at !== view.at))) {
      this.layers.delete(view.cursor);
    }
    this.views.set(view.cursor, view);
  }

  /** A `Results` node arrived: the output of the calls it answers is no longer progress. */
  #settle(node: Node): void {
    if (!('Results' in node.body) || node.parent === null || node.parent === undefined) return;
    const batch = node.parent;
    for (const layer of this.layers.values()) {
      layer.progress = layer.progress.filter((progress) => progress.node !== batch);
    }
  }

  #live(event: Live): void {
    let layer = this.layers.get(event.cursor);
    if (!layer) {
      layer = {
        at: this.views.get(event.cursor)?.at ?? null,
        text: '',
        thinking: '',
        calls: [],
        progress: [],
        retrying: null,
      };
      this.layers.set(event.cursor, layer);
    }
    const delta = event.delta;
    if (delta.kind !== 'Retrying' && delta.kind !== 'ToolProgress') layer.retrying = null; // going again
    switch (delta.kind) {
      case 'TextDelta':
        layer.text += delta.text;
        break;
      case 'ThinkingDelta':
        layer.thinking += delta.text;
        break;
      case 'CallNamed':
        layer.calls = [
          ...layer.calls.filter((call) => call.index !== delta.index),
          { index: delta.index, id: delta.id, tool: delta.tool, args: '' },
        ].sort((a, b) => a.index - b.index);
        break;
      case 'CallArgs': {
        const call = layer.calls.find((candidate) => candidate.index === delta.index);
        // As τ's reference client does: arguments of a call whose name was never heard are not drawn.
        if (call) call.args += delta.text;
        break;
      }
      case 'Retrying':
        layer.retrying = delta;
        break;
      case 'ToolProgress': {
        const progress = layer.progress.find((p) => p.node === delta.node && p.callId === delta.call_id);
        if (progress) progress.text += delta.text;
        else layer.progress.push({ node: delta.node, callId: delta.call_id, text: delta.text });
        break;
      }
      default:
        throw new ProtocolViolation(`a Live delta of unknown kind ${JSON.stringify((delta as { kind: unknown }).kind)}`);
    }
  }
}
