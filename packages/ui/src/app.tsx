import { useCallback, useMemo, useState } from 'react';
import type { LinkState, SessionLink } from '@ffwf/tau-code-protocol';
import { ActivityMark } from './activity-mark.js';
import { tokensText } from './attachments.js';
import { Composer } from './composer.js';
import { CursorTabs, Items, StepControls } from './cursors.js';
import type { Call } from './line.js';
import { Questions } from './questions.js';
import { Transcript } from './transcript.js';
import { TreePanel } from './tree-panel.js';
import { useLink } from './use-link.js';

export interface TauAppProps {
  link: SessionLink;
  /**
   * What the host says when the link has failed, by refusal: how to get a token in this host,
   * say. A host with nothing to add leaves it out; τ's sentence is shown either way.
   */
  hints?: Partial<Record<NonNullable<LinkState['refusal']>, string>>;
}

/**
 * A τ session, whole: the cursors, the followed cursor's conversation and live layer, its questions,
 * pending input and step controls, the composer, and the tree. Host-agnostic: it is handed a
 * `SessionLink` and knows nothing of where the transport goes, so a browser page and an editor's
 * webview mount the same component. The host starts the link and disposes of it.
 */
export function TauApp({ link, hints = {} }: TauAppProps): JSX.Element {
  const state = useLink(link);
  const [problem, setProblem] = useState<string | null>(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const call = useMemo<Call>(() => link.call.bind(link) as Call, [link]);
  const focus = useCallback((cursor: number) => link.focus(cursor), [link]);
  const load = useCallback(() => link.loadTree(), [link]);

  const { model, welcome, phase } = state;
  if (!welcome) return <Connection state={state} hint={state.refusal ? hints[state.refusal] : undefined} onRetry={() => link.retry()} />;

  const view = state.focus === null ? undefined : model.views.get(state.focus);
  const walk = view ? model.walk(view.at) : null;
  const open = model.openCursors();
  const notices = model.noticesFor(state.focus);
  const modelInfo = model.modelInfo(view?.model);
  return (
    <div className="tau-app">
      <header className={`tau-status tau-status-${phase}`}>
        <ActivityMark working={open.some((v) => v.busy)} unread={open.some((v) => v.questions.length > 0)} />
        <span className="tau-dot" />
        <span className="tau-status-session" title={`${welcome.session} in ${welcome.cwd}`}>
          {welcome.session}
        </span>
        <span className="tau-hint" title="the session's working directory">
          {welcome.cwd}
        </span>
        <span className="tau-spacer" />
        {view?.model && (
          <span className="tau-hint" data-testid="model">
            model {view.model}
            {modelInfo?.context_window != null && ` (${tokensText(modelInfo.context_window)} context)`}
            {modelInfo && modelInfo.images === null && ', no images'}
          </span>
        )}
        <span className="tau-hint">tau {welcome.version}</span>
        <button type="button" className="tau-link" onClick={() => setTreeOpen(!treeOpen)} aria-pressed={treeOpen}>
          {treeOpen ? 'hide tree' : 'tree'}
        </button>
      </header>
      {phase !== 'ready' && (
        <div className="tau-banner" role="status">
          {phase === 'failed' ? 'disconnected' : 'reconnecting'}: {state.detail}{' '}
          <button type="button" className="tau-link" onClick={() => link.retry()}>
            retry now
          </button>
          {state.refusal && hints[state.refusal] && <div>{hints[state.refusal]}</div>}
        </div>
      )}
      <CursorTabs model={model} focus={state.focus} onFocus={focus} call={call} report={setProblem} />
      <main className="tau-main">
        {view ? (
          <Transcript walk={walk} layer={model.layers.get(view.cursor)} client={link.clientId} />
        ) : (
          <div className="tau-transcript tau-hint">
            no cursor is open: reopen a closed one above, or open one from the tree
          </div>
        )}
        {treeOpen && (
          <TreePanel
            model={model}
            loaded={state.treeLoaded}
            load={load}
            focus={state.focus}
            onFocus={focus}
            call={call}
            report={setProblem}
          />
        )}
      </main>
      <footer className="tau-footer">
        {notices.length > 0 && (
          <div className="tau-notices" data-testid="notices">
            {notices.map((notice) => (
              <div key={notice.id} className={`tau-notice tau-notice-${notice.level}`} role={notice.level === 'error' ? 'alert' : 'status'}>
                {notice.extension !== null && <span className="tau-notice-from">{notice.extension}</span>}
                {notice.text}{' '}
                <button type="button" className="tau-link" title="dismiss" onClick={() => model.dismiss(notice.id)}>
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {(problem ?? state.problem) && (
          <div className="tau-error" role="alert">
            {problem ?? state.problem}{' '}
            <button
              type="button"
              className="tau-link"
              onClick={() => {
                setProblem(null);
                link.clearProblem();
              }}
            >
              ×
            </button>
          </div>
        )}
        {view && (
          <>
            {view.shown.length > 0 && (
              <div className="tau-shown">
                {view.shown.map(([extension, text]) => (
                  <span key={extension} className="tau-hint">
                    {extension}: {text}
                  </span>
                ))}
              </div>
            )}
            <Questions key={view.cursor} questions={view.questions} client={link.clientId} call={call} />
            <Items view={view} client={link.clientId} call={call} report={setProblem} />
            <StepControls view={view} call={call} report={setProblem} />
            <Composer key={view.cursor} cursor={view.cursor} call={call} note={(text, level) => model.notify(text, level, view.cursor)} commandsVersion={model.commandsVersion} takesImages={modelInfo === undefined || modelInfo.images !== null} />
          </>
        )}
      </footer>
    </div>
  );
}

/** Before the first `hello`: connecting, or why it cannot. */
function Connection({ state, hint, onRetry }: { state: LinkState; hint: string | undefined; onRetry: () => void }): JSX.Element {
  return (
    <div className="tau-app tau-connection" data-testid="connection">
      <div className={`tau-status tau-status-${state.phase}`}>
        <ActivityMark working={state.phase === 'connecting'} unread={false} />
        <span className="tau-dot" />
        {state.phase === 'failed' ? 'cannot connect' : 'connecting to tau serve…'}
      </div>
      {state.detail && <p className={state.phase === 'failed' ? 'tau-error' : 'tau-hint'}>{state.detail}</p>}
      {hint && <p>{hint}</p>}
      {state.phase === 'failed' && (
        <button type="button" onClick={onRetry}>
          try again
        </button>
      )}
    </div>
  );
}
