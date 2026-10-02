#!/bin/sh
# Reproduces the numbers in docs/VALIDATION.md. Makes blobless clones (history only, no file
# contents beyond HEAD) of a few public repositories into a temp directory.
# Usage: scripts/validate-oss.sh [workdir]
set -eu
WORK="${1:-$(mktemp -d)}"
CLI="$(cd "$(dirname "$0")/.." && pwd)/dist/src/cli.js"
for repo in pallets/flask psf/requests django/django rails/rails; do
  name="${repo#*/}"
  [ -d "$WORK/$name" ] || git clone -q --filter=blob:none "https://github.com/$repo.git" "$WORK/$name"
  echo "== $repo @ $(git -C "$WORK/$name" rev-parse --short HEAD)"
  node "$CLI" backtest --sweep --repo "$WORK/$name" --no-color | grep -E '^ +(›|[0-9])'
done
