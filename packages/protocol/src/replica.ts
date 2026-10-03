import type { Attached, CursorState, Event, EventData } from './generated.js';

/** One session-log entry as the daemon sends it. Only `id` is read here. */
export type ReplicaEntry = { id: string; [key: string]: unknown };

/** What a replica needs from the daemon to resume where it left off. */
export interface ResumePoint {
  epoch: string;
  since: number;
}

/**
 * What applying an event did.
 *
 * - `applied`: the replica changed (an entry or the cursor set).
 * - `passed`: a stateless event (`agent_event`, `channel`, `request`, `ui`)
 *   that the replica numbered and hands on, but holds nothing of.
 * - `duplicate`: a `seq` already applied. A replay overlapping a live push
 *   produces these; they are dropped.
 * - `gap`: a `seq` past the next one, or a different `epoch`. Something was
 *   missed, so nothing after it can be trusted -- re-attach from `resume`.
 */
export type ApplyOutcome = 'applied' | 'passed' | 'duplicate' | 'gap';

/**
 * A client's copy of one session: its log entries and its cursors.
 *
 * The daemon's rule (docs/TAU-SERVE.md §4.1), implemented exactly: apply entry
 * events by id, **last write wins, keeping the first position**. A `Map`
 * keeps a key's insertion position when it is set again, which is that rule.
 *
 * Framework-free and host-free, like the client: React binds to it in the UI
 * package, and a test drives it with plain objects.
 */
export class Replica {
  readonly sessionId: string;
  #entries = new Map<string, ReplicaEntry>();
  #cursors: CursorState[] = [];
  #epoch: string | null = null;
  #seq = 0;
  #attached: Attached | null = null;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  /** Where to resume from, or null before the first `attach` answered. */
  get resume(): ResumePoint | null {
    return this.#epoch === null ? null : { epoch: this.#epoch, since: this.#seq };
  }

  /** The last `attach` answer: cwd, models, surface, head cursor. */
  get attached(): Attached | null {
    return this.#attached;
  }

  get entries(): ReadonlyMap<string, ReplicaEntry> {
    return this.#entries;
  }

  get cursors(): readonly CursorState[] {
    return this.#cursors;
  }

  cursor(cursorId: string): CursorState | null {
    return this.#cursors.find((cursor) => cursor.cursor_id === cursorId) ?? null;
  }

  /**
   * Take an `attach` answer.
   *
   * With `entries` it is a snapshot and replaces everything. Without, this
   * replica is current to `since` and the events that follow are a replay --
   * which is only true if it is the same epoch this replica already holds, so
   * a replay answer for a replica that holds nothing is refused.
   */
  applyAttached(attached: Attached): void {
    if (attached.session_id !== this.sessionId) {
      throw new Error(`attach answered for ${attached.session_id}, not ${this.sessionId}.`);
    }
    if (attached.entries === null) {
      if (this.#epoch !== attached.epoch) {
        throw new Error(
          `attach answered with a replay for epoch ${attached.epoch}, and this replica holds ` +
            `${this.#epoch ?? 'nothing'}. A replay can only continue the epoch it was asked for.`,
        );
      }
    } else {
      this.#entries = new Map();
      for (const raw of attached.entries) {
        const entry = asEntry(raw, 'attach snapshot');
        this.#entries.set(entry.id, entry);
      }
    }
    this.#epoch = attached.epoch;
    this.#seq = attached.seq;
    this.#cursors = [...attached.cursors];
    this.#attached = attached;
  }

  /** Apply one event; see `ApplyOutcome` for what the answer tells the caller to do. */
  apply(event: Event): ApplyOutcome {
    if (event.session_id !== this.sessionId) {
      throw new Error(`An event for ${event.session_id} reached the replica of ${this.sessionId}.`);
    }
    if (event.epoch !== this.#epoch) return 'gap';
    if (event.seq <= this.#seq) return 'duplicate';
    if (event.seq !== this.#seq + 1) return 'gap';
    this.#seq = event.seq;

    switch (event.kind) {
      case 'entry_open':
      case 'entry_final':
      case 'entry_append': {
        const data = event.data as EventData[typeof event.kind];
        const entry = asEntry((data as { entry?: unknown }).entry, `${event.kind} ${event.seq}`);
        this.#entries.set(entry.id, entry);
        return 'applied';
      }
      case 'cursors':
        this.#cursors = [...(event.data as EventData['cursors']).cursors];
        return 'applied';
      default:
        return 'passed';
    }
  }

  /**
   * Root→leaf entries from `leaf`, by following `parentId`.
   *
   * This is the structure, not τ's context: no compaction splice, no elision.
   * It is what the TUI's transcript renders under `--connect`, and what a
   * reader of the conversation sees -- a compaction entry shows up as itself.
   * A cycle or a missing parent ends the walk instead of looping; the entry
   * whose parent is missing is reported, not hidden.
   */
  path(leaf: string | null): { entries: ReplicaEntry[]; missingParent: string | null } {
    const out: ReplicaEntry[] = [];
    const seen = new Set<string>();
    let current = leaf;
    let missingParent: string | null = null;
    while (current !== null && !seen.has(current)) {
      seen.add(current);
      const entry = this.#entries.get(current);
      if (!entry) {
        missingParent = current;
        break;
      }
      out.push(entry);
      const parent = entry['parentId'];
      current = typeof parent === 'string' ? parent : null;
    }
    out.reverse();
    return { entries: out, missingParent };
  }
}

function asEntry(raw: unknown, where: string): ReplicaEntry {
  if (typeof raw !== 'object' || raw === null || typeof (raw as { id?: unknown }).id !== 'string') {
    throw new Error(`The ${where} carried an entry with no string id.`);
  }
  return raw as ReplicaEntry;
}
