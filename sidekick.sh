#!/bin/bash
set -eo pipefail

case "$1" in
  start)
    cd "$(dirname $0)"
    yarn start
    ;;

  *)
    echo "usage: $0 start"
    echo "There's no other commands yet."
    ;;
esac
