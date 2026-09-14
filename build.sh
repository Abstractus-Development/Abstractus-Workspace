#!/bin/bash -e
# Abstractus Connector: the build lives in scripts/build.mjs so it runs on Windows too.
# Usage: ./build.sh [-d] [-v VERSION] [--zip]
CWD="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
exec node "$CWD/scripts/build.mjs" "$@"
