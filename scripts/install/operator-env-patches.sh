#!/usr/bin/env bash
# The two patches the chart cannot carry, plus the rollout wait — the tail of
# the old operator.sh, kept as a script because both patches are upstream
# workarounds with issue numbers, not install steps: KubeMicroVM#52 (the chart
# templates only the app.envs keys it knows, so credentials are dropped) and
# KubeMicroVM#50 (no STS endpoint override). Both go away when upstream lands
# them, and the whole script goes with them.
#
# Local target only in effect: AWS_ENDPOINT_URL_STS is exported by the local
# runner (it points at m80's STS shim); on the real target it is unset and
# this script is a rollout wait alone.
set -euo pipefail
NS="${NS:-kube-microvm}"

if [ -n "${AWS_ENDPOINT_URL_STS:-}" ]; then
    echo "==> the two patches the chart cannot carry (KubeMicroVM#50, #52)"
    kubectl -n "${NS}" set env deploy/kube-microvm-operator \
        AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}" \
        AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}" \
        AWS_EC2_METADATA_DISABLED=true \
        "AWS_ENDPOINT_URL_STS=${AWS_ENDPOINT_URL_STS}" >/dev/null
fi
kubectl -n "${NS}" rollout status deploy/kube-microvm-operator --timeout=300s
