#!/usr/bin/env bash
# Builds this kit's estate at one tier and applies it to the cluster already
# up. Split out of local-up.sh so a tier change is one command rather than a
# whole rebuild — which is also the path that exercises what the operator's
# webhook does when a tier moves an immutable field.
#
#   ./scripts/local/apply-estate.sh prod-ha
#
# Now a thin wrapper: scripts/install/build-estate.sh does the build (with
# the AWS-plane readbacks, target-agnostic), and this applies the result.
# The workload COMPONENT does the same two things as declared steps; this
# script remains for the manual tier-change path (`just apply-tier`) until
# the runner flag day retires it.
set -euo pipefail
. "$(dirname "$0")/../lib-kube.sh"
# Local-target scripts know their own cluster. The install scripts under
# scripts/install/ deliberately do not default this: they are shared with the
# live target, where a k3d context would be the wrong cluster entirely.
KMV_KUBE_CONTEXT="${KMV_KUBE_CONTEXT:-k3d-${CLUSTER:-kubemicrovm-local}}"

TIER="${1:-${KMV_TIER:-minimal}}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

bash "${ROOT}/scripts/install/build-estate.sh" "${TIER}"
kubectl apply -f "${ROOT}/dist/workload-${TIER}.yaml"
