# ffwf-tau-code

Clients for [τ](https://github.com/jmccardle/tau), the Python agent harness: a
connection server, a standalone web client, and a VS Code / VSCodium extension.

τ itself is not in this repository. This repository talks to it over τ's
documented JSON-RPC protocol, and spawns it as a child process.

**Status: scaffold.** Chat works end to end, with Tab completion for `/commands`
and `@files`. The conversation tree browser and the editor integrations are
designed for but not built. `docs/ARCHITECTURE.md` says what exists, what is
missing, and why the layering is the way it is.

Requires τ at **protocol 1.4 or later** for `@file` completion. Everything else
works against 1.3; the composer says so rather than failing. The τ on PyPI is
0.9.6, which speaks 1.3.

## Artifacts

Three, and no more:

| Artifact | Build it with | What it is |
|---|---|---|
| `ffwf-tau-code-<version>.vsix` | `npm run package:vsix` | The editor extension |
| `ffwf/tau-code:<version>` | `npm run package:image` | τ and the web client, in one container |
| this checkout | `npm install && npm run build` | Both of the above, run from source |

`npm run package` builds both artifacts. It publishes nothing.

## What is here

| Package | What it is | Runs where |
|---|---|---|
| `@ffwf/tau-code-protocol` | Generated types and a JSON-RPC client | anywhere |
| `@ffwf/tau-code-runner` | Owns a `tau --mode rpc` child process | Node |
| `@ffwf/tau-code-ui` | React components | anywhere |
| `@ffwf/tau-code-server` | WebSocket server for browser clients | Node |
| `@ffwf/tau-code-web` | The standalone browser client | browser |
| `tau-code` (publisher `ffwf`) | The editor extension | VS Code |

None of these is published to npm. They are workspace packages, and the names
exist so the imports read the same as they would if they were.

The dependency direction is one way. `@ffwf/tau-code-ui` imports no host: it is
handed a `Transport` and does not learn whether it is a WebSocket or the
webview's `postMessage` channel. That is what lets the same components run in
the browser and in the editor.

## Requirements

- Node 20 or later.
- τ installed, with its `tau` console script reachable. Set `TAU_BIN` if it is
  not on `PATH`:

  ```bash
  export TAU_BIN=/path/to/agent-harness-py/venv/bin/tau
  ```

## Setup

```bash
npm install
npm run generate     # reads the protocol from a live tau process
npm run build
```

`npm run generate` spawns τ, sends one `get_capabilities` request, and writes
`packages/protocol/src/generated.ts` from the answer. The wire is the source of
truth; nothing in that file is hand-maintained. `npm run check:protocol` fails
if the committed file and the installed τ disagree.

## Run the web client

```bash
npm run build --workspace @ffwf/tau-code-web
node packages/server/dist/cli.js --cwd /path/to/your/project
```

The server prints an authenticated URL. Open it.

```
  tau-code server is running.

  Open this link:

      http://127.0.0.1:8791/?token=6f1c...

  Press Ctrl+C to stop.
```

A token is always required, including on loopback. `--bind 0.0.0.0` exposes the
server to your network and prints a warning saying so; there is no TLS, so put a
reverse proxy in front of it if the network is not one you control.

### Sharing sessions with the τ TUI

By default τ writes an RPC host's sessions to a private
`<tmp>/.tau-<uid>/sessions`, so this client does not fill the session list you
see in the TUI. **Those do not survive a reboot that clears the temp
directory.** To share one store instead:

```bash
node packages/server/dist/cli.js --session-dir ~/.tau/sessions
```

or, in the extension, set `tau-code.sessionDir` to `~/.tau/sessions`.

Resume then works in both directions — the picker in this client lists sessions
the TUI wrote, and `tau --continue` resumes ones written here. See
`docs/ARCHITECTURE.md` §5.2 for what was measured.

`node packages/server/dist/cli.js --help` lists the rest.

## Run the container

The container is the whole web instance in one artifact: Python runs τ, Node
runs the connection server, and the browser gets the web client. Nothing has to
be installed on the host except a container runtime.

```bash
npm run package:image                 # -> ffwf/tau-code:<version>

docker run --rm -p 127.0.0.1:8791:8791 -v "$PWD:/work" \
  -e TAU_MODEL_BASE_URL=http://host.docker.internal:8000/v1 \
  -e TAU_MODEL_NAME=your-model \
  ffwf/tau-code
```

It prints the same authenticated URL the server always prints. Open it.

- **`-v "$PWD:/work"` is the working directory the agent's tools resolve
  against.** Without it the agent can see nothing of yours. The image runs as
  uid 1000; build with `--build-arg TAU_UID=$(id -u) --build-arg TAU_GID=$(id -g)`
  if that is not you.
- **`TAU_MODEL_BASE_URL` is required**, unless you mount your own config at
  `/home/node/.tau/config.json`. τ's first-run template points at
  `localhost:8000`, which inside a container is wrong and wrong quietly — the
  server would start and the first turn would fail. The entrypoint refuses
  instead. `TAU_API_KEY` and `TAU_SYSTEM_PROMPT` are the other two knobs.
- **The server binds `0.0.0.0` inside the container and says so in a warning.**
  That warning describes the container's network, not yours: what is actually
  exposed is set by `-p`. `-p 127.0.0.1:8791:8791` keeps it on your loopback.
- **A remapped port breaks the printed link.** The server prints the port it
  listens on (8791), not the one you published. Set `TAU_CODE_TOKEN` to a value
  you choose and build the URL yourself. The token then shows up in
  `docker inspect`.
- Which τ is baked in is the `TAU_SPEC` build argument, `ffwf-tau==0.9.6` today.

`docker build --target verify -t ffwf/tau-code-verify . && docker run --rm
ffwf/tau-code-verify` starts τ inside the image and reads back its protocol
version. It contacts no model. `npm run package:image` runs it for you.

## Run the extension

```bash
npm run build --workspace packages/vscode
code --extensionDevelopmentPath=packages/vscode
```

Then open the τ view in the activity bar. Settings live under `tau-code.*`:
`binary`, `model`, `provider`.

To build an installable `.vsix` instead:

```bash
npm run package:vsix                              # -> ffwf-tau-code-<version>.vsix
code --install-extension ffwf-tau-code-0.2.0.vsix
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

**The extension needs a folder or workspace open.** With none there is no honest
working directory for the agent's tools, so it refuses to start and the panel
says so.

The extension declares `extensionKind: ["workspace"]`, so over SSH, in WSL, or
in a devcontainer the agent runs where the code is while the panel renders
locally. That split is the one thing the standalone web client cannot
reproduce.

## Verify

```bash
npm run typecheck        # all six packages
npm test                 # the conversation store and the completion logic
npm run smoke            # spawn tau, negotiate, read state and tools
npm run smoke:server     # auth, static serving, a WebSocket round trip,
                         # and @file expansion end to end

# With a server already running, load the page in real headless Chrome:
npm run smoke:browser -- 'http://127.0.0.1:8791/?token=...' shot.png

# ...and drive Tab completion in it -- real key events, real popup, real tau.
npm run smoke:completion -- 'http://127.0.0.1:8791/?token=...' shot.png
```

`smoke:server` submits one prompt and aborts it immediately, to check that the
`@file` a user completed actually reaches the model as content. It does that
against whatever model your config names, so it is one short local call rather
than free. Nothing else here sends a prompt.

`npm run package` runs the version check, `typecheck`, `test` and
`check:protocol` before it builds anything, and stops at the first failure.
`check:protocol` is skipped, loudly, when no τ is reachable — it is the only one
of the four that needs a live agent.

## Publishing

Two scripts, each publishing one kind of thing. Neither runs as part of a
build, and both read their credentials from the environment.

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

Each placeholder is a README and no code. The npm organisation `@ffwf` is the
reservation that actually matters and it is already claimed, so nothing under
`@ffwf/*` needs one; these are the seven unscoped `ffwf-tau*` names plus
`tau-code`, and two PyPI names. Both registries are one-way — PyPI names cannot
be released, and npm blocks unpublish after 72 hours.

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
tau's behaviour and it is deliberate; the popup now says so, instead of leaving
it to be discovered.

## What is deliberately missing

Named here rather than discovered later:

- **The conversation tree browser.** τ's differentiator, and the reason this
  repository exists. It needs tree verbs on the wire; τ has none today.
- **Renaming a session.** `set_session_name` is on the wire; the picker lists,
  switches, forks and starts, but does not rename yet.
- **`/tree` and `/extensions`.** tau resolves both and expects the frontend to
  perform them. This head does not, so it says which head is missing what. They
  are listed in the completion popup, greyed.
- **Removing an attachment by clicking it.** The tau TUI has a bar of attached
  files with a click-to-remove. Here the `@word` is the only handle: delete it
  from the text.
- **Jump-to-edit and diff views.** τ's tools compute the data and the agent loop
  discards it before a message is built.
- **Live tool arguments.** They are not on the event stream, by design. During a
  call the UI shows the tool's name and that it is running; the arguments arrive
  with the pull at turn end.
- **Backpressure.** The server does not bound a slow client's queue.
- **Restarting the agent from the panel.** When there is no agent the panel says
  why and names the command that fixes it; it does not run it. In VS Code that
  is `tau: Restart Agent`; for the standalone server it is a restart of the
  server process, which does not respawn τ on its own.

`docs/ARCHITECTURE.md` has the detail, including what has to change in τ first.

## License

MIT.
