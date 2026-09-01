#!/usr/bin/env bash
# Reserve the ffwf-tau* namespace on npm and PyPI.
#
#   scripts/reserve-names.sh            build the placeholders, publish nothing
#   scripts/reserve-names.sh --publish  actually publish them
#
# This is not a metapackage and not a shim. Each placeholder is an empty package
# whose only content is a README saying the name is reserved and where the real
# thing lives. That is the honest version of the thing people call
# anti-typosquatting: it does not pretend to be software.
#
# WHAT THIS DOES NOT DO
#
# The npm scope `@ffwf` is the reservation that actually matters, and it cannot
# be claimed from a script. Create the organisation at
# https://www.npmjs.com/org/create -- it is free for public packages, it covers
# `@ffwf/*` forever, and no future package under it needs its own reservation.
# Do that FIRST. The unscoped names below are a smaller, separate thing: they
# stop someone publishing `ffwf-tau` on npm, which the scope does not.
#
# npm also refuses new names that are too similar to an existing one, so
# publishing `ffwf-tau-code` blocks its near-misses without further effort.
set -euo pipefail

cd "$(dirname "$0")/.."
REPO_URL="https://github.com/jmccardle/tau-code"
TAU_URL="https://github.com/jmccardle/tau"
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT

PUBLISH=0
[ "${1:-}" = "--publish" ] && PUBLISH=1

# name:what-it-points-at
NPM_NAMES=(
  "ffwf-tau|the tau agent harness, on PyPI as ffwf-tau|$TAU_URL"
  "ffwf-tau-llm|part of the tau agent harness, on PyPI as ffwf-tau-llm|$TAU_URL"
  "ffwf-tau-agent-core|part of the tau agent harness, on PyPI as ffwf-tau-agent-core|$TAU_URL"
  "ffwf-tau-coding-agent|part of the tau agent harness, on PyPI as ffwf-tau-coding-agent|$TAU_URL"
  "ffwf-tau-jmfts|part of the tau agent harness, on PyPI as ffwf-tau-jmfts|$TAU_URL"
  "ffwf-tau-code|editor and browser clients for tau|$REPO_URL"
  "tau-code|editor and browser clients for tau|$REPO_URL"
)

PYPI_NAMES=(
  "tau-code|editor and browser clients for tau|$REPO_URL"
  "ffwf-tau-code|editor and browser clients for tau|$REPO_URL"
)

readme() {  # name description url
  cat <<EOF
# $1

**This name is reserved. There is nothing to install here.**

It is held so that nobody else publishes under a name close to
[tau]($TAU_URL)'s. It has no code and never will.

$1 would be $2.

The real artifacts are at $3.
EOF
}

say() { printf '\n=== %s\n' "$1"; }

# ----------------------------------------------------------------------- npm
say "npm"
for entry in "${NPM_NAMES[@]}"; do
  IFS='|' read -r name what url <<<"$entry"
  dir="$BUILD/npm/$name"
  mkdir -p "$dir"
  readme "$name" "$what" "$url" > "$dir/README.md"
  cat > "$dir/package.json" <<EOF
{
  "name": "$name",
  "version": "0.0.1",
  "description": "Reserved name. Nothing to install; see $url",
  "license": "MIT",
  "files": ["README.md"],
  "repository": { "type": "git", "url": "git+$url.git" }
}
EOF
  if [ "$PUBLISH" -eq 1 ]; then
    (cd "$dir" && npm publish --access public)
    # A deprecation notice prints on every install, so anyone who reaches this
    # by a typo is told immediately rather than left with an empty package.
    npm deprecate "$name@0.0.1" "Reserved name, not a package. See $url"
  else
    echo "  would publish $name@0.0.1 -> $url"
  fi
done

# ---------------------------------------------------------------------- pypi
say "pypi"
PY="${PYTHON:-python3}"
if ! "$PY" -c "import build" 2>/dev/null; then
  echo "  $PY has no build module. Install it, or set PYTHON to one that has it:" >&2
  echo "    PYTHON=/path/to/venv/bin/python scripts/reserve-names.sh" >&2
  exit 1
fi
for entry in "${PYPI_NAMES[@]}"; do
  IFS='|' read -r name what url <<<"$entry"
  dir="$BUILD/pypi/$name"
  mkdir -p "$dir/src/${name//-/_}"
  readme "$name" "$what" "$url" > "$dir/README.md"
  touch "$dir/src/${name//-/_}/__init__.py"
  cat > "$dir/pyproject.toml" <<EOF
[build-system]
requires = ["setuptools>=77"]
build-backend = "setuptools.build_meta"

[project]
name = "$name"
version = "0.0.1"
description = "Reserved name. Nothing to install; see $url"
readme = "README.md"
license = "MIT"
requires-python = ">=3.11"

[project.urls]
Homepage = "$url"

[tool.setuptools.packages.find]
where = ["src"]
EOF
  (cd "$dir" && "$PY" -m build --sdist --wheel >/dev/null)
  if [ "$PUBLISH" -eq 1 ]; then
    (cd "$dir" && "$PY" -m twine upload dist/*)
  else
    echo "  would upload $name 0.0.1 -> $url"
    ls "$dir/dist" | sed 's/^/    /'
  fi
done

say "done"
if [ "$PUBLISH" -eq 0 ]; then
  echo "Nothing was published. Re-run with --publish once you have:"
  echo "  1. created the npm organisation @ffwf   (npmjs.com/org/create)"
  echo "  2. run  npm login,  and set up a PyPI token for twine"
  echo "PyPI names cannot be released once taken, and npm unpublish is blocked"
  echo "after 72 hours. Both of these are one-way."
fi
