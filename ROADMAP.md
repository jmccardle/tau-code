# tau-code roadmap

State as of 2026-10-20. `master` == `v0.8.0`.

## Shipped

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
- The first run was 39151067252 for v0.7.0. Both marketplaces list `ffwf.tau-code` and all nine `ffwf.tau-runtime` targets at 0.7.0.
- v0.6.0 was deliberately not backfilled to the marketplaces.

## In progress
- Nothing.

## Next (no decision needed)
- **Parallel-cursor button and compare UI:** deferred from the 0.7.0 scope.

## Open decisions
- **Pre-attach model picker from `hello.models` (new in protocol 0.10):** do we want one? Today the model is chosen after attach.

## Next (waits on John's go)
- **Extension list panel (τ #35):** τ 0.14.0 ships `list_extensions`, which tells installed from enabled from authorized, with orphaned subscriptions. tau-code has the types; the panel is not built.
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
