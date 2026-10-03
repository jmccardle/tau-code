import type { SessionRow } from '@ffwf/tau-code-protocol';

/**
 * Reading `list_sessions`.
 *
 * The daemon lists every session in its store, across every working
 * directory, newest first. The rows are typed by the generated schema, so
 * nothing here checks shapes; what is left is presentation: which label, which
 * group, how long ago.
 *
 * **Grouped by cwd.** A session's cwd is a directory on the daemon's machine
 * and it is where that session's tools run. Two sessions with the same first
 * line in two projects are different conversations, and a flat list would draw
 * them as the same one.
 */

export type { SessionRow };

/** Rows grouped by cwd, the given cwd first, then the rest in listing order. */
export function groupByCwd(rows: readonly SessionRow[], first: string | null): Array<[string, SessionRow[]]> {
  const groups = new Map<string, SessionRow[]>();
  if (first !== null) groups.set(first, []);
  for (const row of rows) {
    const group = groups.get(row.cwd);
    if (group) group.push(row);
    else groups.set(row.cwd, [row]);
  }
  return [...groups.entries()].filter(([cwd, list]) => list.length > 0 || cwd === first);
}

/** The label to show for a row, in the order a reader would want it. */
export function sessionLabel(row: SessionRow): string {
  if (row.name) return row.name;
  if (row.first_message) return row.first_message;
  return `(untitled — ${row.id.slice(0, 8)})`;
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
