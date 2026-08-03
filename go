#!/usr/bin/env bash
# From a fresh clone to a running MicroVM, in one command.
#
#   ./go            # check prerequisites, offer to install, then stand it up
#   ./go prod-ha    # the same at another tier
#   ./go --yes      # do not ask before installing (what CI runs)
#
# This exists to be the whole lead-in. Everything it does is a documented
# command you could run yourself — it is not a second way to do things, it is
# the three you would have run in order, so that showing someone the repo does
# not start with a list of eight installs.
#
# Deliberately not a `just` recipe: `just` is one of the things it installs.
set -uo pipefail

TIER="minimal"
ASK="ask"
for arg in "$@"; do
    case "${arg}" in
        --yes|-y) ASK="--yes" ;;
        minimal|prod|prod-ha) TIER="${arg}" ;;
        *) echo "usage: $0 [minimal|prod|prod-ha] [--yes]" >&2; exit 2 ;;
    esac
done

cd "$(dirname "$0")"

echo "==> prerequisites"
if [ "${ASK}" = "--yes" ]; then
    bash scripts/local/prereqs.sh --yes || exit 1
else
    bash scripts/local/prereqs.sh || exit 1
fi

echo ""
echo "==> dependencies"
npm install --silent || { echo "npm install failed" >&2; exit 1; }

echo ""
echo "==> standing up the ${TIER} estate on k3d, floci and m80"
echo "    about four minutes, and nothing here costs anything"
echo ""
just "${TIER}-local-e2e"
