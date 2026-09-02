#!/usr/bin/env bash
# Publish the built .vsix to the two extension marketplaces.
#
#   scripts/publish-extension.sh              both
#   scripts/publish-extension.sh vscode       Visual Studio Marketplace only
#   scripts/publish-extension.sh openvsx      Open VSX only
#
# This publishes the ARCHIVE, not the working tree: `vsce publish --packagePath`
# and `ovsx publish <file>` both read the manifest out of the .vsix. So the two
# marketplaces get bit-identical extensions, and `packages/vscode/package.json`
# being marked `private` does not get in the way.
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
# Set them in the shell you run this from. This script never writes them
# anywhere, and passes each one only to the tool that needs it.
#
# A published version number cannot be reused. Bump the version rather than
# trying to replace one.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
VERSION="$(node -p "require('./package.json').version")"
PUBLISHER="$(node -p "require('./packages/vscode/package.json').publisher")"
NAME="$(node -p "require('./packages/vscode/package.json').name")"
REPO_URL="$(node -p "require('./packages/vscode/package.json').homepage")"
VSIX="$ROOT/ffwf-tau-code-$VERSION.vsix"

WHAT=all
REPO_CHECK=1
for arg in "$@"; do
  case "$arg" in
    all|vscode|openvsx) WHAT="$arg" ;;
    --no-repo-check)    REPO_CHECK=0 ;;
    *) echo "usage: $0 [all|vscode|openvsx] [--no-repo-check]" >&2; exit 2 ;;
  esac
done

say() { printf '\n=== %s\n' "$1"; }

# ------------------------------------------------------------------ the vsix
say "$PUBLISHER.$NAME $VERSION"
if [ ! -f "$VSIX" ]; then
  echo "No $VSIX." >&2
  echo "  Build it first: npm run package:vsix" >&2
  exit 1
fi
# The version in the archive is what the marketplace records. Reading it back
# out of the file rather than trusting the filename means a stale .vsix cannot
# be published under a fresh version's name.
PACKED="$(unzip -p "$VSIX" extension/package.json | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).version")"
if [ "$PACKED" != "$VERSION" ]; then
  echo "  $VSIX contains version $PACKED, the tree says $VERSION." >&2
  echo "  Rebuild it: npm run package:vsix" >&2
  exit 1
fi
ls -lh "$VSIX" | awk '{print "  " $9 "  " $5}'

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
  # publisher -- before anything is uploaded.
  npx --yes @vscode/vsce verify-pat "$PUBLISHER" --pat "$VSCE_PAT"
  npx --yes @vscode/vsce publish --packagePath "$VSIX" --pat "$VSCE_PAT"
  echo "  https://marketplace.visualstudio.com/items?itemName=$PUBLISHER.$NAME"
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
         npx --yes ovsx create-namespace "$PUBLISHER" -p "$OVSX_PAT" ;;
    *)   echo "  open-vsx.org answered $ns for the namespace check." >&2; exit 1 ;;
  esac
  npx --yes ovsx publish "$VSIX" -p "$OVSX_PAT"
  echo "  https://open-vsx.org/extension/$PUBLISHER/$NAME"
fi

say "done"
echo "Installed from a marketplace with:"
echo "  code   --install-extension $PUBLISHER.$NAME"
echo "  codium --install-extension $PUBLISHER.$NAME"
