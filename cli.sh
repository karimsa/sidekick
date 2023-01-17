#!/bin/bash
set -e

function parse_json() {
    file="$1"
    key="$2"

    cat "$file" | grep "$key" | head -n1 | cut -d: -f2 | cut -d\" -f2
}

function get_dirname() {
    cd `dirname $0`

    if readlink `basename $0` &>/dev/null; then
        cd `dirname $(readlink $(basename $0))`
    fi

    pwd
}

dirname=`get_dirname`

if test -z "$PROJECT_PATH"; then
    export PROJECT_PATH="$PWD"
fi

projectName=`parse_json ${PROJECT_PATH}/package.json name 2>/dev/null`
if test -z "$projectName"; then
    exec node "$(dirname $0)/cli.dist.js" $@
fi

channel=`parse_json $HOME/.sidekick/${projectName}/config.json releaseChannel 2>/dev/null`
if test -z "$channel"; then
    channel="stable"
fi

if test "$channel" != "stable" && ! test -z "$channel"; then
    exec node "$HOME/.sidekick/channels/${channel}/cli.dist.js" $@
else
    exec node "${dirname}/cli.dist.js" $@
fi

