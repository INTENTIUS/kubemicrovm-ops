#!/usr/bin/env bash
# Removes the custom resources, VMs before images.
#
# The operator refuses to delete a MicroVMImage while a VM references it, so
# the order is not a preference. Each delete waits, because a CR with a
# finalizer the operator has not yet removed will otherwise look deleted and
# still be there — KubeMicroVM#51 is exactly that failing.
set -euo pipefail

NS="${KMV_NAMESPACE:-microvm-demo}"
TIMEOUT="${TIMEOUT:-180s}"

if ! kubectl get namespace "${NS}" >/dev/null 2>&1; then
    echo "==> ${NS} is already gone"
    exit 0
fi

for kind in microvmreplicasets microvms microvmimages microvmclasses microvmnetworks; do
    if kubectl -n "${NS}" get "${kind}" -o name 2>/dev/null | grep -q .; then
        echo "==> ${kind}"
        kubectl -n "${NS}" delete "${kind}" --all --timeout="${TIMEOUT}" || {
            echo "    ${kind} did not delete cleanly — a finalizer may be stuck (KubeMicroVM#51)" >&2
            exit 1
        }
    fi
done

kubectl delete namespace "${NS}" --timeout="${TIMEOUT}" >/dev/null 2>&1 || true
