#!/usr/bin/env bash
# Cut a release.
#
#   ./release.sh 1.2.0
#
# Verifies first, then tags. The tag is what triggers the release workflow, so
# nothing is published that has not already built, tested and compiled here.
set -euo pipefail

VERSION="${1:-}"
[ -n "$VERSION" ] || { echo "usage: ./release.sh <version>   e.g. ./release.sh 1.2.0"; exit 1; }
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || {
  echo "version must be semver, for example 1.2.0 or 1.2.0-rc.1"; exit 1; }
TAG="v$VERSION"

git rev-parse --verify "$TAG" >/dev/null 2>&1 && { echo "$TAG already exists"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "working tree is dirty"; exit 1; }
[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || { echo "not on main"; exit 1; }

echo "building"
python3 build.py >/dev/null
[ -z "$(git status --porcelain data/)" ] || {
  echo "data/ is stale. Run 'python3 build.py' and commit the result."; exit 1; }

echo "testing"
python3 test_build.py  > /dev/null
node     test_views.mjs > /dev/null
node     test_vim.mjs   > /dev/null

echo "compiling every exercise"
python3 build.py --validate | tail -2

echo "updating the changelog"
python3 - "$VERSION" <<'PY'
import datetime, pathlib, re, sys
v = sys.argv[1]
p = pathlib.Path("CHANGELOG.md")
s = p.read_text()
today = datetime.date.today().isoformat()
if f"## [{v}]" in s:
    sys.exit(f"CHANGELOG already has {v}")
s = s.replace("## [Unreleased]", f"## [Unreleased]\n\nNothing yet.\n\n## [{v}] - {today}", 1)
s = re.sub(r"\n## \[Unreleased\]\n\nNothing yet\.\n\nNothing yet\.\n", "\n## [Unreleased]\n\nNothing yet.\n", s)
p.write_text(s)
print(f"  CHANGELOG entry for {v}")
PY

git add CHANGELOG.md data
git commit -q -m "Release $VERSION"
git tag -a "$TAG" -m "$VERSION"

echo
echo "tagged $TAG. To publish:"
echo "  git push origin main --follow-tags"
