# tau-code

Clients for [τ](https://github.com/jmccardle/tau), the Python agent harness: a
connection server, a standalone web client, and a VS Code / VSCodium extension.

τ itself is not in this repository. This repository talks to it over τ's
documented JSON-RPC protocol, and spawns it as a child process.

**Status: scaffold.** Chat works end to end. The conversation tree browser and
the editor integrations are designed for but not built. `docs/ARCHITECTURE.md`
says what exists, what is missing, and why the layering is the way it is.

## What is here

| Package | What it is | Runs where |
|---|---|---|
| `@tau-code/protocol` | Generated types and a JSON-RPC client | anywhere |
| `@tau-code/runner` | Owns a `tau --mode rpc` child process | Node |
| `@tau-code/ui` | React components | anywhere |
| `@tau-code/server` | WebSocket server for browser clients | Node |
| `@tau-code/web` | The standalone browser client | browser |
| `tau-code-vscode` | The editor extension | VS Code |

The dependency direction is one way. `@tau-code/ui` imports no host: it is
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
npm run build --workspace @tau-code/web
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

## Run the extension

```bash
npm run build --workspace tau-code-vscode
code --extensionDevelopmentPath=packages/vscode
```

Then open the τ view in the activity bar. Settings live under `tau-code.*`:
`binary`, `model`, `provider`.

The extension declares `extensionKind: ["workspace"]`, so over SSH, in WSL, or
in a devcontainer the agent runs where the code is while the panel renders
locally. That split is the one thing the standalone web client cannot
reproduce.

## Verify

```bash
npm run typecheck        # all six packages
npm test                 # the conversation store, no network
npm run smoke            # spawn tau, negotiate, read state and tools
npm run smoke:server     # auth, static serving, a live WebSocket round trip

# With a server already running, load the page in real headless Chrome and
# report console errors, failed requests, and whether the app rendered:
npm run smoke:browser -- 'http://127.0.0.1:8791/?token=...' shot.png
```

None of these send a prompt, so none of them cost API credits.

## What is deliberately missing

Named here rather than discovered later:

- **The conversation tree browser.** τ's differentiator, and the reason this
  repository exists. It needs tree verbs on the wire; τ has none today.
- **Renaming a session.** `set_session_name` is on the wire; the picker lists,
  switches, forks and starts, but does not rename yet.
- **Jump-to-edit and diff views.** τ's tools compute the data and the agent loop
  discards it before a message is built.
- **Live tool arguments.** They are not on the event stream, by design. During a
  call the UI shows the tool's name and that it is running; the arguments arrive
  with the pull at turn end.
- **Backpressure.** The server does not bound a slow client's queue.

`docs/ARCHITECTURE.md` has the detail, including what has to change in τ first.

## License

MIT.
