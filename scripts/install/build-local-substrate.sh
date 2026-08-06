#!/usr/bin/env bash
# Builds the local-substrate stack (m80) on the local target; writes an empty
# manifest on the real one, where the declaration deliberately produces
# nothing and the build would throw (the all-omitted-stack convention, see
# test/local-substrate.test.ts). The component's kubectl-apply of an empty
# manifest applies nothing — the honest real-target shape.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "${ROOT}/dist"
if [ -z "${AWS_ENDPOINT_URL:-}" ]; then
    : > "${ROOT}/dist/local-substrate.yaml"
    echo "==> local-substrate: real target, nothing to declare"
    exit 0
fi
(cd "${ROOT}" && npx chant build src/local-substrate --lexicon k8s -o dist/local-substrate.yaml >/dev/null)
echo "==> built dist/local-substrate.yaml"
