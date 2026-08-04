#!/usr/bin/env bash
# Removes the operator chart and its namespace. Leaves cert-manager: it is a
# cluster-wide dependency this kit did not necessarily install, and removing
# something another workload may rely on is not teardown, it is damage.
set -euo pipefail
. "$(dirname "$0")/../lib-kube.sh"

NS="${NS:-kube-microvm}"

if helm status kube-microvm-operator -n "${NS}" >/dev/null 2>&1; then
    echo "==> operator chart"
    helm uninstall kube-microvm-operator -n "${NS}" --wait --timeout 5m >/dev/null
fi
kubectl delete namespace "${NS}" --timeout=180s >/dev/null 2>&1 || true

# The CRDs go last and only if nothing else is using them: deleting a CRD
# deletes every custom resource of that kind, cluster-wide, including any in a
# namespace this kit never touched.
if kubectl get microvms --all-namespaces -o name 2>/dev/null | grep -q .; then
    echo "==> leaving the CRDs: MicroVM resources exist outside this kit's namespace"
else
    kubectl delete -f "$(cd "$(dirname "$0")/../.." && pwd)/crds" --ignore-not-found >/dev/null 2>&1 || true
fi
