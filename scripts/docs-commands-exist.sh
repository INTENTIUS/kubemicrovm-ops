#!/usr/bin/env bash
# Every `just <recipe>` the docs tell a reader to run has to be a recipe that
# exists. Nothing else here checks that, and the failure mode is the worst kind
# — a reader follows the documented command and it does not exist, which reads
# as the repo being broken rather than the docs being stale.
#
#   ./scripts/docs-commands-exist.sh
#
# This is deliberately narrow. It does not check that the docs describe what a
# recipe does, only that the reader can run what they are told to run.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

# --summary is a space-separated list of recipe names, which is exactly the
# comparison set. It also fails if the justfile does not parse, which is a
# check worth having twice.
recipes="$(just --summary)"

# Only code counts. "just" is also an ordinary English word — "did the estate
# converge, not just apply" is prose, not an instruction to run `just apply` —
# so scanning the whole file finds commands nobody wrote. Fenced blocks and
# inline backtick spans are where a command actually lives.
code="$(for f in README.md content/docs/*.md; do
    [ -f "${f}" ] || continue
    awk '/^```/ { fenced = !fenced; next } fenced { print }' "${f}"
    grep -oE '`[^`]*`' "${f}" 2>/dev/null | tr -d '`'
done | sed 's/#.*//')"
# The sed drops shell comments: a trailing `# ... not just apply` inside a code
# block is still prose, and it is where this check first tripped over itself.

# `just` followed by a recipe name. A leading dash is a flag, and bare `just`
# is the listing; neither is a recipe to look up.
mentioned="$(printf '%s\n' "${code}" |
    grep -oE '\bjust +[a-z][a-z0-9-]*' |
    sed 's/^just  *//' | sort -u)"

missing=""
for name in ${mentioned}; do
    found=0
    for recipe in ${recipes}; do
        if [ "${name}" = "${recipe}" ]; then
            found=1
            break
        fi
    done
    if [ "${found}" -eq 0 ]; then
        missing="${missing} ${name}"
        printf 'documented but not a recipe: just %s\n' "${name}" >&2
        grep -rn "just ${name}" README.md content/docs/*.md | sed 's/^/    /' >&2
    fi
done

if [ -n "${missing}" ]; then
    echo "" >&2
    echo "the docs name recipes that do not exist:${missing}" >&2
    echo "either add them to the justfile or fix the docs" >&2
    exit 1
fi

printf 'every documented `just` command exists (%s checked)\n' \
    "$(printf '%s\n' ${mentioned} | grep -c .)"
