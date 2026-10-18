<img src="https://raw.githubusercontent.com/jmccardle/tau-code/master/packages/vscode/media/ffwf-logo.png" alt="FFwF Robotics" width="120" align="right" />

# tau code

Run a [τ](https://github.com/jmccardle/tau) agent inside VS Code or VSCodium.

τ is a Python agent harness. This extension is a client of its daemon,
`tau serve`: it finds the daemon your τ config names, or starts one, and every
panel connects to it. Sessions belong to the daemon, so a browser tab, this
panel and `tau --connect` in a terminal can all be on one conversation at once,
and a window reload loses nothing.

**Status: early.** Chat works end to end, with Tab completion for `/commands`
and `@files`, a Markdown transcript, a model picker, a session list, and the
conversation tree browser. The editor integrations — jump-to-edit, diff views —
are designed for and not built. The list at the bottom of this page says what is
missing, so you find out here rather than after installing.

## Requirements

τ 0.13.0, with its `serve` extra (serve protocol 0.10), and its `tau` console script
reachable:

```bash
pipx install 'ffwf-tau[serve]'        # or: pip install 'ffwf-tau[serve]'
```

Or install the optional **tau runtime** extension (`ffwf.tau-runtime`), which
ships its own Python with τ in it, and nothing needs to be on your `PATH`.

τ needs a model. It reads `~/.tau/config.json`; run `tau` once and it writes a
template you can edit.

If `tau` is not on your `PATH`, set `tau-code.binary` to the full path.

The extension and the daemon agree on a protocol version in their first
exchange. A daemon speaking another one refuses, and the panel says which side
to upgrade.

## Use it

1. Open the folder you want the agent to work in, and **trust it**. New
   sessions start in that folder. VS Code disables this extension entirely in
   a Restricted Mode window, so in an untrusted folder the τ icon is not there
   to click. That is the right call: the agent
   runs shell commands against what it reads. The extension page says so under
   the shield, and **Manage** in the Restricted Mode banner is where you change
   your mind.
2. Click the τ icon in the activity bar, or press `Ctrl+Alt+T` (`Cmd+Alt+T` on
   macOS).
3. Pick a session to continue — the list is every session the daemon holds,
   grouped by folder, this one first — or press **Start here** and type.
4. A new session is created when you send, not when you open the panel, so an
   opened-and-closed panel leaves nothing behind.

While a turn is running, what you send is queued and runs after it.

Commands in the palette under **tau**: `Open Agent`, `Reconnect to tau serve`,
`Show Agent Log`, and the two that choose which τ starts the daemon.

## Tab completion

`/` lists τ's commands, `@` lists files. Tab opens the list and writes the
first candidate straight into the editor; Tab again cycles, Shift+Tab goes
back. There is no separate accept key, so the editor always holds exactly what
will be sent.

The file list comes from **τ**, not from the editor. That matters over Remote
SSH or in a devcontainer: τ answers from the directory its own tools resolve
against, which is where your code actually is.

## The conversation tree

A τ conversation is a tree, not a list. Branching back to an earlier point does
not delete what came after — it leaves it in place as a sibling and starts a new
line. Compaction and elide do not delete either; they insert an anchor saying
where a span was folded out of the model's input. The transcript can only show
one line through that tree. **Tree** in the status bar shows the whole thing.

The keys are τ's own TUI's, so knowing one is knowing the other: arrows move,
Space marks a row, `Ctrl+D` folds the detail pane, Escape closes. The pane
beside the tree shows what came before the selected node, the node, and what
came after, and says how many rows it is not drawing rather than implying a
three-message conversation.

**Nothing is written while the panel is open.** Every gesture builds state in
memory; a key that commits calls one verb and closes, and Escape discards all of
it. A refusal is therefore cheap — the panel is still open, on the row you were
looking at.

Another panel or `tau --connect` on the same session can change the tree too;
the browser re-reads it when that happens.

## How answers render

The model's replies are rendered as Markdown — headings, lists, tables, links,
and fenced code in the editor's own font. Your own messages are not: what you
typed is shown as the characters you typed, so a `*` in a filename stays a `*`
and the attachment block tau built from an `@file` stays visible.

Code is not syntax-highlighted. VS Code publishes theme variables for editor
chrome but not for token colours, so any palette shipped here would be our
colours sitting inside your theme.

## Changing the model

The model name in the status bar opens a picker. It lists the models in the
daemon's `~/.tau/config.json`, each with the provider and model id it resolves
to — a config entry called `local-llm` can resolve to `qwen38-27B`, and the
rows show both. A switch applies to this panel's cursor from its next turn.

## Settings

| Setting | What it does |
|---|---|
| `tau-code.runtime` | Which τ starts the daemon when more than one is installed: `auto`, `bundled`, `system`. |
| `tau-code.binary` | Path to τ's console script. A bare name is looked up on `PATH`. |
| `tau-code.model` | The model a session this extension creates starts on. Empty uses the daemon's default. |
| `tau-code.token` | The token to send when the daemon has `serve.token` set. Empty sends none. |

A daemon that is already running is used whichever τ started it. When that τ is
a different version from the one this window would start, a banner says so.

## Remote development

The extension declares `extensionKind: ["workspace"]`. Over SSH, in WSL, or in
a devcontainer the daemon starts where the code is while the panel renders
locally; the extension host carries the connection between them. That split is
the one thing a standalone web client cannot reproduce.

## What is deliberately missing

- **Renaming a session.** The picker lists, switches, forks and starts.
- **Removing an attachment by clicking it.** The `@word` in the text is the
  only handle: delete it.
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
`postMessage`, and the panel itself opens no socket — the extension host does,
to the daemon.

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
