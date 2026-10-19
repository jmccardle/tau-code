import type { ExtensionWarning } from '@ffwf/tau-code-protocol';

/**
 * A session's current extension warnings (`surface.warnings`): what an
 * extension -- or τ itself, as source `"tau"`, for an extension that failed to
 * load -- flagged and has not cleared. They are state, not news: the daemon
 * sends the whole set after every change, and an attach answers with it, so a
 * head that attached late sees the same set as one that was watching.
 */

export type { ExtensionWarning };

/** Errors first, then warnings; each in the order τ sent them. */
export function orderWarnings(warnings: readonly ExtensionWarning[]): ExtensionWarning[] {
  return [...warnings.filter((w) => w.severity === 'error'), ...warnings.filter((w) => w.severity === 'warning')];
}

/**
 * The status bar's marker, `1 extension error, 2 warnings`, or null when there
 * is nothing to mark.
 */
export function warningsLabel(warnings: readonly ExtensionWarning[]): string | null {
  const counts: Array<[number, string, string]> = [
    [warnings.filter((w) => w.severity === 'error').length, 'error', 'errors'],
    [warnings.filter((w) => w.severity === 'warning').length, 'warning', 'warnings'],
  ];
  const parts = counts.filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
  if (parts.length === 0) return null;
  // Only the first count is qualified: "1 extension error, 2 warnings".
  return parts.map((part, i) => (i === 0 ? part.replace(' ', ' extension ') : part)).join(', ');
}
