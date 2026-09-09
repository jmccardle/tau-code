<img src="https://raw.githubusercontent.com/jmccardle/tau-code/master/packages/vscode/media/ffwf-logo.png" alt="FFwF Robotics" width="120" align="right" />

# tau code

Run a [τ](https://github.com/jmccardle/tau) agent inside VS Code or VSCodium.

τ is a Python agent harness. This extension is a client for it: it starts
`tau --mode rpc` as a child process and talks to it over τ's documented
JSON-RPC protocol. The agent's tools run against the folder you have open.

**Status: early.** Chat works end to end, with Tab completion for `/commands`
and `@files`, a Markdown transcript, a model picker, a session list, and the
conversation tree browser. The editor integrations — jump-to-edit, diff views —
are designed for and not built. The list at the bottom of this page says what is
missing, so you find out here rather than after installing.

## Requirements

τ has to be installed and its `tau` console script reachable:

```bash
pipx install ffwf-tau        # or: pip install ffwf-tau
```

τ needs a model. It reads `~/.tau/config.json`; run `tau` once and it writes a
template you can edit.

If `tau` is not on your `PATH`, set `tau-code.binary` to the full path.

### Which τ

Every panel here is gated on what your τ answers to `get_capabilities`, not on a
version number, so an older one loses a feature rather than failing. What each
release adds:

| τ | Protocol | What it turns on |
|---|---|---|
| 0.9.x | 1.3 | Chat, sessions, the model picker |
| 0.10.0 | 1.4 | `@file` completion, `/command` flow dialogs, `/extensions` |
| 0.10.1 | 1.5 | **The conversation tree browser**, and answering extension requests |

A plain `pip install ffwf-tau` gets 0.10.1 and everything works. A panel whose
verbs are missing says which τ added them and stays out of the way, so an older
τ you already have loses a feature rather than breaking.

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

`@file` completion needs τ at protocol 1.4 or later (see [Which τ](#which-τ)),
and the composer says which one you have rather than failing.

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

This needs τ 0.10.1, which is what `pip install ffwf-tau` gets you. An older one
answers `METHOD_NOT_FOUND` for the tree read, and the panel says so instead of
drawing an empty box.

## How answers render

The model's replies are rendered as Markdown — headings, lists, tables, links,
and fenced code in the editor's own font. Your own messages are not: what you
typed is shown as the characters you typed, so a `*` in a filename stays a `*`
and the attachment block tau built from an `@file` stays visible.

Code is not syntax-highlighted. VS Code publishes theme variables for editor
chrome but not for token colours, so any palette shipped here would be our
colours sitting inside your theme.

## Changing the model

The model name in the status bar opens a picker. It lists the models in your
`~/.tau/config.json`, each with the provider and model id it resolves to, and
switching one takes effect on your next message — tau never changes model
mid-answer, so the picker waits while a turn is running.

The status bar shows the model **id**, and the picker lists config **names**.
Those are different strings: a config entry called `local-llm` can resolve to
`qwen38-27B`, and neither name can be worked out from the other. The picker
marks the row you are on when it can tell — if you started tau with a `--model`
that is not in your config, nothing matches, and it says so, because switching
away from that one is one way.

## Settings

| Setting | What it does |
|---|---|
| `tau-code.binary` | Path to τ's console script. A bare name is looked up on `PATH`. |
| `tau-code.model` | Passed to τ as `--model` when the agent starts. The picker changes it afterwards. Empty uses τ's own default. |
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
