import { useMemo, useState } from 'react';
import type { ExtensionInfo, Surface } from '@ffwf/tau-code-protocol';
import { messageOf } from './daemon.js';
import type { SessionStore } from './session.js';

/**
 * `/extensions`: what is loaded, what each registered, and what failed to load.
 *
 * Built from the session's `surface`, which the daemon reads fresh on every
 * `attach` and every `describe` -- and `describe` runs after every enable,
 * disable and reload here, because `reload_extension` REPLACES the loaded set
 * and a stale surface showing a pre-reload tool list is the defect this view
 * exists to avoid.
 *
 * **A file that failed to import is the row that matters most**, and it is why
 * this is not a picker over an enumerated domain: a broken extension can never
 * be a legal argument to anything, and it is exactly what a listing must show.
 */

interface Row {
  path: string;
  /** False for a managed extension that is runtime-disabled. */
  enabled: boolean;
  /** What it registered; null when it is disabled, and registered nothing. */
  info: ExtensionInfo | null;
}

/**
 * Managed extensions (`surface.extensions`, `[path, enabled]` pairs) joined to
 * what is loaded (`surface.loaded`). An extension loaded with `-e` is not
 * managed and has no enabled flag, so it is listed as enabled -- it is loaded,
 * and that is the fact.
 */
function rowsOf(surface: Surface): Row[] {
  const loaded = new Map(surface.loaded.map((info) => [info.path, info]));
  const rows: Row[] = [];
  for (const pair of surface.extensions) {
    const path = String(pair[0]);
    rows.push({ path, enabled: pair[1] !== false, info: loaded.get(path) ?? null });
    loaded.delete(path);
  }
  for (const info of loaded.values()) rows.push({ path: info.path, enabled: true, info });
  return rows;
}

export interface ExtensionPanelProps {
  session: SessionStore | null;
  surface: Surface | null;
  onClose: () => void;
}

export function ExtensionPanel({ session, surface, onClose }: ExtensionPanelProps): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => (surface ? rowsOf(surface) : null), [surface]);

  const act = async (method: 'enable_extension' | 'disable_extension' | 'reload_extension', path: string): Promise<void> => {
    if (!session) return;
    setBusy(true);
    try {
      const { client, session_id, cursor_id } = session.at();
      const result = await client.request(method, { session_id, cursor_id, path });
      // `ok: false` is a decision τ made -- an unknown target, or one already
      // in the state asked for -- and it carries a sentence. Reported, never
      // swallowed into a refresh that looks like nothing happened.
      setError(result.ok ? null : result.message);
    } catch (raw) {
      // A refusal is τ's sentence -- an unknown target, a file that will not
      // import -- and it is shown, never swallowed into a refresh that looks
      // like nothing happened.
      setError(messageOf(raw));
    } finally {
      // Re-read whatever happened: a failed reload can still have unloaded the
      // old version, and the listing must say so.
      await session.describe().catch((raw: unknown) => setError(messageOf(raw)));
      setBusy(false);
    }
  };

  return (
    <section className="tau-panel tau-extensions">
      <header className="tau-panel-head">
        <h2>Extensions</h2>
        <button className="tau-button tau-button-quiet" onClick={onClose}>
          Close
        </button>
      </header>

      {error ? <p className="tau-notice tau-warn">{error}</p> : null}

      {surface && surface.load_errors.length > 0 ? (
        <div className="tau-extensions-failed">
          <h3>Did not load</h3>
          {surface.load_errors.map(([path, failure]) => (
            <div key={path} className="tau-notice tau-warn">
              <strong>{path}</strong>
              <pre className="tau-pre">{failure}</pre>
            </div>
          ))}
        </div>
      ) : null}

      {rows === null ? (
        <p className="tau-muted">Reading…</p>
      ) : rows.length === 0 ? (
        <p className="tau-muted">
          No extensions are loaded. τ discovers them from its managed directory on the daemon's
          machine — this head cannot load one that was not.
        </p>
      ) : (
        <ul className="tau-extensions-list">
          {rows.map((row) => (
            <li key={row.path} className={row.enabled ? '' : 'tau-extension-disabled'}>
              <div className="tau-extension-head">
                <strong>{row.info?.name ?? row.path}</strong>
                {row.enabled ? null : <span className="tau-muted"> (disabled)</span>}
                <span className="tau-status-spacer" />
                <button
                  className="tau-button tau-button-quiet"
                  disabled={busy}
                  onClick={() => void act(row.enabled ? 'disable_extension' : 'enable_extension', row.path)}
                >
                  {row.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  className="tau-button tau-button-quiet"
                  disabled={busy}
                  onClick={() => void act('reload_extension', row.path)}
                  title="Re-import the file from disk"
                >
                  Reload
                </button>
              </div>
              {row.info && row.info.name !== row.path ? <div className="tau-muted">{row.path}</div> : null}
              <Registrations label="tools" names={row.info?.tools ?? []} />
              <Registrations label="commands" names={row.info?.commands ?? []} />
              <Registrations label="hooks" names={row.info?.hooks ?? []} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Registrations({ label, names }: { label: string; names: readonly string[] }): JSX.Element | null {
  if (names.length === 0) return null;
  return (
    <div className="tau-extension-registrations">
      <span className="tau-muted">{label}:</span> {names.join(', ')}
    </div>
  );
}
