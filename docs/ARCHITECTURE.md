# Architecture

**Status: scaffold built 2026-08-31.** Chat works end to end in both hosts. The
tree browser and the editor integrations are designed for and not built.

Provenance: every claim about τ's protocol in this document was measured against
a live τ process in `~/Development/agent-harness-py` at protocol version 1.3.
Claims about VS Code come from its published API documentation.

---

## 1. What τ already provides

τ ships a JSON-RPC 2.0 server over LF-delimited stdio, started with
`tau --mode rpc`. Measured, not assumed:

- **Protocol 1.3**, with MAJOR/MINOR version negotiation.
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

`submit` with `expand_commands: true` refuses four commands with
`COMMAND_NOT_SUPPORTED` (-32001): `/tree`, `/fork`, `/extensions`, `/compact`.
τ identifies what they are and will not silently no-op them, because the wire
has no screen to push a panel onto. A head implements them itself. Two have a
verb that does the same job (`fork`, `compact`); `/tree` does not, and it is
exactly the tree browser.

---

## 2. Layering

```
                      ┌──────────────────────────────┐
                      │        @tau-code/ui          │  React, no host imports
                      │  Conversation store + views  │
                      └───────────────┬──────────────┘
                                      │ Transport
                      ┌───────────────┴──────────────┐
                      │     @tau-code/protocol       │  isomorphic
                      │  generated types + client    │
                      └───────────────┬──────────────┘
             ┌────────────────────────┴───────────────────────┐
             │                                                │
   WebSocketTransport                                 VsCodeTransport
   (packages/web)                                     (packages/vscode)
             │                                                │
   @tau-code/server ──┐                          extension host ──┐
   Hub: many clients  │                          direct relay     │
             │        │                                │          │
             └── @tau-code/runner ────────────────────────────────┘
                 StdioTransport over a `tau --mode rpc` child
```

One rule makes this work: **`@tau-code/ui` is handed a `Transport` and never
learns which one.** It imports neither `vscode` nor `ws`. The two hosts differ
in the transport they construct and in nothing else.

### 2.1 Why the server is Node and not Python

τ is Python, and a Python server could import `tau_agent_core` directly instead
of spawning a subprocess. It was not chosen, for one reason: the protocol types
would then be written twice — once in Python for the server, once in TypeScript
for the two clients — and the VS Code extension host would still need its own
Node-side code to own a τ child process. One language means `@tau-code/runner`
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
