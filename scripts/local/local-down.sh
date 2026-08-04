#!/usr/bin/env bash
# Tears the local target back down: the k3d cluster and the floci container.
# Nothing here touches AWS, because nothing on this target was ever in AWS.
set -euo pipefail
. "$(dirname "$0")/../lib-kube.sh"
# Local-target scripts know their own cluster. The install scripts under
# scripts/install/ deliberately do not default this: they are shared with the
# live target, where a k3d context would be the wrong cluster entirely.
KMV_KUBE_CONTEXT="${KMV_KUBE_CONTEXT:-k3d-${CLUSTER:-kubemicrovm-local}}"

CLUSTER="${CLUSTER:-kubemicrovm-local}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# Ask the teardown Op to remove the estate first, if the cluster is still
# there. Deleting the cluster underneath it would work too and would teach
# nothing — the Op is the path an adopter on EKS has, and it is worth
# exercising on the way down as well as on the way up.
if kubectl config get-contexts "k3d-${CLUSTER}" >/dev/null 2>&1; then
    (cd "${ROOT}" && AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://localhost:4566}" \
        npx chant run kubemicrovm-teardown) || \
        echo "teardown Op did not finish; deleting the cluster anyway" >&2
fi

echo "==> cluster ${CLUSTER}"
k3d cluster delete "${CLUSTER}" >/dev/null 2>&1 || true

echo "==> floci"
docker rm -f "${FLOCI_CONTAINER:-floci}" >/dev/null 2>&1 || true

echo "local target down."
