#!/bin/bash
set -eo pipefail

git fetch --all --prune
echo ""

echo "Commits on nightly, waiting for beta:"
echo ""
git cherry -v main develop | grep -E '^\+'
echo ""

lastStableVersion=`git describe --tags --abbrev=0 main`

echo "Commits on beta since ${lastStableVersion}:"
echo ""
git log --oneline ${lastStableVersion}...main | cat
echo ""

