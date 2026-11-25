# Changelog

One section per release, newest first. `scripts/release-notes.mjs` copies the section of the
version being released into the GitHub release, and refuses to write notes without one.

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
