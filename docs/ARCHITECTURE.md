# Architecture

**Status: scaffold built 2026-08-31.** Chat works end to end in both hosts. The
tree browser and the editor integrations are designed for and not built.

Provenance: every claim about τ's protocol in this document was measured against
a live τ process in `~/Development/agent-harness-py` at protocol version 1.4.
Claims about VS Code come from its published API documentation.

---

## 1. What τ already provides

τ ships a JSON-RPC 2.0 server over LF-delimited stdio, started with
`tau --mode rpc`. Measured, not assumed:

- **Protocol 1.4**, with MAJOR/MINOR version negotiation.
- **20 live verbs** in three tiers, and **7 declined verbs each with a stated
  reason** — calling one returns `METHOD_NOT_FOUND`, and the reason is the only
  place that says why.
- **10 event types** with a fixed record shape.
- A full error taxonomy, stated limits, and capability negotiation.

`docs/RPC-PROTOCOL.md` in the τ repository is generated from τ's own command
table, and a test there fails if the two disagree.

### 1.1 A chat head needs nothing new

Submit, stream, abort, switch model, list and switch sessions, fork, compact:
all shipped. This scaffold adds no verb and changes nothing in τ.

### 1.2 What is NOT on the wire

Three absences shape everything below.

**No tree structure.** None of the 20 verbs reads or writes it. `get_messages`
returns the flat active path. `fork` branches the active path into a new
session, which is not the same thing as browsing a tree.

**No message content on the event stream.** This is deliberate — τ's own rule is
that nothing unbounded is pushed. Events carry identity, timing, and a bounded
per-chunk `delta`; `agent_end` carries a `message_count` rather than the
messages. Section 4 explains what this forces on the UI.

**No tool arguments or results on the event stream.** `tool_execution_start`
carries `tool_call_id` and `tool_name` and nothing else. Arguments arrive only
with the `get_messages` pull at turn end.

### 1.3 Frontend commands

`submit` with `expand_commands: true` refuses five commands with
`COMMAND_NOT_SUPPORTED` (-32001): `/tree`, `/fork`, `/extensions`, `/compact`,
`/resume`. τ identifies what they are and will not silently no-op them, because
the wire has no screen to push a panel onto. A head implements them itself.

This head implements three, in `packages/ui/src/commands.ts`:

| command | here |
|---|---|
| `/compact` | the `compact` verb |
| `/fork` | the `fork` verb |
| `/resume` | opens the session picker |
| `/tree` | **not performed** — the tree browser is not built |
| `/extensions` | **not performed** — there is no extension panel |

The composer intercepts every frontend command before `submit`, so the two it
cannot perform produce a sentence saying which head is missing what, rather than
a -32001 the reader has to decode. Both are still listed in the completion
popup, greyed: hiding them would say they do not exist, when the truth is
narrower and more useful.

### 1.4 Completion (protocol 1.4)

The composer's Tab completion has two halves, and they come from different
places for a reason worth stating.

`/command` is computed **in this client**, from `get_commands`. The whole
vocabulary — name, description, performer — is already on the wire, and the
matching rule is a case-sensitive prefix test on the first word, which is what
τ's own `resolve_command` does with the finished line.

`@file` is computed **by τ**, through `complete_path`. This client cannot do it:
a browser has no filesystem, and the VS Code extension host does have one but
under Remote SSH or a devcontainer it is the wrong machine's. τ answers from the
working directory its own tools resolve against, which is the only answer that
cannot be wrong — and it is the same directory `expand_attachments` then reads,
so a path the popup offers is a path the expansion resolves.

`submit` sets `expand_attachments: true`, without which `@notes.txt` reaches the
model as those eleven literal characters. The acceptance carries a report of
what expansion did; `unresolved` and `failures` are both shown, because τ
reports them on purpose and a head that showed neither would make a visible
failure silent again.

Against a pre-1.4 τ, `complete_path` is absent from `get_capabilities().commands`
and the composer says so instead of calling a verb that would answer -32601.
`/command` completion is unaffected — `get_commands` has been on the wire since
1.0.

---

## 2. Layering

```
                      ┌──────────────────────────────┐
                      │        @ffwf/tau-code-ui          │  React, no host imports
                      │  Conversation store + views  │
                      └───────────────┬──────────────┘
                                      │ Transport
                      ┌───────────────┴──────────────┐
                      │     @ffwf/tau-code-protocol       │  isomorphic
                      │  generated types + client    │
                      └───────────────┬──────────────┘
             ┌────────────────────────┴───────────────────────┐
             │                                                │
   WebSocketTransport                                 VsCodeTransport
   (packages/web)                                     (packages/vscode)
             │                                                │
   @ffwf/tau-code-server ──┐                          extension host ──┐
   Hub: many clients  │                          direct relay     │
             │        │                                │          │
             └── @ffwf/tau-code-runner ────────────────────────────────┘
                 StdioTransport over a `tau --mode rpc` child
```

One rule makes this work: **`@ffwf/tau-code-ui` is handed a `Transport` and never
learns which one.** It imports neither `vscode` nor `ws`. The two hosts differ
in the transport they construct and in nothing else.

### 2.0 The relay rule: a request is answered, never dropped

Both hosts are relays. The extension host writes the webview's JSON-RPC into a
τ child; the server's `Hub` writes many browsers' JSON-RPC into one. Both had
the same defect, and it is worth stating as a rule because the shape recurs
wherever a relay exists.

`TauClient.call` has **no deadline**, deliberately: a turn may take as long as
it takes, and a timeout would cancel real work. The price is that a *dropped*
request is indistinguishable from a slow one, forever. So a relay with nothing
behind it must answer.

What this looked like before. VS Code with no folder open refuses to start τ —
correctly, there is no honest working directory. It wrote the reason to its log
and posted it to the webview with `postMessage`. But `start()` runs in the same
tick as `webview.html = …`, so the document had not loaded and nothing was
listening. The webview then sent `get_capabilities`, the host dropped it
because there was no process, and the panel said `connecting` until it was
closed. The server had the same hole for a client that connects *after* τ died:
clients attached at the time get a 1011 close, a later one gets silence.

The fix is two parts, and the first is what makes the second possible:

1. **The reason is durable, not a message.** `TauSession.#stopped` holds a
   sentence for as long as there is no agent. A one-shot message can be posted
   before anyone is listening; a held reason is available whenever the webview
   asks, which is the first thing it does.
2. **`relayRefusal` (`@ffwf/tau-code-protocol/bridge.ts`) answers.** A request gets
   an error response carrying its own id and the sentence; a notification gets
   nothing, per JSON-RPC. The code is `NO_AGENT = -32900`, below the reserved
   `-32768..-32000` band that JSON-RPC claims and τ uses part of, so a client
   can tell "τ refused this" from "this never reached τ". Those are different
   facts: nothing was attempted, so nothing was half-done.

`Disconnected` in `@ffwf/tau-code-ui` renders the sentence at full width between the
status bar and the transcript. The status bar keeps its one word, and the
composer's placeholder distinguishes waiting from gone — only one of them has a
message above worth reading.

### 2.1 Why the server is Node and not Python

τ is Python, and a Python server could import `tau_agent_core` directly instead
of spawning a subprocess. It was not chosen, for one reason: the protocol types
would then be written twice — once in Python for the server, once in TypeScript
for the two clients — and the VS Code extension host would still need its own
Node-side code to own a τ child process. One language means `@ffwf/tau-code-runner`
is literally the same module in the server and in the extension.

### 2.2 What the extension has that the web client does not

Ranked by how hard each is to reproduce outside an editor:

1. **The remote split.** VS Code's Webview API always renders on the user's
   local machine, even from a `workspace` extension. So the agent can run over
   SSH, in WSL, in a devcontainer or in a Codespace, with the panel local, and
   nobody writes a socket transport for it. A standalone web app cannot
   reproduce this; it has to become the multiplexer to get it.
2. **Editor context as a submission source** — the selection, the active file,
   the current diagnostics.
3. **Placement, identity and lifecycle** — an activity-bar view that survives
   restarts, with settings and commands in the places users look.
4. **Theme.** `--vscode-*` CSS variables mean the user's theme applies with no
   theming code. `packages/ui/src/styles.css` declares each colour as a
   `--vscode-*` variable with a standalone fallback, so one stylesheet serves
   both hosts.

---

## 3. Code generation

`npm run generate` spawns τ, sends one `get_capabilities` request, and writes
`packages/protocol/src/generated.ts` from the answer — 20 command types with
their params and results, the event record, the declined table, the limits.
About 68 KiB of JSON in, 920 lines of TypeScript out.

This uses only the documented wire. It needs no Python import, no access to τ's
source tree, and no script committed on τ's side. `npm run check:protocol`
regenerates and fails if the committed file differs from what the installed τ
reports, so drift is a build failure rather than a runtime surprise.

**The emitter refuses what it does not understand.** τ's schemas use exactly ten
JSON Schema keywords and six types. Anything outside that set throws, naming the
path and the keyword. It never emits `any` to get past a construct — a silent
`any` is how a protocol change reaches runtime instead of the build.

### 3.1 The one thing that is hand-written, and why

τ's schemas declare `commands` and `declined` as bare arrays with no `items`, so
the element shape genuinely is not on the wire. The generator emits `unknown[]`,
which is the truthful translation. `packages/protocol/src/capabilities.ts`
narrows them — and it *checks* before it narrows, throwing with the field name
when the check fails.

That refinement is a client-side claim, so it lives in code a reader can see and
a test can break, not smuggled into a generated file where it would look like
the protocol said so.

---

## 4. The conversation store is a hybrid

Because the event stream carries no content (section 1.2), there are two sources
answering different questions:

- **The event stream is the live view.** `delta` accumulates into text the reader
  watches appear. Tool calls show up by name with a status.
- **`get_messages` is the durable view.** After `agent_end`, the store pulls it
  and replaces the live buffer with the authoritative array.

A pure event reducer cannot work here, and neither can pure polling.

Two details in `packages/ui/src/conversation.ts` are load-bearing:

- **`replace: true` resets the accumulator** rather than appending. The provider
  replaced the block rather than extending it, and the delta is the block's
  entire new value. Getting this backwards produces text that doubles itself,
  which reads like a model fault rather than a client one. Tested.
- **`blocked` is not `is_error`.** A tool blocked by an extension is a policy
  decision; a tool that ran and failed is a fault. Collapsing them hides the
  first behind what looks like a bug in the second. Tested.

### 4.1 A consequence that looks like a bug

**Tool arguments and results are not available while a tool runs.** They are not
on the wire. During a call the UI shows the tool's name and that it is running,
because that is what is known. The arguments arrive with the pull at turn end.

This is worth stating in the UI eventually. It is not a defect in this client.

---

## 5. Security

The server always requires a token, at every bind address including loopback.

The alternative — no auth on 127.0.0.1 — is defensible right up until the bind
address becomes a flag, and then it is a hole that opened without anyone
changing the auth code. One rule is easier to reason about than a rule whose
exception is a command-line argument.

Measured behaviour, in `scripts/smoke-server.mjs`:

- `/healthz` needs no token and reveals nothing but liveness.
- No token and a wrong token both get 401, on HTTP and on the WebSocket upgrade.
- Token comparison is constant-time.
- An authenticated page plants a session cookie; the module script and
  stylesheet authenticate with it; an asset with no credential is still 401.
- Path traversal out of the static root is refused, checked on the resolved
  path rather than the request string.
- Cross-origin WebSocket upgrades are refused. WebSocket handshakes are not
  subject to the same-origin policy, so without this any page the user has open
  would only need to guess the port. The token already blocks that; this is a
  second line that costs nothing.

`--bind 0.0.0.0` prints a warning naming what it exposes. There is no TLS.

**What "cross-origin" is compared against changed in 0.2.0.** It used to be a
set the server built from its own bind address and port. That equals the
browser's origin only when the client reaches the server directly. The container
made the difference visible: `docker run -p 8799:8791` served the page on 8799
and then refused the socket that page opened, because the allowed set said 8791.
An `ssh -L 9000:localhost:8791` tunnel had the same fault, and so did any
reverse proxy.

The check now compares the `Origin` header to **this request's own `Host`**,
which is the actual same-origin question and does not depend on what the server
listens on. It is not weaker: a page on `evil.example` reaching 127.0.0.1:8791
still sends `Origin: https://evil.example` against `Host: 127.0.0.1:8791`, and
is refused. A reverse proxy that rewrites `Host` to its backend does break it —
that is the one deployment this does not serve, and `X-Forwarded-Host` is not
consulted, because a header the client can set is not evidence.
`packages/server/test/origin.test.mjs` holds the cases.

### 5.1 Why there is a cookie

The server prints a URL with the token in the query string, so the HTML page
authenticates. The page then requests `/assets/index-*.js` and
`/assets/index-*.css` on its own, and **a browser does not copy a query
parameter onto sub-resource requests.** Without a cookie those come back 401.

The symptom was misleading enough to be worth recording: because the 401 body is
`text/plain`, Firefox reported

> Loading module from "…/assets/index-*.js" was blocked because of a disallowed
> MIME type ("text/plain").

which reads like a content-type bug in the static handler. It was an auth
refusal wearing a MIME error's clothes.

The fix is Jupyter's: the first request that authenticates by any other means
gets `Set-Cookie` with `HttpOnly` and `SameSite=Strict`, and every sub-resource
rides on that. No `Secure` flag, because the server speaks plain HTTP and
setting it would mean the cookie is never sent at all.

A second change came out of the same bug. The static handler used to fall back
to `index.html` for **any** missing path, so a missing `.js` was answered with
HTML — producing exactly the same misleading MIME complaint for a completely
different cause. It now falls back only for paths with no file extension, and
404s the rest.

### 5.1 The server is not a multiplexer

One τ process, one conversation, many viewers. That keeps τ's own rule intact:
a conversation has exactly one writing process. Several viewers of one
conversation is a different thing from several writers, and only the second is
dangerous.

The Hub does rewrite request ids. Every connection numbers its requests from 1,
so two browsers both send `id: 1`; forwarding those verbatim would deliver one
client's result to another. The Hub assigns its own upstream id, remembers the
owner, and restores the original on the way back.

**Known gap:** there is no per-client backpressure policy. A slow socket during
a fast stream buffers in the WebSocket layer.

---

## 5.2 Sessions are shared with the TUI, if you say so

**RPC sessions are ordinary tau sessions.** Same format, same store machinery,
same `SessionCatalog`. They are simply written somewhere else by default.

Measured on this checkout:

- `tau --mode rpc` defaults to a private `<tmp>/.tau-<uid>/sessions`. The TUI and
  `--print` use `~/.tau/sessions`. Both are namespaced by working directory.
- Sessions from an RPC process report `addressable: true` — they are durable and
  `switch_session` can reach them. They are not second-class.
- The isolation is deliberate. tau's own help text: "so an RPC host does not fill
  your session list."

Point both at one directory with `--session-dir` and they are **fully
interchangeable, in both directions**:

| Direction | Verified by |
|---|---|
| RPC resumes a TUI session | `switch_session` onto a session written by `tau -p`, confirmed by a following `get_state` |
| TUI resumes an RPC session | `list_sessions` offers it, and `most_recent` — what `--continue` uses — selects it |

The web client's session picker shows this working: a row titled from a prompt
sent through `tau -p` appears in the browser and switching to it succeeds.

Two consequences worth stating plainly:

- **The temp default does not survive a reboot** on a system that clears its
  temp directory. Conversations held only there are lost.
- **The store directory is part of a session's identity.** Two identical-looking
  listings can be two different universes, which is why the picker displays the
  store directory and the working-directory scope rather than just the rows.

Set it with `tau-code.sessionDir` in the extension, or `--session-dir` on the
server. Both expand a leading `~`: tau is spawned with no shell in between, so
an unexpanded `~` would become a literal directory of that name.

## 6. Forward compatibility

Three things cost nothing now and are expensive to retrofit. All three are in
the scaffold.

- **Version negotiation.** `connect()` calls `get_capabilities` first and
  refuses on a MAJOR mismatch, rather than discovering it on the first failing
  request.
- **The client answers server-originated requests.** τ's reverse channel does
  not exist yet — `ui_methods` is `[]` — but the specification says a client
  must answer a server-originated request, at minimum with `METHOD_NOT_FOUND`.
  A client that silently ignores it when it arrives hangs the agent; one that
  errors lets τ fail fast. `TauClient` answers today, so the channel is purely
  additive later.
- **Nothing caches the cursor.** τ's rule is that no host may cache "the tip".
  The store *displays* the last cursor τ reported and never sends it back.

One place is marked rather than silently wrong: `Hub` broadcasts
server-originated requests to every client. When the reverse channel arrives,
several answers to one id is a real problem, and that line has to choose an
owner. The comment says so.

---

## 7. What has to change in τ

Both differentiators are blocked on τ, not on this repository. Both are
testable in Python with no extension in existence.

### 7.1 File-change records

The data for jump-to-edit and diff views is computed and discarded.

All eight built-in tools set `result_dict["details"]`. Nothing reads it:

1. `_execute_single_tool` (`agent_loop.py:1611`) reads `content`, `is_error`,
   `terminate` off the returned dict. `details` is dropped here.
2. `AgentToolResult` — the type the loop carries — has no `details` field.
3. The `tool_result` hook event hardcodes `"details": None`, so an extension
   cannot recover it either.

`EditTool` runs `_generate_diff` on every call and the result is unreachable the
moment it returns. No head has ever rendered a diff, because no head has ever
been given one.

**The fix is smaller than it looks.** `ToolResultMessage.details` already exists
on τ's model and already defaults to `None`. The message schema has the slot;
the loop's intermediate carrier does not. So the chain is two links — add
`details` to `AgentToolResult`, pass it through — and persistence follows,
rather than being a session-log schema change.

Two things still need real work before a diff view is possible:

- **`_generate_diff` is not a unified diff**, despite its docstring. No hunk
  headers, no line numbers, no elision; it emits every unchanged line of the
  file prefixed with two spaces. There is nothing to jump to.
- **It desynchronizes on any line-count change.** On a mismatch it emits one
  `-`, one `+`, and advances *both* indices. No LCS step. Since `edit` replaces
  `old_string` with `new_string`, an insertion renders the entire remainder of
  the file as `-`/`+` pairs.
- **`write` records no before-content** (`{path, lines, bytes}`), so a write
  over an existing file is unreconstructable. Plumbing cannot fix that one.

Design position, not yet built: persist structured change facts — path, ranges,
and enough content to reconstruct before and after — never a rendered diff
string. The head renders. And host capabilities should be intents (`reveal(path,
range)`, `show_diff(change_id)`), never `vscode.diff` calls: VS Code delegates
to its diff editor, a browser head renders inline, and the TUI renders what it
can.

### 7.2 Tree verbs

`get_tree`, plus branch and paste. The algebra is already pure in τ's
`tree_surgery.py`. `commit_branch` and `paste_subtree` live on `TauBackend` —
inside the Textual TUI — and need to move into the core where every head can
reach them.

VS Code's native `TreeView` API is an unexpectedly good fit for the gestures τ's
tree editor already has: `canSelectMany`, `TreeItemCheckboxState` with
`manageCheckboxStateManually`, and `TreeDragAndDropController` map onto marks,
selection and paste without a webview.

---

## 8. Order of work

MVP-0 and the two τ changes share no files and can run in parallel.

**MVP-0 — chat, both hosts, no τ changes.** Done in this scaffold.

**MVP-1 — the differentiators.** In τ first (7.1 and 7.2), then the UI: a
`TreeView` in VS Code, a drawn tree in the browser, and `reveal` / `show_diff`
as host capabilities with visible capability negotiation.

The extension comes last, and by then it is mostly rendering.

---

## 9. Artifacts and names (0.2.0)

### 9.1 Three artifacts, and npm is not one of them

`ffwf-tau-code-<version>.vsix`, `ffwf/tau-code:<version>`, and this checkout.
`scripts/package.sh` builds the first two and publishes nothing.

Nothing here goes to npm. That is a decision, not a gap. Publishing the five
workspace packages would mean five versions to keep in step, a scope to
maintain, and — for `@ffwf/tau-code-server`, the only one anyone would install —
an `npx` path that still leaves the user to install τ separately. The container
answers that same want in one command and makes the working directory explicit,
which for an agent is the thing that most needs to be explicit. If the npm path
is ever wanted, the blocker that used to exist is already gone: see 9.3.

### 9.2 Three namespaces, deliberately not unified

| Namespace | Value | Where it binds |
|---|---|---|
| npm workspace names | `@ffwf/tau-code-*` | `import` statements, `package.json` |
| VS Code extension ID | `ffwf.tau-code` | the Marketplace, `--install-extension` |
| Extension settings and commands | `tau-code.*` | a user's `settings.json` |
| Marketplace display name | `tau code` | the listing title, the editor's extension list |

They look like they should be one string and they are not. An extension name
may not contain `@` or `/`, so the scope cannot appear in the ID. And the
settings namespace is the one thing here a user has typed into a file of their
own, so renaming it would silently drop their configuration — it is left alone
on purpose.

The display name is the odd one, and it cost a failed publish. It is the only
name here that is **not scoped by its publisher**: `ffwf.tau-code` is ours the
moment we own `ffwf`, but a display name is unique across the entire Visual
Studio Marketplace, so `tau` was refused as taken and owning the publisher did
nothing about it. Nothing can check this before uploading — the marketplace
search API ranks results rather than indexing display names, and a check that
answers "probably free" is worse than no check. Open VSX does not enforce the
rule at all, so that leg would have succeeded on its own and left the two
listings under different titles.

The scope `@ffwf` rather than a flat `ffwf-tau-code-*` prefix is the one
reservation decision. The npm organisation is claimed and covers `@ffwf/*`
forever, so no future package under it needs its own reservation. The publisher
name `ffwf` on the Visual Studio Marketplace and the namespace `ffwf` on Open
VSX are two further registries where the same word had to be claimed separately.
`scripts/reserve-names.sh` handles the separate, smaller job: the unscoped names
someone could otherwise publish. Its placeholders contain a README and no code,
and it publishes only with `--publish`.

### 9.3 The web build now ships inside the server package

`DEFAULT_STATIC` used to resolve to `../../web/dist-web` — a sibling workspace.
That path exists in a checkout and nowhere else, so the server could not have
been packaged or containerised as it stood. `packages/server/copy-web.mjs` now
copies the built client into `packages/server/dist-web` at build time, and the
root `workspaces` array lists `packages/web` before `packages/server` so npm
builds them in that order.

The CLI also refuses to start when the resolved static directory has no
`index.html`. Without that, a missing web build produced a server that answered
every page with a 404 and reported the reason in a browser tab rather than in
the terminal that started it.

### 9.4 Two marketplaces, one archive

`scripts/publish-extension.sh` publishes to the Visual Studio Marketplace and to
Open VSX. VSCodium, and every other build that cannot use Microsoft's
marketplace, reads Open VSX; publishing to only one of them means half the
editors this extension claims to support cannot install it.

Both get the **same file**. `vsce publish --packagePath` and `ovsx publish
<file>` each read the manifest out of the `.vsix` rather than off disk, so the
two listings cannot drift, and `packages/vscode/package.json` can stay marked
`private` — which is what stops an accidental `npm publish` of an extension into
a scope that holds libraries.

Three things had to exist before a listing was worth publishing, and none of
them was needed to build a `.vsix`:

- **A README inside the extension package.** The listing page is that file. The
  `.vsix` had none, so the page would have been blank.
- **A `repository` field.** `--allow-missing-repository` had been papering over
  its absence. It is gone from the package script, and the publish script
  fetches the URL before uploading: a listing that links to a 404 can only be
  fixed by publishing again, and a version number cannot be reused on either
  marketplace.
- **`.vscodeignore` actually excluding the source map.** It listed `**/*.map`
  and shipped the map anyway. vsce applies every negation after every ignore
  regardless of the order in the file, so the `!dist/**` line at the bottom
  re-included it. Nothing excluded `dist`, so that line was never needed;
  removing it took the archive from 82 KB to 69 KB.

### 9.5 What is claimed, and what it took (2026-09-02)

| Registry | Held | How |
|---|---|---|
| npm organisation | `@ffwf` | claimed by hand; covers `@ffwf/*` forever |
| npm packages | `ffwf-tau`, `-llm`, `-agent-core`, `-coding-agent`, `-jmfts`, `-code`, and `tau-code` | `scripts/reserve-names.sh --publish` |
| PyPI | `tau-code`, `ffwf-tau-code` | the same script |
| Visual Studio Marketplace | publisher `ffwf`, extension `ffwf.tau-code` | `scripts/publish-extension.sh` |
| Open VSX | namespace `ffwf`, extension `ffwf.tau-code` | the same script |

The seven npm placeholders are each published and then deprecated, so npm prints
the notice on any install. That is the whole point: someone who arrives by a
typo is told at once rather than left holding an empty package.

Two credential rules cost a failed run each, and neither is discoverable from
the error alone:

- **npm rejects a CLI publish under 2FA.** A password login is not enough. The
  publish needs a **granular access token with "bypass 2FA" enabled**, written
  to `~/.npmrc` as `//registry.npmjs.org/:_authToken=`. `npm login` puts a
  different token on that same line, which is why the failure reads as a
  permission problem rather than a missing credential.
- **PyPI cannot scope a token to a project that does not exist.** The first
  upload of a new name has to come from an **account-scoped** token, which can
  write to every project on the account. Narrow it or revoke it afterwards. τ's
  own releases are unaffected: they use Trusted Publishing from CI and read no
  token from a laptop.
