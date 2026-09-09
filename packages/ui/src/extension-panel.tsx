import { useCallback, useEffect, useState } from 'react';
import type { TauClient } from '@ffwf/tau-code-protocol';
import { describe } from './useTau.js';

/**
 * `/extensions`: what is loaded, what each registered, and what failed to load.
 *
 * Built from `get_extension_state`, not from whatever was returned when
 * extensions were first loaded. `reload_extension` REPLACES the loaded set, and
 * a cached snapshot showing a pre-reload tool list is the defect this read
 * exists for.
 *
 * **A file that failed to import is the row that matters most**, and it is why
 * this is not a picker over an enumerated domain: a broken extension can never
 * be a legal argument to anything, and it is exactly what a listing must show.
 */

interface Registered {
  path: string;
  enabled: boolean;
  tools: string[];
  commands: string[];
  hooks: string[];
}

interface Failure {
  path: string;
  error: string;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

export interface ExtensionPanelProps {
  client: TauClient | null;
  onClose: () => void;
}

export function ExtensionPanel({ client, onClose }: ExtensionPanelProps): JSX.Element {
  const [loaded, setLoaded] = useState<Registered[] | null>(null);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const read = useCallback(async (): Promise<void> => {
    if (!client) return;
    try {
      const result = await client.call('get_extension_state', {});
      const rows = Array.isArray(result.extensions) ? result.extensions : [];
      setLoaded(
        rows.map((raw) => {
          const record = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
          return {
            path: String(record['path'] ?? '(unnamed)'),
            enabled: record['enabled'] !== false,
            tools: strings(record['tools']),
            commands: strings(record['commands']),
            hooks: strings(record['hooks']),
          };
        }),
      );
      const failed = Array.isArray(result.failures) ? result.failures : [];
      setFailures(
        failed.map((raw) => {
          const record = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
          return { path: String(record['path'] ?? '(unnamed)'), error: String(record['error'] ?? '') };
        }),
      );
      setError(null);
    } catch (raw) {
      setError(describe(raw));
    }
  }, [client]);

  useEffect(() => {
    void read();
  }, [read]);

  const act = async (verb: 'enable_extension' | 'disable_extension' | 'reload_extension', path: string): Promise<void> => {
    if (!client) return;
    setBusy(true);
    try {
      const result = await client.call(verb, { path });
      // `ok: false` is a decision tau made -- an unknown target, or one already
      // in the state asked for -- and it carries a message. Reported, never
      // swallowed into a refresh that looks like nothing happened.
      if (result.ok === false) setError(String(result.message ?? `${verb} did nothing.`));
      else setError(null);
      await read();
    } catch (raw) {
      setError(describe(raw));
    } finally {
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

      {failures.length > 0 ? (
        <div className="tau-extensions-failed">
          <h3>Did not load</h3>
          {failures.map((failure) => (
            <div key={failure.path} className="tau-notice tau-warn">
              <strong>{failure.path}</strong>
              <pre className="tau-pre">{failure.error}</pre>
            </div>
          ))}
        </div>
      ) : null}

      {loaded === null ? (
        <p className="tau-muted">Reading…</p>
      ) : loaded.length === 0 ? (
        <p className="tau-muted">
          No extensions are loaded. tau discovers them from its managed directory, or takes them
          with <code>-e PATH</code> at startup — this head cannot load one that was not.
        </p>
      ) : (
        <ul className="tau-extensions-list">
          {loaded.map((extension) => (
            <li key={extension.path} className={extension.enabled ? '' : 'tau-extension-disabled'}>
              <div className="tau-extension-head">
                <strong>{extension.path}</strong>
                {extension.enabled ? null : <span className="tau-muted"> (disabled)</span>}
                <span className="tau-status-spacer" />
                <button
                  className="tau-button tau-button-quiet"
                  disabled={busy}
                  onClick={() =>
                    void act(extension.enabled ? 'disable_extension' : 'enable_extension', extension.path)
                  }
                >
                  {extension.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  className="tau-button tau-button-quiet"
                  disabled={busy}
                  onClick={() => void act('reload_extension', extension.path)}
                  title="Re-import the file from disk"
                >
                  Reload
                </button>
              </div>
              <Registrations label="tools" names={extension.tools} />
              <Registrations label="commands" names={extension.commands} />
              <Registrations label="hooks" names={extension.hooks} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Registrations({ label, names }: { label: string; names: string[] }): JSX.Element | null {
  if (names.length === 0) return null;
  return (
    <div className="tau-extension-registrations">
      <span className="tau-muted">{label}:</span> {names.join(', ')}
    </div>
  );
}
