#!/usr/bin/env bash
# Installs `just`, with a fallback, because one upstream URL is a single point
# of failure for every workflow here.
#
#   ./scripts/install-just.sh [dir]     # default /usr/local/bin
#
# just.systems/install.sh answered 403 mid-session and took a green pipeline
# red on a step that had nothing to do with the change. It is rate limiting
# rather than an outage, and it recurs — every run here installs just at least
# twice, so the busier the day the likelier it is.
#
# So: retry the official script, then fall back to the GitHub release archive.
# Two independent hosts, and the fallback is the same binary the script fetches.
set -uo pipefail

DEST="${1:-/usr/local/bin}"

if command -v just >/dev/null 2>&1; then
    echo "just: already installed ($(just --version))"
    exit 0
fi

if curl -sfL --retry 3 --retry-delay 2 https://just.systems/install.sh |
        bash -s -- --to "${DEST}" >/dev/null 2>&1 && command -v just >/dev/null 2>&1; then
    echo "just: installed from just.systems ($(just --version))"
    exit 0
fi

echo "just: just.systems did not answer, trying the GitHub release" >&2

case "$(uname -s)" in
    Linux)  target="x86_64-unknown-linux-musl" ;;
    Darwin) case "$(uname -m)" in
                arm64) target="aarch64-apple-darwin" ;;
                *)     target="x86_64-apple-darwin" ;;
            esac ;;
    *) echo "just: no fallback for $(uname -s)" >&2; exit 1 ;;
esac

tag="$(curl -sfL --retry 3 https://api.github.com/repos/casey/just/releases/latest |
    sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)"
if [ -z "${tag}" ]; then
    echo "just: could not resolve the latest release tag" >&2
    exit 1
fi

url="https://github.com/casey/just/releases/download/${tag}/just-${tag}-${target}.tar.gz"
tmp="$(mktemp -d)"
if ! curl -sfL --retry 3 "${url}" -o "${tmp}/just.tar.gz"; then
    echo "just: could not download ${url}" >&2
    exit 1
fi

tar -xzf "${tmp}/just.tar.gz" -C "${tmp}" just || {
    echo "just: archive did not contain the binary" >&2; exit 1
}
install -m 0755 "${tmp}/just" "${DEST}/just" 2>/dev/null ||
    sudo install -m 0755 "${tmp}/just" "${DEST}/just" || {
    echo "just: could not install to ${DEST}" >&2; exit 1
}
rm -rf "${tmp}"

echo "just: installed from the GitHub release ${tag} ($(just --version))"
