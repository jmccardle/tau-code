# Changelog

One section per release, newest first. `scripts/release-notes.mjs` copies the section of the
version being released into the GitHub release, and refuses to write notes without one.

## Unreleased (0.10.0, with τ 0.18.0 and ffwf-tau-web 0.18.0)

Images in a user's message: τ 0.18's protocol 3 (τ's D31). **Needs τ 0.18.0**, which speaks
protocol 3 and refuses a client of 2; τ 0.17 is refused by this client the same way.

### Added

- **Attach images to a message.** The composer's `attach` button (png, jpeg, gif or webp, several
  at once), a paste, or a drop of files anywhere on the page puts images in a tray above the line, each a thumbnail
  with a remove control. They go with the next plain message, or alone with no text; a
  `/command` line with images is refused, saying why. The client checks what it can before
  anything is sent (an image τ reads, at most 20 MiB, at most 20, the whole request under the
  edge's 64 MiB) and the server decides the rest: a model that takes no images refuses the send
  with τ's sentence, and the tray and the line stay.
- **A message's images in the transcript.** The images this page sent are drawn in their row
  (kept by sha256, as `data:` URLs the pages' CSPs allow); every other user image is labelled
  `[image WxH mime]`, as τ's terminal UI does, and the tree counts them. Pending input lists its
  images too. (Fetching another client's images with `image()` is a later slice.)
- In VS Code, paste and drop of files into the webview work the same way, through the same relay.
- **Completion shows what τ says about each item.** `complete_line` answers items
  `{value, label?, detail?}` (τ's D32); the composer lists `label ?? value` with the `detail`
  (a command's description, a cursor's node) dimmed beside it, and inserts `value`.
- **Notices say who and how loud.** A notice shows the extension that said it, and is styled by
  its `level` (info, warning, error) in the design system's tokens, with a glyph each. A notice
  about a cursor shows on that cursor's view only.
- **`models()` and the model's limits.** τ's new call (D32 section 8) answers the catalog as `ModelInfo[]`
  (context window, `max_tokens`, `ImageLimits`, `ModelPrice`, which is the default). The client reads it
  at connect and on each `Commands`, shows the followed cursor's context window beside its model name,
  and, for a model whose `images` is null, says "no images", disables `attach` and takes no pick,
  paste or drop into the tray.
- **`Commands`**, τ's new state event (first in the snapshot): the model keeps the command forms,
  and an open `/config` form is read again when it changes.

### Fixed

- **Attaching an image over plain http** (a LAN address, say) failed: `crypto.subtle` is not
  provided to a page that is not a secure context. The SHA-256 is now `@noble/hashes`' (1.8.0,
  pinned), the same everywhere. The same page also could not start there, because the tab's id
  came from `crypto.randomUUID`, which is withheld the same way; it uses `getRandomValues`.

### Changed

- **Protocol 3**, as τ froze it (its D32, τ master 49cc6872). The generated types are τ 0.18's schema: `Body.User` is the text or
  `{text, images}`, `ItemData.Input` has `images`, `send` and `input` take `images`, and there is a
  new call, `image(sha256)`. The generator accepts `maxItems` on a plain array (a bound τ checks).
- **Always-sent fields are required** in the generated types, as τ's final schema has them:
  `Notice.cursor/extension/level`, `Completion.label/detail`, `Form.extension/yields` and
  `Parsed.extension/save`. The client's defaulting of them (`level ?? 'info'`, `save ?? false`) is
  gone: an event or answer missing one is a τ that is not this protocol, not a case to paper over.
- **The extension's stale-τ guard** knows protocol 3: a τ before 0.18.0 that names no protocol
  (the 0.9 runtime companion, τ 0.17.1) is protocol 2, and is refused before anything starts, with
  the fix.
- A POST to the HTTP edge may take a second longer for each MiB it carries, so a message with
  large images is not cut off by the 10 s deadline meant for small requests.
- **ffwf-tau-web 0.18.0** (released from `tau-web-v0.18.0`) is this client, protocol 3, for
  `tau serve` with no flags. It is released before τ 0.18.0, which refuses a protocol-2 client at
  `hello` (τ's D29 section 9); its pinned schema is the one τ 0.18.0 (τ master 06b868ac) prints.

## 0.9.1

The client in the Tau design system. Same protocol (2) and the same bundled τ (0.17.1) as 0.9.0;
the runtime now also pins the web client `tau serve` serves, **ffwf-tau-web 0.17.1**.

### Changed

- **The Tau design system.** The web client and the VS Code webview are drawn in Whiteprint
  (light) and Blueprint (dark): solid blue paper, `trace` as the one accent, square corners, no
  shadows, and every status colour paired with a glyph (● ok, ◐ running, ▲ warn, ✕ error). The
  browser follows `prefers-color-scheme`; the webview follows the editor theme's kind, and a
  high-contrast theme keeps the editor's own colours. Button labels are lowercase.
- **The tau mark.** The strip shows the mark as an activity indicator (working while a cursor
  steps, a dot while a question waits). The favicon, the activity-bar icon and the extension
  icon are the design system's marks.
- **Bundled fonts.** IBM Plex Sans, Plex Sans Condensed and Plex Mono (Latin), a JetBrains Mono
  cut for τ and the status glyphs, and Tau Symbols ship with the client and the webview, with
  their licences under `fonts/`: about 115 kB of woff2, nothing fetched at run time.
- **The runtime's icon** is the same tau mark as tau code's, so the two marketplace entries match.
- **Runtime:** `ffwf.tau-runtime` pins **ffwf-tau-web 0.17.1** beside τ 0.17.1, so the page its
  `tau serve` answers at `/` is this release's client. τ asks for ffwf-tau-web by range
  (`>=0.17,<0.18`), which would otherwise take whatever was newest when the payload was built; the
  build now fails if any pinned package installs at another version, and each payload's
  `manifest.json` records `tauWebVersion`.
- **ffwf-tau-web 0.17.1** (released from `tau-web-v0.17.1`) is this client, for `tau serve` with no
  flags. τ 0.17.x picks it up on upgrade.

## 0.9.0

**Breaking.** tau code now speaks **protocol 2** only: τ 0.17.0 or newer, over `tau serve`'s HTTP
edge. It no longer works with τ 0.14–0.16. The bundled runtime carries **τ 0.17.1**.

### Changed

- **Protocol 2, and the HTTP edge (τ ≥ 0.17).** The client is regenerated from τ 0.17's
  `tau serve --schema`. It talks to `tau serve` over HTTP (server-sent events plus POSTs, with a
  bearer token) instead of the 0.11-era WebSocket daemon. Tool results that carry images show a
  label such as `[image 1x1 image/png]`.
- **One tab is one session, served by one server.** `tau serve` serves one session per process, so
  each tau tab is a session, and the extension starts its server with `tau serve -d` in the
  workspace folder. A reloaded window reopens each tab on its session.
- **The extension host relays the edge.** The webview never sees the token and needs no
  `connect-src`; nothing needs `--allow-origin`.
- **Commands.**
  - New: **tau: New Session**.
  - **tau: Open Agent** opens the folder's newest session, or a new one in a folder without one.
  - **Restart the tau Daemon** is now **tau: Restart This Session's tau Server**. It stops this
    session's server (every client of it is disconnected) and reconnects.
  - **Choose Which tau Starts the Daemon** is now **tau: Choose Which tau Starts the Server**.
- **Runtime:** `ffwf.tau-runtime` carries τ **0.17.1** on CPython 3.14.7. 0.17.1 keeps `-I` when
  `tau serve -d` starts the detached server (τ #79), so the bundled τ never reads your user site.
- **Container image:** τ 0.17.1. The entrypoint runs
  `tau serve --host 0.0.0.0 --allow-network --port 8256`, and allows pages from
  `http://127.0.0.1:8256` and `http://localhost:8256` (set `TAU_CODE_ORIGINS` for another
  published port). The token is new on every start; run with `-t` to see the address that carries
  it. A config written from `TAU_MODEL_BASE_URL` uses τ 0.17's `provider` key.
- New: **ffwf-tau-web**, the web client as a Python wheel (`tau_web`) that `tau serve` serves with
  no flags. It follows τ's version (0.17.x), not this one, and is released from `tau-web-v*` tags.

### Removed

- **Settings `tau-code.token` and `tau-code.model`.** The server's token is random per server and
  read from its serve record; the extension handles it. `tau serve` takes no model flag: use
  `/model` in the session.
- **Runtime targets** `linux-armhf`, `alpine-x64`, `alpine-arm64`, `win32-x64` and `win32-arm64`.
  0.9.0 ships the runtime for `linux-x64`, `linux-arm64`, `darwin-x64` and `darwin-arm64` only.
  - Linux on armv7 and musl: τ 0.17 publishes no wheel for them yet; those extra wheels are on
    hold in τ.
  - Windows: `tau serve` does not run on Windows yet; that work is in progress in τ.
  - On those platforms the marketplaces may keep offering the **0.8.1** runtime (τ 0.14.1,
    protocol 1). tau code 0.9.0 refuses it before starting anything, and says what it found, what
    it needs, and how to fix it: install τ 0.17.1 yourself (`pipx install ffwf-tau==0.17.1`) and
    set `tau-code.binary` to its `tau`, or use a τ on PATH by setting `tau-code.runtime` to
    `system`. On Windows, use Remote-WSL or Remote-SSH, where the Linux runtime installs on the
    remote.

### Fixed

- A τ older than 0.17 (from any source: the runtime, `tau-code.binary`, `TAU_BIN` or PATH) is
  refused with a message that names its version and protocol, instead of failing with
  "protocol undefined".
