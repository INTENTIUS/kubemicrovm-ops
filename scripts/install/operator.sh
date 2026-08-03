#!/usr/bin/env bash
# Installs the KubeMicroVM operator: cert-manager, the pinned CRDs, the chart,
# and the two env patches the chart cannot carry.
#
# Split out of local-up.sh so the install Op owns the ordering and this owns
# the invocations. Idempotent — safe against a cluster that already has any
# part of it.
set -euo pipefail

# Pinned by the chart, not chosen here: every template in
# kube-microvm-operator 1.0.11 hardcodes `namespace: kube-microvm` and ignores
# helm's -n, so installing anywhere else fails naming a namespace nobody asked
# for.
NS="${NS:-kube-microvm}"
CHART_VERSION="${CHART_VERSION:-1.0.11}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

echo "==> cert-manager"
# The operator's webhooks will not start without it. Upstream expects a cluster
# to have it already, which an EKS cluster usually does and k3d never does.
if ! helm status cert-manager -n cert-manager >/dev/null 2>&1; then
    helm repo add jetstack https://charts.jetstack.io >/dev/null 2>&1 || true
    helm repo update >/dev/null
    helm install cert-manager jetstack/cert-manager \
        --namespace cert-manager --create-namespace --set crds.enabled=true \
        --wait --timeout 6m >/dev/null
fi

echo "==> CRDs, pinned to chart ${CHART_VERSION}"
# Before the chart, so a custom resource applies whether or not the chart's own
# CRD install has run.
kubectl apply -f "${ROOT}/crds" >/dev/null

echo "==> operator ${CHART_VERSION}"
kubectl create namespace "${NS}" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
HELM_ARGS=(--set "app.envs.AWS_REGION=${AWS_REGION}")
if [ -n "${AWS_MICROVM_ENDPOINT:-}" ]; then
    HELM_ARGS+=(--set "app.envs.AWS_MICROVM_ENDPOINT=${AWS_MICROVM_ENDPOINT}")
fi
helm upgrade --install kube-microvm-operator \
    "oci://ghcr.io/codriverlabs/helm/kube-microvm-operator" --version "${CHART_VERSION}" \
    -n "${NS}" "${HELM_ARGS[@]}" --wait --timeout 6m >/dev/null

# The chart templates only the app.envs keys it knows, so credentials and the
# STS override have to be patched in after the release. Both go away when the
# upstream issues land: KubeMicroVM#52 for the dropped keys, #50 for the
# missing STS override.
if [ -n "${AWS_ENDPOINT_URL_STS:-}" ]; then
    echo "==> the two patches the chart cannot carry (KubeMicroVM#50, #52)"
    kubectl -n "${NS}" set env deploy/kube-microvm-operator \
        AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}" \
        AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}" \
        AWS_EC2_METADATA_DISABLED=true \
        "AWS_ENDPOINT_URL_STS=${AWS_ENDPOINT_URL_STS}" >/dev/null
fi
kubectl -n "${NS}" rollout status deploy/kube-microvm-operator --timeout=300s
