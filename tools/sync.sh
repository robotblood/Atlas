#!/usr/bin/env bash
# Copy the kit into a project at vendor/atlas/, or check whether it is behind.
#   tools/sync.sh "../Street Notice"           copy
#   tools/sync.sh "../Street Notice" --check   report only
# Each project keeps its own pinned copy: a kit change never breaks a page
# that has not been synced, and a published project needs nothing else.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
proj="${1:?usage: tools/sync.sh <project-dir> [--check]}"
dest="$proj/vendor/atlas"
want="$(cat "$here/kit/VERSION")"
have="$(cat "$dest/VERSION" 2>/dev/null || echo none)"
if [[ "${2:-}" == "--check" ]]; then
	if [[ "$have" == "$want" ]] && diff -rq "$here/kit" "$dest" >/dev/null 2>&1; then
		echo "up to date: $proj ($have)"
	else
		echo "behind: $proj has $have, kit is $want"; diff -rq "$here/kit" "$dest" 2>/dev/null | head -20 || true; exit 1
	fi
	exit 0
fi
mkdir -p "$dest"
rsync -a --delete "$here/kit/" "$dest/"
echo "synced kit $want → $dest (was $have)"
