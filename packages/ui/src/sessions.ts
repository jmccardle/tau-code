/**
 * Reading `list_sessions`.
 *
 * Same check-then-narrow discipline as `messages.ts`: the wire declares
 * `sessions` as a bare array, so the row shape is a client-side claim and it is
 * checked rather than cast.
 *
 * Two fields here are easy to drop and should not be:
 *
 *  - **`error`.** tau lists a session it could not read and says why, rather
 *    than letting it vanish from the listing. A picker that filters those out
 *    re-hides exactly what tau went to the trouble of surfacing.
 *  - **`ref`.** The store's own handle -- the file store's absolute `.jsonl`
 *    path. It names WHICH universe the listing is, which matters because
 *    `--mode rpc` and the TUI have different default session directories. Two
 *    identical-looking lists can be two different stores.
 */

export interface SessionRow {
  sessionId: string;
  /** The store's handle: an absolute .jsonl path for the file store. */
  ref: string | null;
  /** What `set_session_name` set, or null. */
  name: string | null;
  /** The picker's bounded display label. The only message text in a listing. */
  title: string | null;
  messageCount: number | null;
  created: string | null;
  modified: string | null;
  /** The session this one was forked from, or null. */
  parent: string | null;
  /** Why this row's entries could not be read. The row is still listed. */
  error: string | null;
}

/** What universe a listing is: which store, scoped to which working directory. */
export interface SessionScope {
  store: string | null;
  cwd: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function str(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

export function readSessionRows(sessions: unknown[]): SessionRow[] {
  const rows: SessionRow[] = [];
  for (const entry of sessions) {
    const record = asRecord(entry);
    if (!record) continue;
    const id = str(record, 'session_id');
    // A row with no id is not switchable, so it is not a row. This is the one
    // thing dropped, and only because the picker's whole purpose is to produce
    // an id for `switch_session`.
    if (!id) continue;
    const count = record['message_count'];
    rows.push({
      sessionId: id,
      ref: str(record, 'ref'),
      name: str(record, 'name'),
      title: str(record, 'title'),
      messageCount: typeof count === 'number' ? count : null,
      created: str(record, 'created'),
      modified: str(record, 'modified'),
      parent: str(record, 'parent'),
      error: str(record, 'error'),
    });
  }
  return rows;
}

export function readScope(scope: Record<string, unknown> | undefined): SessionScope {
  if (!scope) return { store: null, cwd: null };
  return { store: str(scope, 'store'), cwd: str(scope, 'cwd') };
}

/** The label to show for a row, in the order a reader would want it. */
export function sessionLabel(row: SessionRow): string {
  if (row.name) return row.name;
  if (row.title) return row.title;
  return `(untitled — ${row.sessionId.slice(0, 8)})`;
}

/** A short, local, human time. Falls back to the raw string it cannot parse. */
export function formatWhen(iso: string | null): string {
  if (!iso) return '';
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return iso;

  const seconds = Math.round((Date.now() - when.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)}d ago`;
  return when.toLocaleDateString();
}

/**
 * The directory a `ref` lives in, for showing which store a listing is.
 *
 * Returns null for a ref that is not a path -- a JMFTS document id, say --
 * because inventing a directory for it would be worse than showing nothing.
 */
export function storeDirectory(ref: string | null): string | null {
  if (!ref || !ref.startsWith('/')) return null;
  const cut = ref.lastIndexOf('/');
  return cut > 0 ? ref.slice(0, cut) : null;
}
