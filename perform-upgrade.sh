#!/bin/sh
set -eo pipefail

TARGET="$1"

# get rid of local branch, in case of rebases
git reset --hard HEAD
git checkout -b tmp || true
git branch -D $TARGET || true

# fetch updated refs
git fetch --all --prune

# create new local branch from remote
git checkout $TARGET
git branch -D tmp || true