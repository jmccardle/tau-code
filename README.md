# ffwf-tau-code

Clients for [τ](https://github.com/jmccardle/tau), the agent harness: a web client, and a VS Code /
VSCodium extension, both speaking τ's wire to `tau serve`.

**Status: being ported to τ 0.16's wire (protocol 1), over `tau serve`'s HTTP edge.** The protocol
package, the session model and the web client are ported and tested against a real `tau serve`.
The VS Code extension and its runtime bundle are not yet (Phase R, [ROADMAP.md](ROADMAP.md)): they
are written against τ 0.14's serve protocol 0.11 and are left out of the default build.

**Requires τ with the HTTP edge**: τ `master` at or after `ea0a3dcd` (to be released as 0.16.1).
τ 0.16.0 serves only a Unix socket, which a browser cannot reach.

## What is here

| Package | What it is | Runs where | Built by default |
|---|---|---|---|
| `@ffwf/tau-code-protocol` | Generated wire types, the HTTP edge transport, a JSON-RPC client, `SessionModel` and `SessionLink` | browser and Node ≥ 20 | yes |
| `@ffwf/tau-code-ui` | React views of a session, handed a `SessionLink` | anywhere React runs | yes |
| `@ffwf/tau-code-web` | The browser client: a static `dist/` that `tau serve --web-root` serves | browser | yes |
| `tau-runtime` (publisher `ffwf`) | An optional CPython with τ in it, for the extension | VS Code | yes (its shell; its payload is Phase R) |
| `tau-code` (publisher `ffwf`) | The editor extension | VS Code | **no**: Phase R |

None of these is published to npm. They are workspace packages, and the names exist so the
imports read the same as they would if they were.

The dependency direction is one way: `ui` imports no host. It is handed a `SessionLink`, which is
handed a way to open a `Transport`, so the same views can run in a browser tab and, later, in an
editor's webview.

## The wire

τ 0.16 serves one session per `tau serve` process. Its HTTP edge (τ's D29) is:

- `GET /stream` with `Authorization: Bearer <token>`: a server-sent-events stream whose first
  event is the connection id, then one JSON-RPC message per event;
- `POST /stream/<connection id>`: one request, answered `202`; its response comes on the stream.

`HttpTransport` speaks it with `fetch` and a `ReadableStream` (it can send `Authorization`,
which `EventSource` cannot), POSTing one request at a time so calls arrive in order. The same
code runs in a browser and in Node. `ServeClient` says `hello` with the protocol number and
matches answers by id; `SessionModel` folds the snapshot and the events into the cursors, the
labels, a node cache and each watched cursor's live layer; `SessionLink` reconnects (there is no
resume: a new connection gets a new snapshot), stops on a refusal that a retry cannot change (a
wrong token, a refused origin, a protocol mismatch), follows one cursor and reads the tree.

The token is in the serve record (`$TAU_HOME/serve/<session>.json`, mode 600), which
`tau serve -d --json` prints, and in the `open:` line `tau serve` prints on a terminal.

## Requirements

- Node 20 or later.
- τ at or after `ea0a3dcd`, its `tau` console script reachable. Set `TAU_BIN` if it is not the
  `tau` on `PATH`:

  ```bash
  export TAU_BIN=/path/to/tau/.venv/bin/tau
  ```

- For `npm run smoke:browser`: Chrome or Chromium (`CHROME`, default `/usr/bin/google-chrome`).

## Setup

```bash
npm install
npm run build
```

The build needs no τ: the protocol package is generated from a pinned copy of τ's schema,
`packages/protocol/schema/protocol.schema.json`. `npm run generate` refreshes the pin from
`$TAU_BIN serve --schema` and regenerates `packages/protocol/src/generated.ts`;
`npm run check:protocol` fails when the generated file is stale against the pin, or the pin
differs from the τ you run. The generator understands exactly the schema keywords τ uses
(`x-protocol`, `x-result`, `x-names`, `x-raises`, `kind`-tagged events, serde-tagged values,
tuples) and throws on any other, naming it.

## Run the web client

τ serves it; no Node runs at run time.

```bash
npm run build
tau serve --web-root packages/web/dist
```

`tau serve` prints the address to open, with the token in its fragment:

```text
serving 20261124-… on /home/you/.tau/serve/20261124-….sock and http://127.0.0.1:3393/ (pid 4242)
open: http://127.0.0.1:3393/#token=…
```

The page reads `#token=`, keeps it in this tab's `sessionStorage` (a reload still works; other
tabs do not get it) and removes it from the address bar, so it does not sit in history,
bookmarks or a screen share. It calls `/stream` on its own origin, which τ allows. Opened
without a token, it says where to get one.

What it does:

- **Cursors**: a tab each, with its labels, whether it is working, how its last step ended, and
  its open questions; open another cursor at the followed one's node, close one, reopen a closed
  one where it ended.
- **The conversation** of the followed cursor (its walk), and what its step is streaming over it:
  thinking, text, tool calls forming, tool progress, a provider's retry wait.
- **Questions** an extension asks, as forms from their JSON Schema: answer or decline. Two
  clients can race; the loser is told it was already answered.
- **The composer**: text is `send` (input, auto-step on); a `/command` is read by τ
  (`parse_line`) and run, or shown as a form for its missing arguments; `/config <extension>` is a
  form of its options, with "save to my config file". Tab completes the word being typed
  (`complete_line`).
- **Step controls**: auto-step on and off, Step, Abort; pending input, and taking back your own.
- **The tree**: every node, branches indented, cursors marked; go to a node (a branch), open a
  cursor at one, set and remove labels.
- **Notices** (`cursor.tell`, a refused input) and what extensions show on the cursor.

### Develop it

```bash
tau serve --allow-origin http://localhost:5173   # in the project you want, in one terminal (see below)
npm run dev                                      # in another: open http://localhost:5173/
```

`npm run dev` serves the page with live reload and proxies `/stream` to the `tau serve` it finds
in `$TAU_HOME/serve/` (or `~/.tau/serve/`), adding that server's token
(`packages/web/dev/serve-record.mjs`). With several servers running, set `TAU_SERVE` to a session
id, a prefix or a name. With none, `/stream` answers 502 saying so, and the page shows it.

The proxy holds a token that can run commands, so it serves only this machine, and says why
when it refuses (403, with a sentence the page shows):

- **It runs on loopback only.** `npm run dev -- --host` (or any `server.host` that is not
  loopback) stops at startup with a message. From another machine, forward the port instead.
- **A peer that is not loopback is refused**, whatever `Host` it sends.
- **`Host` must be `localhost`, `127.0.0.1` or `[::1]` on the dev server's own port.** A
  DNS-rebinding page is refused. So is a port forward that changes the port
  (`ssh -L 8080:localhost:5173` sends `Host: localhost:8080`): keep the number,
  `ssh -L 5173:localhost:5173`, and open `http://localhost:5173/`.
- **`Origin`, when the browser sends one, must be that same address**, and it is passed on, so τ
  checks it as well. τ allows only the origins `--allow-origin` names (it is repeatable), so
  allow each address you open the page by:

  ```bash
  tau serve --allow-origin http://localhost:5173 --allow-origin http://127.0.0.1:5173
  ```

  Opening `http://127.0.0.1:5173/` when only `localhost` was allowed gets τ's 403, which the
  proxy explains by naming the `--allow-origin` to add.

## Verify

```bash
npm run check:protocol   # the pinned schema = $TAU_BIN serve --schema; generated.ts is current
npm run build
npm run typecheck
npm test                 # unit tests: transport, client, model, link, views, token
npm run smoke            # the protocol package against a real tau serve --no-unix
npm run smoke:browser    # the web client in headless Chrome, served by tau serve --web-root
npm run check            # all of the above, in that order
```

The smokes start their own `tau serve` in a throwaway `TAU_HOME` with τ's mock model (no
network, no key) and stop it after (`scripts/lib/serve.mjs`); nothing touches `~/.tau`.

## Not yet (Phase R)

- **The VS Code extension** (`packages/vscode`) and the **runtime bundle** (`packages/runtime`'s
  payload, `scripts/smoke-runtime.mjs`): written for τ 0.14. The extension is out of the
  workspaces and the TypeScript build until it is ported; its webview will load this same
  `dist/` (ROADMAP.md).
- **The container** (`Dockerfile`, `docker/`): its entrypoint runs τ 0.14's `tau serve --listen`,
  which τ 0.16 does not have.
- **A Python package of the web client** (`tau_web`, which `tau serve` would find without
  `--web-root`): not built; its name is an open question.

## Publishing

**As of 0.8.1, and on hold:** a release builds the extension and the runtime, which wait on
Phase R, so there is no release of the port until then. What follows describes the 0.8.x process.

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
