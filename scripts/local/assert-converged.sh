#!/usr/bin/env bash
# Waits for the estate at one tier to actually converge, and fails loudly with
# the operator's own log if it does not.
#
#   ./scripts/local/assert-converged.sh prod-ha
#
# This is the difference between "the manifests applied" and "the operator
# accepted them". Every one of the four schema gaps on the local-target docs
# page applied cleanly and failed here.
set -euo pipefail

TIER="${1:-${KMV_TIER:-minimal}}"
NS="${KMV_NAMESPACE:-microvm-demo}"
OPERATOR_NS="${NS_OPERATOR:-kube-microvm}"
TIMEOUT="${TIMEOUT:-600}"

fail() {
    echo "" >&2
    echo "converge failed at tier ${TIER}: $1" >&2
    echo "" >&2
    kubectl -n "${NS}" get microvmimages,microvms,microvmreplicasets,microvmnetworks -o wide >&2 || true
    echo "" >&2
    kubectl -n "${OPERATOR_NS}" logs deploy/kube-microvm-operator --tail=80 >&2 || true
    exit 1
}

# Poll a jsonpath until it matches, or give up with the operator's reasoning.
wait_for() {
    local what="$1" query="$2" want="$3" deadline=$((SECONDS + TIMEOUT))
    while [ "${SECONDS}" -lt "${deadline}" ]; do
        if kubectl -n "${NS}" get ${query} 2>/dev/null | grep -qE "${want}"; then
            echo "    ${what}: ok"
            return 0
        fi
        sleep 5
    done
    fail "${what} never reached ${want} within ${TIMEOUT}s"
}

echo "==> waiting for the ${TIER} estate to converge"

wait_for "image build" \
    "microvmimage -o jsonpath={.items[*].status.latestVersionState}" \
    "SUCCESSFUL"

if [ "${TIER}" = "minimal" ]; then
    wait_for "the MicroVM" \
        "microvm -o jsonpath={.items[*].status.state}" \
        "Running"
else
    wait_for "the network connector" \
        "microvmnetwork -o jsonpath={.items[*].status.connectorState}" \
        "ACTIVE"

    # The floor, not just a replica: readyReplicas has to equal what the tier
    # asked for, which is the whole point of prod-ha having one.
    want_replicas="$(kubectl -n "${NS}" get microvmreplicaset -o jsonpath='{.items[0].spec.replicas}')"
    wait_for "the replica floor (${want_replicas})" \
        "microvmreplicaset -o jsonpath={.items[0].status.readyReplicas}" \
        "^${want_replicas}$"
fi

echo "    the ${TIER} estate converged"
