#!/usr/bin/env bash
# Take upstream's updates into this fork, without losing our patches.
#
# The fork's commits sit on top of upstream/main and are deliberately small
# and independent, so a rebase usually lands without a conflict. When it
# does not, the fix is to re-apply that one change by hand -- the point of
# keeping them separate is that there is only ever one thing to redo.
#
#   ops/sync-upstream.sh            rebase, verify, build the image
#   ops/sync-upstream.sh --deploy   also roll the deployment onto the new image
#
# Every step is bounded so a slow network shows progress instead of hanging.
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n== %s ==\n' "$1"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1"; exit 1; }; }
need git; need gh; need timeout

DEPLOY=0
[ "${1:-}" = "--deploy" ] && DEPLOY=1

say "fetch upstream"
timeout 120 git fetch upstream main
git log --oneline -1 upstream/main

say "what upstream has that we do not"
git log --oneline HEAD..upstream/main | head -20
echo "   $(git rev-list --count HEAD..upstream/main) commits upstream of us"

say "rebase our commits onto upstream/main"
# Our commits are the ones upstream/main does not have. Rebasing keeps them
# separate, so a conflict is confined to one change.
git rebase upstream/main

say "what we changed on top of upstream"
git log --oneline upstream/main..HEAD

say "typecheck"
for p in contracts db api; do
  echo "  $p"
  timeout 900 pnpm --filter "@rakazo/$p" exec tsc --noEmit -p tsconfig.json
done

say "tests"
for p in db api; do
  echo "  $p"
  timeout 1200 pnpm --filter "@rakazo/$p" test
done

say "push"
git push origin main

say "build the image"
timeout 60 gh workflow run publish-server-image.yml --repo "$(git config --get remote.origin.url | sed -E 's#.*github.com[:/]([^/]+/[^/]+?)(\.git)?$#\1#')" --ref main
echo "  watch it:  gh run list --repo Martinbed/rakazo --limit 3"

if [ "$DEPLOY" = 1 ]; then
  say "deploy"
  echo "  On the host:  cd /home/martinbed/rakazo && docker compose -f docker-compose.images.yml up -d"
  echo "  (the fork image is already set in .env; nothing else changes)"
fi

say "done"
