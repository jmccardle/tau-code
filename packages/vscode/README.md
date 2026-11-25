<img src="https://raw.githubusercontent.com/jmccardle/tau-code/master/packages/vscode/media/ffwf-logo.png" alt="FFwF Robotics" width="120" align="right" />

# tau code

Run a [τ](https://github.com/jmccardle/tau) agent inside VS Code or VSCodium.

τ is a Python agent harness. This extension is a client of `tau serve`, τ's
server for one session: each tab is a session, and the extension starts (or
finds) that session's server in your folder. A browser tab, a second editor tab
and `tau -c` in a terminal can all be on one session at once, and a window
reload loses nothing.

**Status: early.** The panel is the same client τ serves to a browser: chat
with streaming, questions an extension asks, `/commands` with Tab completion
and forms, step controls, cursors and the conversation tree. The editor
integrations (jump-to-edit, diff views) are designed for and not built.

## Requirements

τ **0.17.0 or later** (protocol 2, the HTTP edge), its `tau` console script
reachable:

```bash
pipx install ffwf-tau        # or: uv tool install ffwf-tau, or pip install ffwf-tau
```

Or install the optional **tau runtime** extension (`ffwf.tau-runtime`), which
ships its own Python with τ in it, so nothing needs to be on your `PATH`.

τ needs a model. It reads `~/.tau/config.json`; run `tau` once and it writes a
template you can edit. If `tau` is not on your `PATH`, set `tau-code.binary` to
the full path. A τ that speaks another protocol is refused with a sentence
saying which τ to install.

## Use it

1. Open the folder you want the agent to work in, and **trust it**. VS Code
   disables this extension in a Restricted Mode window: the agent runs shell
   commands against what it reads.
2. **tau: Open Agent** (`Ctrl+Alt+T`, `Cmd+Alt+T` on macOS) opens a tab on the
   folder's newest τ session, or a new one if the folder has none. **tau: New
   Session** opens a new one. The τ icon in the activity bar is the same panel
   in the sidebar.
3. Type. Enter sends, Shift+Enter is a new line, `/` starts a command and Tab
   completes it.

Each tab runs `tau serve -d --json` in the folder. τ starts the session's
server, or reports the one already running, and the extension relays its HTTP
edge to the panel: the server's token stays in the extension host, and the
panel itself opens no connection. A server left idle exits after ten minutes;
the tab starts it again when it reconnects.

Commands in the palette under **tau**: `Open Agent`, `New Session`,
`Reconnect to tau serve`, `Restart This Session's tau Server`, `Show Agent Log`
(every command the extension ran), and the two that choose which τ starts a
server.

## Changing the model

The status bar shows the cursor's model. `/model <name>` changes it, with Tab
completing the names in `~/.tau/config.json`.

## Settings

| Setting | What it does |
|---|---|
| `tau-code.runtime` | Which τ starts a server when more than one is installed: `auto`, `bundled`, `system`. |
| `tau-code.binary` | Path to τ's console script. A bare name is looked up on `PATH`. |

A server that is already running is used whichever τ started it. When that τ
is a different version from the one this window would start, a notification
says so, with a button to restart the server.

## Remote development

The extension declares `extensionKind: ["workspace"]`. Over SSH, in WSL, or in
a devcontainer the server starts where the code is, on that machine's loopback,
while the panel renders locally; the extension host carries the connection
between them. That split is the one thing a standalone web client cannot
reproduce.

## What is deliberately missing

- **A session picker.** A tab opens the folder's newest session or a new one;
  `tau -r` in a terminal chooses among the rest.
- **Jump-to-edit and diff views.** τ's tools compute the data and the agent
  loop discards it before a message is built.
- **A parallel turn from the panel.** A busy session queues what you send; a
  second cursor for a parallel turn is on the wire and not yet a button.

## If the panel says it could not register a service worker

That error is VS Code's, not this extension's, and it is
[known upstream](https://github.com/microsoft/vscode/issues/125993) since 2021.
Chromium fails to register the service worker VS Code puts behind every webview,
and every webview in the window then fails to load — Markdown preview and the
Jupyter panes as well as this one. It happens most often with a second editor
already running, which is why installing in VS Code and VSCodium side by side
finds it.

Run **Developer: Reload Window**. There is no port to change and nothing to
configure: the panel is a `vscode-webview://` document talking over
`postMessage`, and the panel itself opens no connection — the extension host
does, to the server.

## About

**tau code** is built by [FFwF Robotics](https://ffwfrobotics.github.io/) —
Fight Fire with Fire Robotics — whose stated business is loyal automatons for
the inevitable machine uprising. Three projects, usable separately or as one
stack: **Tectum**, an event substrate orchestrated with schema documents;
**Tau**, the agent harness this extension is a client for; and **JMFTS**, a
retrieval appliance that fuses Matryoshka embeddings, ColBERT late interaction
and BM25 into one hybrid search on Postgres. The documentation for all three is
at [ffwfrobotics.github.io](https://ffwfrobotics.github.io/).

FFwF is [John McCardle](https://ffwf.net/about): a masters in Cyberintelligence
from the University of South Florida, author of
[McRogueFace](https://github.com/jmccardle/McRogueFace), a portable Python/C++
game engine, founder of the Bespoke Robot Society, and president of Kennedy
Space Center's amateur radio club.

## Source

<https://github.com/jmccardle/tau-code>. The container and the standalone web
client are built from the same packages and live there too.

MIT licensed.
