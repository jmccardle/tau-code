import type { SessionModel } from '@ffwf/tau-code-protocol';
import { bodyKind, proseText } from '@ffwf/tau-code-protocol';
import type { Node } from '@ffwf/tau-code-protocol';

/** One line of the tree view: a node at a depth. */
export interface TreeLine {
  node: Node;
  /** Branch depth: 0 on the root's line, +1 for each branch taken off a line. */
  depth: number;
  /** A short summary of the node. */
  summary: string;
  /** How many children it has (more than one: a branch point). */
  children: number;
}

/**
 * The held tree as lines, depth first, each node's first child continuing its line at the same
 * depth and the others branching one deeper. Branches are listed in id order, so a line reads as
 * the conversation went. Pure.
 */
export function treeLines(model: SessionModel): TreeLine[] {
  const lines: TreeLine[] = [];
  // An explicit stack: a long conversation is a chain thousands of nodes deep.
  const stack: { id: number; depth: number }[] = model
    .roots()
    .sort((a, b) => b.id - a.id)
    .map((root) => ({ id: root.id, depth: 0 }));
  while (stack.length) {
    const { id, depth } = stack.pop() as { id: number; depth: number };
    const node = model.nodes.get(id);
    if (!node) continue;
    const children = model.childrenOf(id);
    lines.push({ node, depth, summary: summary(node), children: children.length });
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({ id: children[i] as number, depth: i === 0 ? depth : depth + 1 });
    }
  }
  return lines;
}

/** A node in a few words: its kind and the start of its text. */
export function summary(node: Node): string {
  const body = node.body;
  const clip = (text: string): string => {
    const line = text.replace(/\s+/g, ' ').trim();
    return line.length > 80 ? `${line.slice(0, 79)}…` : line;
  };
  switch (bodyKind(body)) {
    case 'System':
      return 'system prompt';
    case 'User':
      return clip((body as { User: string }).User);
    case 'Assistant': {
      const parts = (body as Extract<Node['body'], { Assistant: unknown }>).Assistant.parts;
      const text = parts.find((part) => 'Text' in part);
      const calls = parts.filter((part) => 'Call' in part).map((part) => ('Call' in part ? part.Call.tool : ''));
      const said = text && 'Text' in text ? clip(proseText(text.Text)) : '';
      return [said, calls.length ? `calls ${calls.join(', ')}` : ''].filter(Boolean).join(' · ') || 'reply';
    }
    case 'Results':
      return `results (${(body as { Results: unknown[] }).Results.length})`;
    case 'Config':
      return 'config';
    case 'Custom':
      return `custom ${(body as { Custom: { kind: string } }).Custom.kind}`;
  }
}
