import { useEffect, useRef } from 'react';
import type { LiveLayer, Node } from '@ffwf/tau-code-protocol';
import { LiveMarkdown, Markdown } from './markdown.js';
import { layerShows, prettyArgs, rows, type Row } from './rows.js';

export interface TranscriptProps {
  /** The cursor's walk, root first; null while it is being read. */
  walk: readonly Node[] | null;
  /** What the cursor's step is streaming, over its node. */
  layer: LiveLayer | undefined;
  client: string;
}

function RowView({ row }: { row: Row }): JSX.Element {
  const head = (
    <div className="tau-row-head">
      <span className="tau-row-by">{row.mine ? 'you' : row.by}</span>
      <span className="tau-row-node">#{row.node}</span>
    </div>
  );
  switch (row.kind) {
    case 'user':
      return (
        <div className={`tau-row tau-row-user${row.mine ? ' tau-mine' : ''}`} data-node={row.node}>
          {head}
          <div className="tau-row-text">{row.text}</div>
        </div>
      );
    case 'assistant':
      return (
        <div className="tau-row tau-row-assistant" data-node={row.node}>
          {head}
          <Markdown text={row.text} />
        </div>
      );
    case 'thinking':
      return (
        <details className="tau-row tau-row-thinking" data-node={row.node}>
          <summary>thinking</summary>
          <div className="tau-row-text">{row.text}</div>
        </details>
      );
    case 'call':
      return (
        <div className="tau-row tau-row-call" data-node={row.node}>
          <div className="tau-row-head">
            <span className="tau-tool">{row.label}</span>
          </div>
          <pre>{row.text}</pre>
        </div>
      );
    case 'result':
      return (
        <details className={`tau-row tau-row-result ${row.ok ? 'tau-ok' : 'tau-failed'}`} data-node={row.node}>
          <summary>
            {row.ok ? 'result' : 'failed'} <span className="tau-hint">{row.label}</span>{' '}
            <span className="tau-hint">{firstLine(row.text)}</span>
          </summary>
          <pre>{row.text}</pre>
        </details>
      );
    case 'system':
      return (
        <details className="tau-row tau-row-dim" data-node={row.node}>
          <summary>system prompt</summary>
          <pre>{row.text}</pre>
        </details>
      );
    case 'config':
      return (
        <details className="tau-row tau-row-dim" data-node={row.node}>
          <summary>config #{row.node}</summary>
          <pre>{prettyArgs(row.text)}</pre>
        </details>
      );
    case 'custom':
      return (
        <details className="tau-row tau-row-dim" data-node={row.node}>
          <summary>
            {row.label} #{row.node}
          </summary>
          <pre>{row.text}</pre>
        </details>
      );
    case 'stop':
      return (
        <div className="tau-row tau-row-stop" data-node={row.node}>
          {row.text}
        </div>
      );
  }
}

function firstLine(text: string): string {
  const line = text.split('\n', 1)[0] ?? '';
  return line.length > 100 ? `${line.slice(0, 99)}…` : line;
}

/** What the step is streaming: drawn over the cursor, never in the tree. */
function Layer({ layer }: { layer: LiveLayer }): JSX.Element {
  return (
    <div className="tau-live" aria-live="polite">
      {layer.retrying && (
        <div className="tau-row tau-row-stop">
          {layer.retrying.reason}: retry {layer.retrying.attempt} of {layer.retrying.attempts} in{' '}
          {Math.round(layer.retrying.seconds)} s
        </div>
      )}
      {layer.thinking && (
        <details className="tau-row tau-row-thinking" open>
          <summary>thinking</summary>
          <div className="tau-row-text">{layer.thinking}</div>
        </details>
      )}
      {layer.text && (
        <div className="tau-row tau-row-assistant">
          <LiveMarkdown text={layer.text} />
        </div>
      )}
      {layer.calls.map((call) => (
        <div key={call.index} className="tau-row tau-row-call">
          <div className="tau-row-head">
            <span className="tau-tool">{call.tool}</span>
          </div>
          <pre>{call.args}</pre>
        </div>
      ))}
      {layer.progress.map((progress) => (
        <div key={`${progress.node}.${progress.callId}`} className="tau-row tau-row-result">
          <div className="tau-hint">running {progress.callId}</div>
          <pre>{progress.text}</pre>
        </div>
      ))}
    </div>
  );
}

/** A cursor's conversation: its walk, then what its step is streaming. Follows the end. */
export function Transcript({ walk, layer, client }: TranscriptProps): JSX.Element {
  const end = useRef<HTMLDivElement>(null);
  const shown = walk ? rows(walk, client) : [];
  const streaming = layerShows(layer);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [shown.length, streaming && layer?.text.length, streaming && layer?.calls.length]);
  return (
    <div className="tau-transcript" data-testid="transcript">
      {walk === null && <div className="tau-hint">reading the conversation…</div>}
      {shown.map((row) => (
        <RowView key={row.key} row={row} />
      ))}
      {streaming && <Layer layer={layer} />}
      <div ref={end} />
    </div>
  );
}
