# tau-code roadmap

State as of 2026-11-24. `master` is `v0.8.1` plus the port to τ 0.17 (protocol 2), merged from
`feat/http-edge-client`, and Phase R (the extension). It is on forgejo, goblin and GitHub; tau-code
itself is untagged until 0.9.0 (`tau-web-v0.17.0` tags the web wheel only).

## In progress: the port to τ 0.17 (protocol 2, the HTTP edge)
The plan is akb #484 (rev 3) under #474; the item ids (TC-nn, Q-x) are its.

- **Phase 1, built:** TC-01 the generator from `tau serve --schema` (a pinned schema,
  `check:protocol`); TC-02 one HTTP transport (SSE over `fetch` plus serialized POSTs, browser and
  Node), `ws+unix` dropped; TC-03 `SessionModel` (and `SessionLink`); TC-04 `npm run smoke` against
  a real `tau serve --no-unix` with the mock model.
- **Phase 2, built:** the web client served by `tau serve --web-root packages/web/dist`; the token
  from `#token=`, kept in `sessionStorage` and removed from the address (Q-I, decided by John
  2026-11-24); views rebound to `Node` (TC-07); questions, the cursor switcher, auto-step and step
  controls (TC-08); the 0.11 replica, panels, planners and smokes deleted, and
  `npm run smoke:browser` in headless Chrome (TC-09); `npm run dev` with a dev-only proxy that
  adds the serve record's token.
- **Needs τ ≥ 0.17.0** (protocol 2). The port was built against protocol 1 (τ master `ea0a3dcd`,
  planned as 0.16.1, never released) and regenerated for protocol 2 when 0.17.0 shipped. A 0.16
  server refuses this client at `hello`, and a 0.17 server refuses a protocol-1 one.
- **Images in tool results (protocol 2):** a result's images are labelled `[image WxH mime]`, as τ's
  terminal UI does. Drawing them needs a wire call that fetches an image's bytes; τ 0.17 has none
  (its release notes list it under "Not yet").
- **What the old (0.8.1) UI had that the port does not**, one per line:
  - the completion popup with each command's description, and `@file` completion: the composer
    completes through `complete_line` only, and never calls `commands` (which has the descriptions);
  - the model picker (in 0.16 the model is `CursorView.model`, shown in the status bar; changing it
    is the `/model` command, with no picker);
  - the extension-warnings panel (τ 0.16 has no such list on the wire; `Notice` and
    `CursorView.shown` are what an extension says);
  - the extension panels and flows of protocol 0.11 (gone from τ; commands and their forms replace
    them);
  - the session picker (one `tau serve` is one session: Q-G (a));
  - the tree's elide, commit-branch and paste-subtree (no wire counterpart in protocol 2).
- **`ffwf-tau-web`** (packages/web-py, the package `tau_web`), which `tau serve` finds without
  `--web-root`: built by `npm run package:web-wheel`, versioned with τ (0.17.x), and published to
  PyPI by `tau-web-v*` tags (release.yml's `web-wheel-publish`, trusted publishing, GitHub
  environment `pypi`). The first is `tau-web-v0.17.0`.

## Phase R: the extension on protocol 2 (built 2026-11-24)
- **The VS Code / VSCodium extension** (`packages/vscode`): ported, back in the workspaces and the
  TypeScript build. The webview mounts the web client's `TauApp`; the extension host runs
  `tau serve -d --json` per tab (one tab, one session: `-c` for "Open Agent", none for "New
  Session", `--session <id>` after a reload) and relays the HTTP edge with `HttpTransport`, so the
  token stays in the host (HE-14's relay, not `--allow-origin`). `tau-code.token` and
  `tau-code.model` are gone. ARCHITECTURE §16.
- **Tested in a real VSCodium:** `npm run smoke:vscode` installs the `.vsix` into throwaway dirs,
  runs VSCodium under Xvfb and drives it with Playwright: chat round trip, `/model` and an image
  result labelled `[image 1x1 image/png]`, a window reload keeping the session, a server restart.
  Green with the system τ 0.17.0 and with a local (unverified) runtime companion.
- **The runtime** (`packages/runtime`): `tauSpec` = `ffwf-tau==0.17.0`; the build verifies over
  the HTTP edge; `npm run smoke:runtime` is ported. **Its build stops at its own canary:** τ
  0.17.0's `tau serve -d` re-launches the server as `python -m tau serve …` without `-I`
  (`_serve_cli.py` `_spawn`, `sys.executable` with no interpreter flags), so the detached server
  reads the user site: τ #79 is back. Fix in τ, then rebuild; no workaround here.
- **Targets (Q3/Q4, open):** τ 0.17.0 publishes wheels for linux-x64, linux-arm64, darwin-x64,
  darwin-arm64 and win32-x64 only, so `--all` fails on linux-armhf, alpine-x64, alpine-arm64 and
  win32-arm64; and τ's serve path is not ported to Windows (D29 Open 1). Drop those targets, or
  add wheels in τ: John decides.
- **Not done:** `ffwf-tau-tokens` in the payload (Q6); the container (`Dockerfile`, `docker/`:
  the entrypoint becomes `tau serve --port 3393 --host 0.0.0.0 --allow-network --allow-origin …
  --web-root …`); the 0.9.0 release, then GitHub.

## Shipped

### v0.8.1 (2026-10-21), targeting τ 0.14.1
- The bundled runtime is CPython 3.14.7 (was 3.11.16, never a deliberate choice). cp314 wheels resolve for all nine targets.
- τ 0.14.1 fixes #79: `tau serve -d` re-launched the daemon without `-I`, so the runtime read the user's `~/.local` site-packages and model calls failed (`ImportError: sentinel`, or Anthropic's bare "Connection error.").
- The runtime build's verify now starts `serve -d` with a `usercustomize.py` canary in the throwaway HOME's user site, and fails if any interpreter in the chain reads it. It fails against τ 0.14.0.

### v0.8.0 (2026-10-20), targeting τ 0.14.0 (serve protocol 0.11, RPC 3.0)
- generated.ts regenerated for protocol 0.11. `npm run check:protocol` passes against PyPI `ffwf-tau[serve]==0.14.0`.
- Extension command names take a colon: `ext:<extension>:<command>`. `list_extensions` is typed but not yet shown.
- Extension warnings (τ #60): a status-bar marker ("1 extension error, 2 warnings") opens `/extensions`, which lists them under Flagged. τ's mirrored load failures stay under "Did not load".
- Model records: an entry τ cannot build is listed with its reason and is never offered. An entry with no API key is labelled "(no API key)" and stays selectable.
- A session whose model is gone from the config still opens. The reason shows under the status bar and in the picker, and a prompt is refused with τ's sentence.
- The runtime tauSpec and Dockerfile `TAU_SPEC` are pinned to `==0.14.0`.
- 141 tests, smoke, smoke:tree and the Chrome panels smokes are green against live τ.

### v0.7.0 (2026-10-18), targeting τ 0.13.0 (serve protocol 0.10)
- generated.ts regenerated for protocol 0.10. `npm run check:protocol` passes against PyPI `ffwf-tau[serve]==0.13.0`.
- Template and skill commands (`CommandInfo.origin` = `template` | `skill`) are offered in completion and sent as prompts. The daemon expands them through `submit` with `expand_commands`.
- `provider_retry` shows a notice: "error — retrying in Xs (attempt N of M)". It clears when the next message starts or the turn ends.
- `follow_ups_dropped` shows "Stopped: dropped N queued message(s), never sent:". This is τ option (a): a user abort drops waiting `enqueue` submissions.
- An empty thinking block that carries a signature renders as a reasoning block.
- The output-limit truncation notice now says the tool calls "went unrun".
- The runtime tauSpec and Dockerfile `TAU_SPEC` are pinned to `==0.13.0`.
- 130 tests, smoke, payload smoke and Docker verify are all green.

### Automated marketplace publishing
- Pushing a `v*` tag runs `release.yml`: checks, nine runtime payloads, the image, a GitHub release, then `publish.yml`.
- `publish.yml` downloads the release's own `.vsix` files and runs `scripts/publish-extension.sh` with `--skip-duplicate`. There is one job per marketplace (VS Marketplace, Open VSX), and they don't fail together.
- The tokens `VSCE_PAT` and `OVSX_PAT` live in the GitHub environment `marketplaces`, which admits `v*` tags only.
- `v*` tags never publish `ffwf-tau-web`; `tau-web-v*` tags publish only that, from the environment `pypi` (which admits `tau-web-v*` tags only).
- The first run was 39151067252 for v0.7.0. Both marketplaces list `ffwf.tau-code` and all nine `ffwf.tau-runtime` targets at 0.7.0.
- v0.6.0 was deliberately not backfilled to the marketplaces.

## Next (no decision needed)
- **Compare (several watched cursors side by side):** deferred from the 0.7.0 scope; protocol 1's
  `watch` takes several cursors.

## Superseded by the port (protocol 0.11 items)
- *Pre-attach model picker from `hello.models`*: protocol 1's `hello` carries no models; a cursor's
  model is `CursorView.model`, set with the `/model` command.
- *Extension list panel (τ #35)*: `list_extensions` is not in protocol 1. Kept for the record:
 τ 0.14.0 ships `list_extensions`, which tells installed from enabled from authorized, with orphaned subscriptions. tau-code has the types; the panel is not built.
  - τ's design:
    - An extension's identity is its full dotted module name everywhere.
    - Drop-ins (.py files and package directories) and pip packages pass through one authorization gate.
    - A subscription to a topic that no extension emits shows up in `tau ext list` or as a debug notice.
  - So tau-code's installed / enabled / authorized display should also show those orphaned subscriptions.

## Maintenance
- **Azure DevOps `VSCE_PAT`** (org `ffwf`, Marketplace Manage):
  - It was created 2026-10-18 and Azure caps a PAT at one year, so it expires no later than 2027-10-18. Check the exact expiry at dev.azure.com → User settings → Personal access tokens.
  - When it lapses, `publish (vscode)` fails at `vsce verify-pat`. Renew the token, update the secret, then re-run that job.
- **`OVSX_PAT` is optional to keep:** Open VSX can authenticate GitHub Actions directly, which would let us delete the stored token. This is low priority; the PAT works today.
