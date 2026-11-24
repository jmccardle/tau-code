import { authorText, bodyKind, isFrontend, outcomeOf, proseText } from '@ffwf/tau-code-protocol';
import type { Image, LiveLayer, Node } from '@ffwf/tau-code-protocol';

/** How a transcript row is drawn. */
export type RowKind = 'system' | 'user' | 'assistant' | 'thinking' | 'call' | 'result' | 'stop' | 'config' | 'custom';

/** One row of a transcript: a node, or one part of one. */
export interface Row {
  key: string;
  kind: RowKind;
  /** The node it comes from. */
  node: number;
  /** Who wrote it, as a phrase. */
  by: string;
  /** Written by this client. */
  mine: boolean;
  text: string;
  /** A call's tool, a result's call id, a custom node's kind. */
  label?: string;
  /** A result: whether the call succeeded. */
  ok?: boolean;
  /** A result: the images it gave the model, in order (protocol 2). Absent when there are none. */
  images?: Image[];
}

/** The rows of a walk, root first. Pure: a view draws them. */
export function rows(walk: readonly Node[], client: string): Row[] {
  const out: Row[] = [];
  for (const node of walk) {
    const by = authorText(node.by);
    const mine = isFrontend(node.by, client);
    const base = { node: node.id, by, mine };
    const body = node.body;
    switch (bodyKind(body)) {
      case 'System':
        out.push({ ...base, key: `${node.id}`, kind: 'system', text: (body as { System: string }).System });
        break;
      case 'User': {
        const text = (body as { User: string }).User;
        out.push({ ...base, key: `${node.id}`, kind: 'user', text: node.typed ?? text });
        break;
      }
      case 'Assistant': {
        const reply = (body as Extract<Node['body'], { Assistant: unknown }>).Assistant;
        reply.parts.forEach((part, i) => {
          const key = `${node.id}.${i}`;
          if ('Text' in part) out.push({ ...base, key, kind: 'assistant', text: proseText(part.Text) });
          else if ('Thinking' in part) out.push({ ...base, key, kind: 'thinking', text: proseText(part.Thinking) });
          else out.push({ ...base, key, kind: 'call', label: part.Call.tool, text: prettyArgs(part.Call.args_raw) });
        });
        if (reply.stop !== 'End' && reply.stop !== 'Tools') {
          const why = reply.finish_reason ? ` (${reply.finish_reason})` : '';
          out.push({ ...base, key: `${node.id}.stop`, kind: 'stop', text: `the reply stopped: ${reply.stop}${why}` });
        }
        break;
      }
      case 'Results': {
        const results = (body as { Results: Extract<Node['body'], { Results: unknown }>['Results'] }).Results;
        results.forEach(([callId, outcome, author], i) => {
          const { ok, text, images } = outcomeOf(outcome);
          out.push({
            ...base,
            by: authorText(author),
            key: `${node.id}.${i}`,
            kind: 'result',
            label: callId,
            ok,
            text,
            ...(images.length > 0 ? { images } : {}),
          });
        });
        break;
      }
      case 'Config':
        out.push({ ...base, key: `${node.id}`, kind: 'config', text: (body as { Config: { data: string } }).Config.data });
        break;
      case 'Custom': {
        const custom = (body as { Custom: { kind: string; data: string } }).Custom;
        out.push({ ...base, key: `${node.id}`, kind: 'custom', label: custom.kind, text: custom.data });
        break;
      }
    }
  }
  return out;
}

/** A call's argument text, indented when it is JSON, as it was written when it is not. */
export function prettyArgs(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** Whether a live layer has anything to draw. */
export function layerShows(layer: LiveLayer | undefined): layer is LiveLayer {
  return (
    layer !== undefined &&
    (layer.text !== '' ||
      layer.thinking !== '' ||
      layer.calls.length > 0 ||
      layer.progress.length > 0 ||
      layer.retrying !== null)
  );
}
