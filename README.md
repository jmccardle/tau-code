# ffwf-tau-code

Clients for [τ](https://github.com/jmccardle/tau), the Python agent harness: a
web client and a VS Code / VSCodium extension, both speaking to `tau serve`.

τ itself is not in this repository. `tau serve` is τ's daemon: it owns the
sessions and streams them over a WebSocket to any number of clients. A browser
tab, a VS Code panel and `tau --connect` attached to one session see one tree,
and each can drive it.

**Status: chat and the conversation tree both work end to end**, in the browser
and in the editor, with Tab completion for `/commands` and `@files`. The editor
integrations — jump-to-edit, diff views — are designed for but not built:
`docs/ARCHITECTURE.md` §7.1 says what τ still computes and discards.

Requires **τ 0.12.0** (`pip install 'ffwf-tau[serve]'`), the first release with
`tau serve`. The client says which serve protocol it speaks in its first frame,
and a daemon speaking another refuses it with a sentence naming both versions.

## Artifacts

| Artifact | Build it with | What it is |
|---|---|---|
| `ffwf-tau-code-<version>.vsix` | `npm run package:vsix` | The editor extension |
| `ffwf/tau-code:<version>` | `npm run package:image` | `tau serve` and the web client, in one container |
| `ffwf-tau-runtime-<version>-<target>.vsix` | `npm run package:runtime` | An optional CPython with τ in it, per platform |
| this checkout | `npm install && npm run build` | All of the above, run from source |

`npm run package` builds the first two and publishes nothing. The runtime is
separate on purpose: it downloads a CPython per target and is the only artifact
here not built purely from this checkout. See `docs/ARCHITECTURE.md` §14.

## What is here

| Package | What it is | Runs where |
|---|---|---|
| `@ffwf/tau-code-protocol` | Generated types, a serve-protocol client, and the session replica | anywhere |
| `@ffwf/tau-code-ui` | React components and the stores they read | anywhere |
| `@ffwf/tau-code-web` | The standalone browser client, which `tau serve` hosts | browser |
| `tau-code` (publisher `ffwf`) | The editor extension | VS Code |
| `tau-runtime` (publisher `ffwf`) | An optional CPython with τ in it | VS Code |

None of these is published to npm. They are workspace packages, and the names
exist so the imports read the same as they would if they were.

`tau-runtime` is the odd one: it ships no library and imports nothing here. It
carries a directory of files and answers one question — where they are — which
is why it can be installed, removed and versioned without touching anything
else.

The dependency direction is one way. `@ffwf/tau-code-ui` imports no host: it is
handed a way to open a `Transport` and does not learn whether it is a WebSocket
or the webview's relay through the extension host. That is what lets the same
components run in the browser and in the editor.

## Requirements

- Node 20 or later.
- τ 0.12.0 or later with its `serve` extra, and its `tau` console script
  reachable. Set `TAU_BIN` if it is not on `PATH`:

  ```bash
  export TAU_BIN=/path/to/agent-harness-py/venv/bin/tau
  ```

  **In the editor there is a second option:** install `ffwf.tau-runtime`, an
  optional companion extension that ships its own CPython with τ installed into
  it, and nothing needs to be on `PATH` at all. See
  [Which τ runs](#which-τ-runs).

## Setup

```bash
npm install
npm run generate     # reads the protocol from the installed tau
npm run build
```

`npm run generate` runs `tau serve --schema` and writes
`packages/protocol/src/generated.ts` from the JSON Schema τ prints — every
request, what each answers, every event and every entry. τ's protocol
dataclasses are the source of truth; nothing in that file is hand-maintained.
`npm run check:protocol` fails if the committed file and the installed τ
disagree.

## Run the web client

`tau serve` hosts it. Point `serve.web_root` in `~/.tau/config.json` at the
built client, or pass it on the command line:

```bash
npm run build --workspace @ffwf/tau-code-web
tau serve --web-root packages/web/dist-web
```

Then open `http://127.0.0.1:8256/` (or whatever `serve.listen` says). The page
and its socket are one origin, so the daemon's Origin check passes with nothing
to configure.

- **Sessions are the daemon's.** The picker lists every session in its store,
  across every working directory, grouped by directory — the same list
  `tau --connect` shows. A new session starts in the daemon's own working
  directory unless you type another; a session is created when you send, not
  when you open the page.
- **A token is opt-in**, as it is for τ everywhere: set `serve.token` in τ's
  config and open the page with `?token=...`. The page sends it in its first
  frame; without one the daemon refuses and the page asks for it.
- **Serving the page from somewhere else** — a Vite dev server on :5173, say —
  needs that origin in `serve.allowed_origins`, and `?daemon=HOST:PORT` on the
  page's URL to say where the daemon is.

## Run the container

The container is the whole web instance in one artifact: `tau serve`, with the
web client it hosts. Nothing has to be installed on the host except a container
runtime, and there is no Node in it.

```bash
npm run package:image                 # -> ffwf/tau-code:<version>

docker run --rm -p 127.0.0.1:8256:8256 -v "$PWD:/work" \
  -e TAU_MODEL_BASE_URL=http://host.docker.internal:8000/v1 \
  -e TAU_MODEL_NAME=your-model \
  ffwf/tau-code
```

Then open `http://127.0.0.1:8256/`.

- **`-v "$PWD:/work"` is the working directory the agent's tools resolve
  against.** The daemon runs there, so new sessions start there. The image runs
  as uid 1000; build with `--build-arg TAU_UID=$(id -u) --build-arg TAU_GID=$(id -g)`
  if that is not you.
- **`TAU_MODEL_BASE_URL` is required**, unless you mount your own config at
  `/home/tau/.tau/config.json`. τ's first-run template points at
  `localhost:8000`, which inside a container is wrong and wrong quietly. The
  entrypoint refuses instead. `TAU_API_KEY` and `TAU_SYSTEM_PROMPT` are the
  other two knobs.
- **The daemon listens on `0.0.0.0` inside the container**; what is actually
  exposed is set by `-p`. `-p 127.0.0.1:8256:8256` keeps it on your loopback. A
  remapped port (`-p 9000:8256`) works: the daemon's Origin check compares a
  page's origin with the host it dialled, not with the port it listens on.
- Which τ is baked in is the `TAU_SPEC` build argument,
  `ffwf-tau[serve]==0.12.0`. Until a release is on PyPI, build against local
  wheels with `docker build --build-context tau-wheels=DIR .`, or
  `TAU_WHEELS=DIR npm run package:image`.

`docker build --target verify -t ffwf/tau-code-verify . && docker run --rm
ffwf/tau-code-verify` starts the daemon inside the image, says hello at the
protocol this client was generated against, and fetches the page. It contacts no
model. `npm run package:image` runs it for you.

## Run the extension

```bash
npm run build --workspace packages/vscode
code --extensionDevelopmentPath=packages/vscode
```

Then open the τ view in the activity bar. The extension runs `tau serve -d`,
which finds the daemon τ's config names or starts one, and every panel in the
window connects to it. Settings live under `tau-code.*`: `runtime` and `binary`
(which τ starts the daemon), `model` (the model a new session starts on), and
`token` (for a daemon with `serve.token` set).

To build an installable `.vsix` instead:

```bash
npm run package:vsix                              # -> ffwf-tau-code-<version>.vsix
code --install-extension ffwf-tau-code-0.5.2.vsix
```

**If you installed 0.1.x, uninstall it first.** The extension ID changed from
`tau-code.tau-code-vscode` to `ffwf.tau-code` in 0.2.0, so the editor treats the
new one as a different extension and leaves the old one in place:

```bash
code --uninstall-extension tau-code.tau-code-vscode
```

`code` and `codium` keep separate extension directories, so installing into one
does not update the other. Installing a version that is already present is a
no-op — bump `packages/vscode/package.json`, or pass `--force`.

**New sessions start in the workspace folder** — the active file's folder in a
multi-root workspace. The panel lists every session the daemon holds; with no
folder open you can still open one of those, but there is no folder to start a
new one in, and the composer says so.

The extension declares `extensionKind: ["workspace"]`, so over SSH, in WSL, or
in a devcontainer the daemon starts where the code is while the panel renders
locally, and the extension host relays between them. That split is the one thing
the standalone web client cannot reproduce. A daemon outlives the window that
started it, so a window reload re-attaches to the session it was on — a turn
that was running is still running.

## Verify

```bash
npm run typecheck        # every package
npm test                 # the stores, the completion logic, and the tree rules
npm run smoke            # start a throwaway tau serve, say hello, open a session
npm run smoke:tree       # read a COPY of a real session's tree through the daemon,
                         # and run the row planner and fold reader over it

# With a daemon already serving the web client, load the page in real headless
# Chrome:
npm run smoke:browser -- 'http://127.0.0.1:8256/' shot.png

# ...and drive Tab completion in it -- real key events, real popup, real tau.
npm run smoke:completion -- 'http://127.0.0.1:8256/' shot.png

# ...and the tree browser: rows, zones, keys, the detail pane.
npm run smoke:tree-ui -- 'http://127.0.0.1:8256/' shot.png

# ...and the flow dialog and the extension panel.
npm run smoke:panels -- 'http://127.0.0.1:8256/' shot.png
```

`smoke` and `smoke:tree` start their own daemon in a throwaway HOME on a free
port (`scripts/lib/daemon.mjs`), so neither touches `~/.tau`; `smoke:tree`
copies the session it reads into that HOME. Neither sends a prompt.

`npm run package` runs the version check, `typecheck`, `test` and
`check:protocol` before it builds anything, and stops at the first failure.
`check:protocol` is skipped, loudly, when no τ is reachable — it is the only one
of the four that needs τ installed.

## Publishing

Two scripts, each publishing one kind of thing. Neither runs as part of a
build, and both read their credentials from the environment.

### Releases

Pushing a `v*` tag builds everything and attaches it to a GitHub release:
`.github/workflows/release.yml`. One Linux runner produces all ten `.vsix`
files — the universal `ffwf-tau-code`, and one `ffwf-tau-runtime` per target —
and the release body is generated from each payload's own `manifest.json`, so
it states the τ that shipped rather than the one that was asked for. The tag
has to agree with the tree; `scripts/check-version.mjs` is what makes "HEAD at
a version tag is the released version" a check rather than a habit.

Running it by hand (**Actions > release > Run workflow**) takes a ref, and the
ref decides: pick a **branch** and it runs the same checks and the same ten
builds and creates no release, which is how to find out before tagging; pick a
**tag** and it makes the release. A dispatch runs the workflow as it exists at
the ref you pick, so only a tag that already contains this file can be released
that way — `v0.5.0` predates it and cannot be. Neither path publishes to a
marketplace:
that stays the two scripts below, because a published version number cannot be
reused. `docs/ARCHITECTURE.md` §14.8 has the rest.

### The extension

```bash
export VSCE_PAT=...    # Azure DevOps token, Marketplace > Manage scope
export OVSX_PAT=...    # open-vsx.org/user-settings/tokens
npm run publish:extension              # both marketplaces
npm run publish:extension -- vscode    # or one of them
npm run publish:extension -- openvsx
```

It publishes the **`.vsix`**, not the working tree, so both marketplaces get
bit-identical archives. Before uploading anything it checks the version inside
the archive against the tree, verifies the token belongs to the `ffwf`
publisher, and fetches the repository URL — a marketplace listing is mostly
this README's sibling in `packages/vscode/`, and a listing that links to a 404
can only be fixed by publishing again. `--no-repo-check` skips that last one.

A published version number cannot be reused on either marketplace. Bump it.

### The names

Nothing here is published to npm; see `docs/ARCHITECTURE.md` §9.1 for why. The
names are still worth holding so nobody else takes them:

```bash
PYTHON=/path/to/venv/bin/python npm run reserve:names            # dry run
PYTHON=/path/to/venv/bin/python npm run reserve:names -- --publish
```

Each placeholder is a README and no code, published and then deprecated so npm
prints the notice on any install.

**This has been run.** All nine names are held, and the npm organisation `@ffwf`
covers `@ffwf/*` besides. `docs/ARCHITECTURE.md` §9.5 lists what is claimed
where, and the two credential rules that each cost a failed run: npm needs a
granular token with 2FA bypass rather than a `npm login` session, and PyPI
cannot scope a token to a name that does not exist yet. The script stays for the
next name; a re-run of these fails, because a published version cannot be
replaced.

## Which τ runs

There can be two: one on `PATH`, and the one inside the optional
`ffwf.tau-runtime` extension. **The panel never picks between them silently.**
When both are installed at different versions, a banner above the transcript
names both and offers the setting:

```
┌──────────────────────────────────────────────────────────────────────┐
│ Two taus are installed and they are different versions. Running      │
│ 0.10.3, from the tau runtime extension (linux-x64, Python 3.11.16).  │
│ Also found 0.10.2, from tau on PATH. The "tau-code.runtime" setting  │
│ chooses between them.                          [ Choose ]      [ ✕ ] │
└──────────────────────────────────────────────────────────────────────┘
```

That is not decoration. Every symptom of running the wrong τ — a missing verb,
a different tool set, a protocol mismatch — points at τ rather than at the
choice that selected it, which makes it the one thing this client can get wrong
in a way you cannot see. The output channel says which was chosen and which was
not, on every start.

The order, and the reasoning, is `docs/ARCHITECTURE.md` §14.3:

1. `tau-code.binary`, when you have set it to something other than `tau`. A
   path is an instruction: it wins outright, and if it does not work that is an
   error rather than a reason to run a different τ.
2. `TAU_BIN`.
3. The runtime extension, if installed.
4. `tau` on `PATH`.

`tau-code.runtime` overrides steps 3 and 4:

| | |
|---|---|
| `auto` (default) | the runtime extension when installed, otherwise `PATH` |
| `bundled` | only the runtime extension; refuses to start when absent |
| `system` | only `PATH` or `tau-code.binary`; ignore the runtime extension |

### Building the runtime

```bash
npm run package:runtime                                  # this machine's target
TAU_RUNTIME_TARGETS='linux-x64 darwin-arm64 win32-x64' \
  npm run package:runtime                                # named targets
npm run smoke:runtime                                    # drive the built payload
```

It downloads a CPython from python-build-standalone, installs τ with its
`serve` extra into it with `pip --platform`, prunes, and proves the result
starts `tau serve` and answers hello, with none of your environment reaching
it. Measured on linux-x64:
78.3 MB extracted, 52.2 MB after pruning, **18.1 MB packaged**. Which τ it
installs is `tauSpec` in `packages/runtime/package.json`, one copy, and the
payload's `manifest.json` records what pip actually resolved.

All nine of VS Code's desktop targets build from one Linux machine, because
nothing here compiles: the two native wheels in the closure, `pydantic-core` and
`websockets`, publish one for every target. That is what CI does on a tag — see
[Releases](#releases) — so building nine by hand is for when you want them
before there is a tag.

## Changing the model

The model in the status bar opens a picker, in the extension and in the web
client alike. It lists every model name in the daemon's config with the model
each resolves to — a config **name** is not a model **id**: `local-llm` can
resolve to `qwen38-27B`, and the rows show both. A switch applies to this
panel's cursor, from its next turn; this client reads no config file.

See `docs/ARCHITECTURE.md` §11.

## The conversation tree

A τ conversation is a **tree**, not a list. Branching back to an earlier point
does not delete what came after — it leaves it in place as a sibling and starts
a new line. Compaction and elide do not delete either; they insert an anchor
saying where a span was folded out of the model's input. The transcript can only
show one line through that tree. **Tree** in the status bar, or `/tree`, shows
the whole thing.

The keys are the τ TUI's, so someone who has used one has used the other:

```
↵ pick · Space mark · ←→ fold · ^E elide · ^B branch · c copy · v paste · ^D pane · Esc
```

**Indentation counts turns and forks, not messages.** Your message owns the turn
it started — the reply and every tool call hang off it — and the next thing you
asked is that group's *sibling*. A fork indents its branches; a single child does
not. So a hundred linear turns is a hundred rows at one depth, and a conversation
that forked three times is a few levels deep whatever its length. Measured on a
432-entry session: max depth 6.

**Nothing is written while it is open.** Every gesture builds up state in memory;
one key commits and closes, `Esc` discards all of it. A refusal leaves the
browser open on the row you were looking at, so you can move and try again.

Two things that read backwards until you have seen them once:

- **An elide's two ends bracket what is KEPT.** Over `[1..6]`, pairing 2 with 4
  leaves `[2,3,4]` — not `[1,5,6]`. It is the summary-less form of the
  compaction anchor, and a compaction keeps a tail. The line under the tree says
  what the key will do before you press it, including whether the conversation
  moves back.
- **`Enter` on your own message means "ask this differently".** Continuing below
  a user message would put two user turns in a row, so the cursor moves to its
  parent and the message comes back in the composer to be edited. Send it and
  you have a second branch beside the first, with the original still in the tree.

Marking a row takes its tool group with it — an assistant message and the results
that answered its calls are one unit to every provider, and a branch carrying one
without the other is a prefix the API rejects. The count under the tree always
says `estimate` beside its token figure, because the only measured figure in a
session is `usage.input_tokens` on one finished message.

`docs/ARCHITECTURE.md` §12 has what is different about drawing this out of
process, and §12.6 lists the five gestures that are deliberately not built.

## Extension requests

τ 0.10.0 replaced an extension's blocking `confirm`/`select`/`input` dialogs with
one entry on the conversation tree carrying a lock, a question, or both. **A lock
is a tree node**, so it survives a restart: open the session again and it is
still there, still refusing every prompt.

This client draws it above the transcript, as a form when there is something to
answer and as a sentence when there is not. Three ways out, and it names all
three: answer it, run the command the extension declared, or branch past it in
the tree — a lock is read at the cursor, so moving off it clears it.

## Tab completion

`/` lists tau's commands, `@` lists files. Tab opens the list and writes the
first candidate straight into the editor; Tab again cycles, Shift+Tab goes back.
There is no separate accept key, so the editor always holds exactly what will be
sent.

```
read @packages/ui/src/conv⌷
┌────────────────────────────────┐
│ @packages/ui/src/…    4.1 kB   │
└────────────────────────────────┘
```

The file list comes from **tau**, not from this client, and that is not an
implementation detail: under Remote SSH or in a devcontainer the code lives on
the other machine, and a browser has no filesystem at all. tau answers from the
directory its own tools resolve against.

An unknown `/word` is sent to the model as ordinary text. That has always been
tau's behaviour and it is deliberate; the popup says so, instead of leaving it to
be discovered.

**A command with arguments gets a form, even one this client has never heard of.**
tau declares what each command takes; `/model` with no argument opens a picker
listing the models your config names, read from tau rather than guessed. An
extension that registers a flow gets the same treatment with no code here — which
is the whole point of the vocabulary being on the wire.

## What is deliberately missing

Named here rather than discovered later:

- **Renaming a session.** `set_session_name` is on the wire; the picker lists,
  switches, forks and starts, but does not rename yet.
- **Editing a branch plan before committing it.** `Ctrl+B` derives the keep/copy
  split from your marks and commits; you cannot see that split or force a
  message to be copied. τ's own browser has the same limit.
- **Summarizing exactly a marked set.** The branch chooser has two modes and
  neither writes a summary — one mode away, and not built, in either head.
- **An archive gesture, and a fold header for a compaction.** Both are absences
  τ's own browser has; `docs/ARCHITECTURE.md` §12.6 lists all five.
- **Removing an attachment by clicking it.** The tau TUI has a bar of attached
  files with a click-to-remove. Here the `@word` is the only handle: delete it
  from the text.
- **Jump-to-edit and diff views.** τ's tools compute the data and the agent loop
  discards it before a message is built.
- **Parallel turns from the panel.** A busy cursor queues what you send behind
  the running turn. A second cursor for a parallel turn is on the wire
  (`open_cursor`) and in the session store, and not yet a button.
- **Stopping the daemon from the panel.** It outlives every window by design;
  stop it the way you started it.

`docs/ARCHITECTURE.md` has the detail, including what has to change in τ first.

## About

Built by [FFwF Robotics](https://ffwfrobotics.github.io/) — Fight Fire with Fire
Robotics — whose stated business is loyal automatons for the inevitable machine
uprising. Three projects, usable separately or as one stack: **Tectum**, an
event substrate orchestrated with schema documents; **Tau**, the agent harness
this repository is a client for; and **JMFTS**, a retrieval appliance fusing
Matryoshka embeddings, ColBERT late interaction and BM25 into one hybrid search
on Postgres.

FFwF is [John McCardle](https://ffwf.net/about): a masters in Cyberintelligence
from the University of South Florida, author of
[McRogueFace](https://github.com/jmccardle/McRogueFace), a portable Python/C++
game engine, founder of the Bespoke Robot Society, and president of Kennedy
Space Center's amateur radio club.

## License

MIT.
