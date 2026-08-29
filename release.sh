#!/usr/bin/env bash
# Verify, and cut a release.
#
#   ./release.sh --check          everything that does not touch the network
#   ./release.sh --check --net    the above, plus compiling every exercise
#   ./release.sh --site DIR       stage the publishable site into DIR
#   ./release.sh 1.2.0            --check --net, then changelog and tag
#
# One owner for the verification sequence, and one for what "the site" is. Both
# used to be written out in ci.yml, release.yml and this script, and both had
# drifted: the workbench suite ran in CI and in neither release path, and the
# Pages deploy published the whole repository, so 3 MB of source markdown that
# data/ already encodes was live and fetchable on the domain.
set -euo pipefail

# The publishable site. Everything else in the repo is source, tests or history.
SITE=(index.html assets data llms.txt vercel.json CNAME .nojekyll README.md LICENSE)

site() {
  local dest="$1"
  rm -rf "$dest"
  mkdir -p "$dest"
  cp -R "${SITE[@]}" "$dest"/
  rm -f "$dest/data/.validate-cache.json"
  du -sh "$dest"
}

# Everything a human reads, including the documents that state the rule.
# CONTRIBUTING says CI enforces this, so the check has to cover the file
# CONTRIBUTING itself lives in.
PROSE="content assets build.py index.html README.md CONTRIBUTING.md
       CODE_OF_CONDUCT.md SECURITY.md CHANGELOG.md docs
       .github/ISSUE_TEMPLATE .github/pull_request_template.md test_*.*"

check() {
  local net="${1:-}"

  echo "building"
  python3 build.py > /dev/null
  if [ -n "$(git status --porcelain data/)" ]; then
    echo "data/ is stale. Run 'python3 build.py' and commit the result." >&2
    git --no-pager diff --stat data/ >&2
    return 1
  fi

  echo "the prose rule"
  if grep -rlq '—\|–' $PROSE 2>/dev/null; then
    echo "em or en dashes found. The rule in docs/AUTHORING.md is absolute." >&2
    grep -rn '—\|–' $PROSE 2>/dev/null | head -20 >&2
    return 1
  fi

  echo "testing"
  python3 test_build.py  > /dev/null
  node     test_views.mjs > /dev/null
  node     test_vim.mjs   > /dev/null

  if [ "$net" = "--net" ]; then
    echo "the workbench, against the live compiler"
    node test_workbench.mjs > /dev/null

    echo "compiling every exercise"
    python3 build.py --validate | tail -2
  fi
}

if [ "${1:-}" = "--site" ]; then
  site "${2:?usage: ./release.sh --site <dir>}"
  exit 0
fi

if [ "${1:-}" = "--check" ]; then
  check "${2:-}"
  echo "ok"
  exit 0
fi

VERSION="${1:-}"
[ -n "$VERSION" ] || { echo "usage: ./release.sh <version>   e.g. ./release.sh 1.2.0"; exit 1; }
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || {
  echo "version must be semver, for example 1.2.0 or 1.2.0-rc.1"; exit 1; }
TAG="v$VERSION"

git rev-parse --verify "$TAG" >/dev/null 2>&1 && { echo "$TAG already exists"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "working tree is dirty"; exit 1; }
[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || { echo "not on main"; exit 1; }

check --net

echo "updating the changelog"
python3 - "$VERSION" <<'PY'
import datetime, pathlib, sys
v = sys.argv[1]
p = pathlib.Path("CHANGELOG.md")
s = p.read_text()
today = datetime.date.today().isoformat()
if f"## [{v}]" in s:
    sys.exit(f"CHANGELOG already has {v}")
s = s.replace("## [Unreleased]", f"## [Unreleased]\n\nNothing yet.\n\n## [{v}] - {today}", 1)
s = s.replace("Nothing yet.\n\nNothing yet.\n", "Nothing yet.\n", 1)
p.write_text(s)
print(f"  CHANGELOG entry for {v}")
PY

git add CHANGELOG.md data
git commit -q -m "Release $VERSION"
git tag -a "$TAG" -m "$VERSION"

echo
echo "tagged $TAG. To publish:"
echo "  git push origin main --follow-tags"
