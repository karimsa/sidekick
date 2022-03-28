#!/bin/bash
set -eo pipefail

mkdir -p "$HOME/.sidekick"

case "$1" in
  start)
    PROJECT_PATH="$PWD"
    cd "$(dirname "$0")"
    PROJECT_PATH="$PROJECT_PATH" yarn start
    ;;

  *)
    echo "usage: $0 start"
    echo "There's no other commands yet."
    ;;
esac
