#!/usr/bin/env bash
# Tears the local target back down: the k3d cluster and the floci container.
# Nothing here touches AWS, because nothing on this target was ever in AWS.
set -euo pipefail

CLUSTER="${CLUSTER:-kubemicrovm-local}"

echo "==> cluster ${CLUSTER}"
k3d cluster delete "${CLUSTER}" >/dev/null 2>&1 || true

echo "==> floci"
docker rm -f floci-kmv >/dev/null 2>&1 || true

echo "local target down."
