#!/bin/bash
set -eo pipefail

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
