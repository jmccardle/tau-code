import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Root, RootContent } from 'mdast';

/**
 * Model prose, rendered as Markdown.
 *
 * ## Why a React renderer and not a string of HTML
 *
 * The webview runs under `default-src 'none'` with a nonce on the one script it
 * loads (`session.ts`, `html()`). Any renderer that produces an HTML string has
 * to be handed to `dangerouslySetInnerHTML`, which means the sanitiser is the
 * only thing between a model's output and the DOM. `react-markdown` never
 * produces HTML: it builds a React element tree, so a `<script>` in the model's
 * answer cannot become a script node no matter what it says. The CSP stays a
 * second line of defence rather than the first.
 *
 * The same component runs in the browser client, where there is no editor to
 * inherit a policy from. One renderer, both hosts.
 *
 * ## What is deliberately NOT rendered
 *
 * **Raw HTML is shown as the characters the model wrote.** `react-markdown`
 * drops `html` nodes when `rehype-raw` is absent, and dropping them silently is
 * the exact failure this project keeps finding: tau's own attachment vocabulary
 * is `<attachment>` and `<reference filename= …>` (FILE-ATTACHMENTS.md section
 * 2), so a dropped `html` node would erase, from the transcript, the block that
 * says what was actually sent to the model. `literalHtml` below turns those
 * nodes into text before they can be dropped.
 *
 * **Images do not load.** The CSP allows `img-src` only from the extension's
 * own directory and `data:`, so a remote `![alt](https://…)` would render as a
 * broken-image icon. It renders as a link instead, which says the same thing
 * and can be clicked.
 *
 * **Code is not syntax-highlighted.** A highlighter needs a token palette, and
 * VS Code exports theme variables for editor chrome but not for token colours
 * -- so any palette we shipped would be our colours sitting inside the user's
 * theme. Code blocks take the editor's font and the theme's code background,
 * and that is all.
 */

/** A minimal mdast walk. Avoids a dependency for twelve lines of recursion. */
function walk(node: Root | RootContent, visit: (child: RootContent, parent: Root | RootContent, index: number) => void): void {
  const children = (node as { children?: RootContent[] }).children;
  if (!children) return;
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (!child) continue;
    visit(child, node, i);
    walk(child, visit);
  }
}

/**
 * Turn `html` nodes into the text they were written as.
 *
 * Without this they reach `remark-rehype` as `raw` nodes and are discarded,
 * because `allowDangerousHtml` is off. Discarded is worse than literal: the
 * reader loses the fact that the text was there at all.
 */
function literalHtml() {
  return (tree: Root): void => {
    walk(tree, (child, parent, index) => {
      if (child.type !== 'html') return;
      const children = (parent as { children: RootContent[] }).children;
      children[index] = { type: 'text', value: child.value };
    });
  };
}

/**
 * `pre` owns the block, `code` stays a bare element.
 *
 * react-markdown 9 removed the `inline` prop, and every replacement heuristic
 * (does the class name start with `language-`?) gets inline code with no
 * language wrong. Overriding the two elements separately needs no heuristic:
 * a fenced block is a `code` inside a `pre`, an inline span is a `code` that is
 * not, and the stylesheet can tell them apart with a selector.
 */
const COMPONENTS: Components = {
  pre: ({ children }) => <pre className="tau-md-pre">{children}</pre>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
  img: ({ src, alt }) =>
    typeof src === 'string' ? (
      <a className="tau-md-image" href={src} target="_blank" rel="noreferrer noopener">
        {alt && alt !== '' ? alt : 'image'} ↗
      </a>
    ) : null,
  // A wide table must scroll inside itself rather than widening the panel; the
  // sidebar is narrow and the transcript is the only thing that may scroll.
  table: ({ children }) => (
    <div className="tau-md-tablewrap">
      <table>{children}</table>
    </div>
  ),
};

const PLUGINS = [remarkGfm, literalHtml];

export interface MarkdownProps {
  text: string;
}

/**
 * One Markdown region.
 *
 * `useMemo` is keyed on the text, which does nothing for a message that is
 * still growing -- every delta is a new string -- and everything for the
 * finished transcript above it, which re-renders on every delta and must not
 * re-parse. See MARKDOWN.md section 3 for the measurement.
 */
export function Markdown({ text }: MarkdownProps): JSX.Element {
  const rendered = useMemo(
    () => (
      <ReactMarkdown remarkPlugins={PLUGINS} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    ),
    [text],
  );
  return <div className="tau-md">{rendered}</div>;
}

/* --------------------------------------------------------------- live text */

/**
 * The lower bound on the gap between two renders of a growing message.
 *
 * 33ms is one frame at 30Hz. Faster than this buys nothing a reader can see.
 */
const MIN_WAIT_MS = 33;

/**
 * The upper bound, so a very long answer still visibly moves.
 *
 * At 500ms the text arrives in visible steps rather than a flow. That is the
 * honest trade at the size where it applies, and it applies to almost nothing:
 * a message has to be past about 40 KB to reach it.
 */
const MAX_WAIT_MS = 500;

/**
 * How much of the wait the last render is allowed to have been.
 *
 * The wait is `cost * SHARE`, so parsing takes at most `1/(SHARE+1)` of the
 * main thread no matter how long the message gets. This is the number to change
 * if streaming feels stuttery (lower) or the panel feels busy (higher).
 */
const SHARE = 3;

/**
 * Markdown for a message that is still arriving.
 *
 * Re-parsing on every delta does not scale, and the cost is in the Markdown
 * parse rather than in React. Measured with `remark-parse` + `remark-gfm` +
 * `remark-rehype` on representative prose (paragraphs, a fenced block, a list):
 *
 * | message | mdast + hast | + React |
 * |---|---|---|
 * | 2 KB | 6.2 ms | 5.9 ms |
 * | 8 KB | 15.0 ms | 19.6 ms |
 * | 20 KB | 53.8 ms | 66.2 ms |
 *
 * A 20 KB answer arrives as roughly a thousand deltas, so parsing each one
 * would spend about a minute of blocked main thread on a single message. There
 * is no incremental parse to reach for: an unclosed fence earlier in the text
 * changes how the tail parses, so the prefix is not stable and cannot be
 * cached.
 *
 * So the render is SAMPLED, and the sampling rate is derived from what the last
 * one actually cost rather than fixed. A fixed interval is wrong at both ends:
 * 100ms wastes the thread on a short message and still burns half of it on a
 * long one. Timing the previous render bounds the cost as a fraction, which
 * holds at any length.
 *
 * The last value is never dropped. When the deltas stop, the pending text is
 * one timer away from being shown, and `agent_end` replaces this component with
 * the durable message anyway.
 */
export function LiveMarkdown({ text }: MarkdownProps): JSX.Element {
  const [shown, setShown] = useState(text);
  const latest = useRef(text);
  const cost = useRef(MIN_WAIT_MS);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measured = useRef<string | null>(null);
  latest.current = text;

  const started = performance.now();
  useLayoutEffect(() => {
    // Only a render that actually re-parsed says anything about the cost. A
    // re-render caused by the parent hits `Markdown`'s memo and returns in
    // microseconds; letting that set the interval would schedule the next real
    // parse immediately, which is the behaviour this exists to avoid.
    if (measured.current === shown) return;
    measured.current = shown;
    cost.current = performance.now() - started;
  });

  useEffect(() => {
    if (text === shown || timer.current !== null) return;
    const wait = Math.min(MAX_WAIT_MS, Math.max(MIN_WAIT_MS, cost.current * SHARE));
    timer.current = setTimeout(() => {
      timer.current = null;
      setShown(latest.current);
    }, wait);
  }, [text, shown]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  return <Markdown text={shown} />;
}
