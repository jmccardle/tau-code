#!/usr/bin/env bash
# Publish built .vsix files to the two extension marketplaces.
#
#   scripts/publish-extension.sh [all|vscode|openvsx] [options] [FILE.vsix ...]
#
#   all | vscode | openvsx   which marketplace (default: all)
#   --version V              the version every file must carry
#                            (default: the root package.json's)
#   --skip-duplicate         a version a marketplace already has is not an
#                            error, so a re-run completes a half-publish
#   --no-repo-check          publish even if the listing's repository link is dead
#
# With no files it publishes ./ffwf-tau-code-$VERSION.vsix, the file
# `npm run package:vsix` leaves in the root. With files -- the release workflow
# passes a release's every .vsix -- it publishes those: the universal
# `ffwf.tau-code` and one `ffwf.tau-runtime` per target, which the marketplaces
# file as one platform-specific version.
#
# This publishes the ARCHIVES, not the working tree: `vsce publish --packagePath`
# and `ovsx publish <file>` both read the manifest out of the .vsix. So the two
# marketplaces get bit-identical extensions, and the packages being marked
# `private` does not get in the way. Each file's identity -- publisher, name,
# version, target -- is read back out of it here too, so a stale or misnamed
# file is refused before anything is uploaded.
#
# CREDENTIALS
#
#   VSCE_PAT   Azure DevOps personal access token for the `ffwf` publisher.
#              Scope: Marketplace > Manage. All accessible organizations.
#              https://dev.azure.com/  ->  User settings  ->  Personal access tokens
#
#   OVSX_PAT   Open VSX access token for the `ffwf` namespace. Requires a signed
#              Eclipse Contributor Agreement on the same account.
#              https://open-vsx.org/user-settings/tokens
#
# Set them in the environment this runs in. Both tools read them from there, so
# neither token is ever on a command line, and this script never writes them
# anywhere. In CI they are the `marketplaces` environment's secrets
# (.github/workflows/publish.yml).
#
# A published version number cannot be reused. Bump the version rather than
# trying to replace one.
#
# The Visual Studio Marketplace also rejects a `displayName` that any other
# extension already holds, anywhere on the marketplace -- it is the one field
# here that is not scoped by publisher, so owning `ffwf` does not help. There is
# no way to check it before uploading; the server answers "This extension display
# name is taken". Open VSX does not enforce it, so that leg can succeed while
# this one fails -- and --skip-duplicate is how the re-run finishes the job.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
VERSION="$(node -p "require('./package.json').version")"
PUBLISHER="$(node -p "require('./packages/vscode/package.json').publisher")"
REPO_URL="$(node -p "require('./packages/vscode/package.json').homepage")"
# The extensions this repository publishes, and which of them is per-target.
UNIVERSAL="$(node -p "require('./packages/vscode/package.json').name")"
PER_TARGET="$(node -p "require('./packages/runtime/package.json').name")"

# Pinned, because these two are handed the tokens: an upgrade is an edit here,
# not whatever npm resolves on the day.
VSCE=@vscode/vsce@4.0.0
OVSX=ovsx@1.2.0

usage() { echo "usage: $0 [all|vscode|openvsx] [--version V] [--skip-duplicate] [--no-repo-check] [FILE.vsix ...]" >&2; exit 2; }

WHAT=all
REPO_CHECK=1
SKIP_DUPLICATE=()
FILES=()
while [ $# -gt 0 ]; do
  case "$1" in
    all|vscode|openvsx) WHAT="$1" ;;
    --version)          [ $# -ge 2 ] || usage; VERSION="$2"; shift ;;
    --skip-duplicate)   SKIP_DUPLICATE=(--skip-duplicate) ;;
    --no-repo-check)    REPO_CHECK=0 ;;
    -*)                 usage ;;
    *)                  FILES+=("$1") ;;
  esac
  shift
done
[ ${#FILES[@]} -gt 0 ] || FILES=("$ROOT/ffwf-tau-code-$VERSION.vsix")

say() { printf '\n=== %s\n' "$1"; }

# `publisher name version target` out of a .vsix's own manifest; target is `-`
# for a universal one.
identity() {
  unzip -p "$1" extension.vsixmanifest | node -e '
    const xml = require("fs").readFileSync(0, "utf8");
    const tag = /<Identity\b[^>]*>/.exec(xml);
    if (!tag) { console.error("no <Identity> in extension.vsixmanifest"); process.exit(1); }
    const attr = (name) => (new RegExp(`\\b${name}="([^"]*)"`).exec(tag[0]) || [])[1];
    console.log([attr("Publisher"), attr("Id"), attr("Version"), attr("TargetPlatform") || "-"].join(" "));
  '
}

# ----------------------------------------------------------------- the files
say "$PUBLISHER $VERSION: ${#FILES[@]} file(s)"
# Runtimes first, so a reader who installs tau code the moment it appears finds
# the runtime it offers to fetch already there.
ORDERED=()
seen=" "
for pass in "$PER_TARGET" "$UNIVERSAL"; do
  for file in "${FILES[@]}"; do
    if [ ! -f "$file" ]; then
      echo "No $file." >&2
      echo "  Build it first: npm run package:vsix" >&2
      exit 1
    fi
    read -r publisher name version target < <(identity "$file")
    [ "$name" = "$pass" ] || continue
    # The version in the archive is what the marketplace records. Reading it
    # back out of the file rather than trusting the filename means a stale
    # .vsix cannot be published under a fresh version's name.
    if [ "$publisher" != "$PUBLISHER" ] || [ "$version" != "$VERSION" ]; then
      echo "  $file is $publisher.$name $version; expected $PUBLISHER.* $VERSION." >&2
      echo "  Rebuild it: npm run package:vsix" >&2
      exit 1
    fi
    if [ "$name" = "$PER_TARGET" ] && [ "$target" = - ]; then
      echo "  $file is a $name with no target platform; every $name is per-target." >&2
      exit 1
    fi
    if [ "$name" = "$UNIVERSAL" ] && [ "$target" != - ]; then
      echo "  $file is a $name for $target; $name is universal." >&2
      exit 1
    fi
    case "$seen" in
      *" $name@$target "*) echo "  $file is a second $name for $target." >&2; exit 1 ;;
    esac
    seen="$seen$name@$target "
    ORDERED+=("$file")
    printf '  %-12s %-13s %s\n' "$name" "$target" "$(ls -lh "$file" | awk '{print $5}')"
  done
done
if [ ${#ORDERED[@]} -ne ${#FILES[@]} ]; then
  echo "  Some files are neither $PUBLISHER.$UNIVERSAL nor $PUBLISHER.$PER_TARGET." >&2
  exit 1
fi

# A marketplace listing is mostly the README, and the README links here. A dead
# link on a listing page is a fault nobody can fix after publishing except by
# publishing again, so it is worth one HTTP request.
if [ "$REPO_CHECK" -eq 1 ]; then
  code="$(curl -s -o /dev/null -w '%{http_code}' -L "$REPO_URL" || echo 000)"
  if [ "$code" != "200" ]; then
    echo "  $REPO_URL answers $code." >&2
    echo "  The listing page links there. Push the repository first, or pass" >&2
    echo "  --no-repo-check to publish a listing with a dead link in it." >&2
    exit 1
  fi
  echo "  $REPO_URL is reachable."
fi

# --------------------------------------------------- Visual Studio Marketplace
if [ "$WHAT" = all ] || [ "$WHAT" = vscode ]; then
  say "Visual Studio Marketplace"
  if [ -z "${VSCE_PAT:-}" ]; then
    echo "VSCE_PAT is not set. See the header of this script." >&2
    exit 1
  fi
  # Fails on a token that is expired, scoped wrong, or belongs to another
  # publisher -- before anything is uploaded. vsce reads VSCE_PAT itself.
  npx --yes "$VSCE" verify-pat "$PUBLISHER"
  npx --yes "$VSCE" publish "${SKIP_DUPLICATE[@]}" --packagePath "${ORDERED[@]}"
  for name in $(printf '%s\n' "$seen" | tr ' ' '\n' | sed -n 's/@.*//p' | sort -u); do
    echo "  https://marketplace.visualstudio.com/items?itemName=$PUBLISHER.$name"
  done
fi

# ------------------------------------------------------------------- Open VSX
if [ "$WHAT" = all ] || [ "$WHAT" = openvsx ]; then
  say "Open VSX"
  if [ -z "${OVSX_PAT:-}" ]; then
    echo "OVSX_PAT is not set. See the header of this script." >&2
    exit 1
  fi
  # The namespace is a separate object from the extension and has to exist
  # first. Creating one that already exists is an error, not a no-op, so ask.
  ns="$(curl -s -o /dev/null -w '%{http_code}' "https://open-vsx.org/api/$PUBLISHER" || echo 000)"
  case "$ns" in
    200) echo "  namespace $PUBLISHER exists." ;;
    404) echo "  creating namespace $PUBLISHER."
         npx --yes "$OVSX" create-namespace "$PUBLISHER" ;;
    *)   echo "  open-vsx.org answered $ns for the namespace check." >&2; exit 1 ;;
  esac
  # One file per call: ovsx publishes a single archive. It reads OVSX_PAT itself.
  for file in "${ORDERED[@]}"; do
    npx --yes "$OVSX" publish "$file" "${SKIP_DUPLICATE[@]}"
  done
  for name in $(printf '%s\n' "$seen" | tr ' ' '\n' | sed -n 's/@.*//p' | sort -u); do
    echo "  https://open-vsx.org/extension/$PUBLISHER/$name"
  done
fi

say "done"
echo "Installed from a marketplace with:"
echo "  code   --install-extension $PUBLISHER.$UNIVERSAL"
echo "  codium --install-extension $PUBLISHER.$UNIVERSAL"
