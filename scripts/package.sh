#!/usr/bin/env bash
# Build the release artifacts.
#
#   scripts/package.sh          both
#   scripts/package.sh vsix     the editor extension only
#   scripts/package.sh image    the container image only
#
# There are exactly two artifacts, plus the checkout itself:
#
#   ffwf-tau-code-<version>.vsix   install into VS Code or VSCodium
#   ffwf/tau-code:<version>        docker run, serves the web client
#
# The checks run first and the script stops on the first failure. A build that
# produces an artifact from a tree that does not typecheck is worse than no
# build: it ships, and the fault surfaces on someone else's machine.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
VERSION="$(node -p "require('./package.json').version")"
IMAGE="${TAU_CODE_IMAGE:-ffwf/tau-code}"

WHAT="${1:-all}"
case "$WHAT" in
  all|vsix|image) ;;
  *) echo "usage: $0 [all|vsix|image]" >&2; exit 2 ;;
esac

say() { printf '\n=== %s\n' "$1"; }

# ------------------------------------------------------------------- version
# Every workspace carries the root version. A mismatch means one artifact would
# claim a version the others do not have, which is unfixable after release.
say "version $VERSION"
mismatch=0
for pkg in packages/*/package.json; do
  have="$(node -p "require('$ROOT/$pkg').version")"
  if [ "$have" != "$VERSION" ]; then
    echo "  $pkg is $have, root is $VERSION" >&2
    mismatch=1
  fi
done
if [ "$mismatch" -ne 0 ]; then
  echo "Every package must carry the root version. Fix them and run again." >&2
  exit 1
fi
echo "  all six packages agree."

# -------------------------------------------------------------------- checks
say "checks"
npm run typecheck
npm test
# check:protocol needs a live tau, so it runs only when one is reachable. It is
# the guard against packages/protocol/src/generated.ts drifting from the wire.
if [ -n "${TAU_BIN:-}" ] || command -v tau >/dev/null 2>&1; then
  npm run check:protocol
else
  echo "  SKIPPED check:protocol -- no tau on PATH and TAU_BIN unset." >&2
  echo "  The committed generated.ts is being trusted without verification." >&2
fi

say "build"
npm run build

# ---------------------------------------------------------------------- vsix
if [ "$WHAT" = all ] || [ "$WHAT" = vsix ]; then
  say "vsix"
  rm -f "ffwf-tau-code-$VERSION.vsix"
  npm run package --workspace packages/vscode
  ls -lh "ffwf-tau-code-$VERSION.vsix"
fi

# --------------------------------------------------------------------- image
if [ "$WHAT" = all ] || [ "$WHAT" = image ]; then
  say "image"
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker is not on PATH." >&2
    exit 1
  fi
  # The image builds from the checkout, but with .dockerignore excluding every
  # dist/, so it compiles its own copy. That is the point: the image build is a
  # second, independent proof that the tree builds from source.
  docker build --target runtime -t "$IMAGE:$VERSION" -t "$IMAGE:latest" .
  docker build --target verify  -t "$IMAGE-verify:$VERSION" .

  say "image verify"
  # Proves the two runtimes reach each other: Node spawns the Python tau in the
  # image and gets a protocol answer back. No model is contacted.
  docker run --rm "$IMAGE-verify:$VERSION"
  docker images "$IMAGE" --format '  {{.Repository}}:{{.Tag}}  {{.Size}}'
fi

say "done"
echo "Nothing was published. To install the extension locally:"
echo "  code --install-extension $ROOT/ffwf-tau-code-$VERSION.vsix --force"
