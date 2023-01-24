#!/bin/bash
set -eo pipefail

git fetch --all --prune
echo ""

echo "Commits on nightly, waiting for beta:"
echo ""
git cherry -v origin/main origin/develop | grep -E '^\+'
echo ""

lastStableVersion=`git describe --tags --abbrev=0 origin/main`

echo "Commits on beta since ${lastStableVersion}:"
echo ""
git log --oneline ${lastStableVersion}...origin/main | cat
echo ""

