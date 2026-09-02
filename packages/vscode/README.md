<img src="https://raw.githubusercontent.com/jmccardle/tau-code/master/packages/vscode/media/ffwf-logo.png" alt="FFwF Robotics" width="120" align="right" />

# tau code

Run a [τ](https://github.com/jmccardle/tau) agent inside VS Code or VSCodium.

τ is a Python agent harness. This extension is a client for it: it starts
`tau --mode rpc` as a child process and talks to it over τ's documented
JSON-RPC protocol. The agent's tools run against the folder you have open.

**Status: scaffold.** Chat works end to end, with Tab completion for
`/commands` and `@files`. The conversation tree browser and the editor
integrations are designed for but not built. The list at the bottom of this
page says what is missing, so you find out here rather than after installing.

## Requirements

τ has to be installed and its `tau` console script reachable:

```bash
pipx install ffwf-tau        # or: pip install ffwf-tau
```

τ needs a model. It reads `~/.tau/config.json`; run `tau` once and it writes a
template you can edit.

If `tau` is not on your `PATH`, set `tau-code.binary` to the full path.

## Use it

1. Open the folder you want the agent to work in. The extension refuses to
   start without one, because there is no honest working directory for the
   agent's tools otherwise.
2. Click the τ icon in the activity bar, or press `Ctrl+Alt+T` (`Cmd+Alt+T` on
   macOS).
3. Pick a session to continue, or press **Start here** to use the new one.
4. Type. `Ctrl+Alt+T` again opens the same session as a full editor tab.

The panel opens on the session list whenever the session it started is empty.
tau writes a session to its store when the agent starts rather than when you
first send something, so opening the panel four times leaves four empty
sessions; landing on the list means the obvious next click is a conversation you
were already having.

Three commands are in the palette under **tau**: `Open Agent`,
`Restart Agent`, `Show Agent Log`.

## Tab completion

`/` lists τ's commands, `@` lists files. Tab opens the list and writes the
first candidate straight into the editor; Tab again cycles, Shift+Tab goes
back. There is no separate accept key, so the editor always holds exactly what
will be sent.

The file list comes from **τ**, not from the editor. That matters over Remote
SSH or in a devcontainer: τ answers from the directory its own tools resolve
against, which is where your code actually is.

`@file` completion needs τ at protocol 1.4 or later. Everything else works
against 1.3, and the composer says which one you have rather than failing.

## How answers render

The model's replies are rendered as Markdown — headings, lists, tables, links,
and fenced code in the editor's own font. Your own messages are not: what you
typed is shown as the characters you typed, so a `*` in a filename stays a `*`
and the attachment block tau built from an `@file` stays visible.

Code is not syntax-highlighted. VS Code publishes theme variables for editor
chrome but not for token colours, so any palette shipped here would be our
colours sitting inside your theme.

## Settings

| Setting | What it does |
|---|---|
| `tau-code.binary` | Path to τ's console script. A bare name is looked up on `PATH`. |
| `tau-code.model` | Passed to τ as `--model`. Empty uses τ's own default. |
| `tau-code.provider` | Passed to τ as `--provider`. Empty uses τ's own default. |
| `tau-code.sessionDir` | Where session logs are written. |

`tau-code.sessionDir` is worth reading about. Empty uses τ's default for RPC
hosts: a private `<tmp>/.tau-<uid>/sessions`, so this extension does not fill
the session list you see in τ's own TUI — and **those sessions do not survive a
reboot on a system that clears its temp directory.** Set it to
`~/.tau/sessions` to share one store. Resume then works both ways: the picker
here lists sessions the TUI wrote, and `tau --continue` resumes ones written
here.

## Remote development

The extension declares `extensionKind: ["workspace"]`. Over SSH, in WSL, or in
a devcontainer the agent runs where the code is while the panel renders
locally. That split is the one thing a standalone web client cannot reproduce.

## What is deliberately missing

- **The conversation tree browser.** τ's differentiator, and the reason this
  project exists. It needs tree verbs on the wire; τ has none today.
- **`/tree` and `/extensions`.** τ resolves both and expects the client to
  perform them. This one does not, so it says so. They appear greyed in the
  completion popup.
- **Renaming a session.** The picker lists, switches, forks and starts.
- **Removing an attachment by clicking it.** The `@word` in the text is the
  only handle: delete it.
- **Jump-to-edit and diff views.** τ's tools compute the data and the agent
  loop discards it before a message is built.
- **Live tool arguments.** During a call you see the tool's name and that it is
  running. The arguments arrive at turn end.

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
`postMessage`, and this extension opens no socket of any kind.

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
