#!/usr/bin/env bash
# Brings the local target up from nothing: floci for the AWS plane, m80 for the
# MicroVMs API, a k3d cluster running the real KubeMicroVM operator, and this
# kit's estate at the tier you ask for. No AWS account, no cost.
#
# The Kubernetes half is not emulated. It is a real cluster running the real
# operator, reconciling real custom resources. Only the AWS side is stood in for.
set -euo pipefail

usage() {
    sed -n '2,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//;$d'
    cat <<'USAGE'

  ./scripts/local/local-up.sh [minimal|prod|prod-ha]

Overridable by environment variable: CLUSTER, NS, KMV_NAMESPACE, FLOCI_IMAGE,
FLOCI_PORT, M80_IMAGE, M80_PORT, CHART_VERSION, AWS_REGION,
MAX_ACCOUNT_MEMORY_MIB.

Needs docker, k3d, kubectl, helm, the AWS CLI, node and npm. All of them are
checked before anything is started. Uses no AWS account.
USAGE
}

TIER="${1:-${KMV_TIER:-minimal}}"
case "${TIER}" in
    -h|--help) usage; exit 0 ;;
    minimal|prod|prod-ha) ;;
    *) echo "unknown tier '${TIER}' (expected minimal, prod or prod-ha)" >&2; usage >&2; exit 2 ;;
esac

CLUSTER="${CLUSTER:-kubemicrovm-local}"
NS="${NS:-kube-microvm}"
KMV_NAMESPACE="${KMV_NAMESPACE:-microvm-demo}"
# Stock floci/floci:latest is enough for what the AWS plane declares today —
# an S3 bucket, a bucket policy, two IAM roles and three managed policies all
# create cleanly on it, verified 2026-08-02. Point this at a build of
# lex00/floci if the estate grows anything CloudFormation mishandles upstream;
# security group rules and tags are dropped there, and that fork fixes them.
FLOCI_IMAGE="${FLOCI_IMAGE:-floci/floci:latest}"
FLOCI_PORT="${FLOCI_PORT:-4566}"
# Pinned rather than :latest, and v0.3.0 or newer is required: the args below
# pass -serve-sts, which v0.2.0's binary rejects outright, so an older tag does
# not degrade — it crashloops (m80#65).
M80_IMAGE="${M80_IMAGE:-ghcr.io/intentius/m80:v0.3.0}"
M80_PORT="${M80_PORT:-4290}"
CHART_VERSION="${CHART_VERSION:-1.0.11}"
AWS_REGION="${AWS_REGION:-us-east-1}"
# m80 defaults to the account memory ceiling a fresh AWS account has: 4096 MiB.
# A prod-ha deployment at 4096 MiB per VM is two VMs and nothing left over, so
# the harness raises it the way a real account used for this would have been.
MAX_ACCOUNT_MEMORY_MIB="${MAX_ACCOUNT_MEMORY_MIB:-262144}"
# m80's failure-injection levers, which is how a failed image build or a
# connector failure code can be caused on purpose (`just break-it`).
#
# Off by default, and not because the levers are risky here — a throwaway k3d
# cluster is exactly where that trade is worth making. Off because
# -enable-injection does not exist in any published m80 image: it landed on
# m80 main in m80#66, seven hours after v0.3.0 was tagged. An unknown flag is
# not ignored, so turning this on against the default image does not lose the
# levers, it crashloops the emulator and takes the whole stand-up with it.
#
# Turn it on with an image that has the flag, which today means a build of
# m80 main:
#
#   docker build -t m80:main ~/checkouts/m80
#   M80_IMAGE=m80:main M80_ENABLE_INJECTION=1 just prod-ha-local-e2e
#
# The default flips back to 1 when a release carries it (m80#74).
M80_ENABLE_INJECTION="${M80_ENABLE_INJECTION:-0}"
if [ "${M80_ENABLE_INJECTION}" = "1" ]; then
    INJECT_ARG=', "-enable-injection"'
else
    INJECT_ARG=""
fi

STACK_NAME="${STACK_NAME:-kubemicrovm-ops-aws-plane}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

export AWS_ENDPOINT_URL="http://localhost:${FLOCI_PORT}"
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_REGION
export KMV_TIER="${TIER}"

# Everything this needs, checked before anything is started. All of them at
# once rather than the first one missing, so a reader installs once instead of
# discovering the list an error at a time. node and npm were never in the
# documented prerequisites and the install Op is `npx chant run`, so a machine
# with docker and k3d and nothing else got past every stated requirement and
# failed in phase one.
missing=""
for cmd in docker k3d kubectl helm aws node npm; do
    command -v "${cmd}" >/dev/null 2>&1 || missing="${missing} ${cmd}"
done
if [ -n "${missing}" ]; then
    echo "missing:${missing}" >&2
    echo "" >&2
    echo "The local target needs docker, k3d, kubectl, helm, the AWS CLI, node and npm." >&2
    exit 1
fi
# Installed and not running is the common case on macOS, and it is a different
# message than the binary being absent.
if ! docker info >/dev/null 2>&1; then
    echo "docker is installed but not responding — is the daemon running?" >&2
    exit 1
fi

# From here on things exist that did not before. On any failure, say what is
# still running rather than leaving a cluster and a container behind silently.
created_floci=0
created_cluster=0
on_failure() {
    status=$?
    if [ "${status}" -ne 0 ] &&
       { [ "${created_floci}" -eq 1 ] || [ "${created_cluster}" -eq 1 ]; }; then
        echo "" >&2
        echo "this left running:" >&2
        if [ "${created_cluster}" -eq 1 ]; then
            echo "  k3d cluster ${CLUSTER}" >&2
        fi
        if [ "${created_floci}" -eq 1 ]; then
            echo "  docker container floci-kmv" >&2
        fi
        echo "" >&2
        echo "  just local-down   # removes both" >&2
    fi
    exit "${status}"
}
trap on_failure EXIT

echo "==> floci (the AWS plane) on :${FLOCI_PORT}"
docker rm -f floci-kmv >/dev/null 2>&1 || true
docker run -d --rm --name floci-kmv -p "${FLOCI_PORT}:4566" "${FLOCI_IMAGE}" >/dev/null
created_floci=1
for _ in $(seq 1 60); do
    if curl -sf "${AWS_ENDPOINT_URL}/_localstack/health" >/dev/null 2>&1; then break; fi
    sleep 1
done
curl -sf "${AWS_ENDPOINT_URL}/_localstack/health" >/dev/null || {
    echo "floci did not come up on ${AWS_ENDPOINT_URL}" >&2; exit 1
}

echo "==> cluster ${CLUSTER}"
k3d cluster delete "${CLUSTER}" >/dev/null 2>&1 || true
k3d cluster create "${CLUSTER}" --agents 1 --wait --timeout 300s >/dev/null
created_cluster=1

# A locally built image is in no registry, so k3d cannot pull it. Importing is
# what lets a contributor point the harness at their own build:
#   M80_IMAGE=m80:candidate ./scripts/local/local-up.sh
if docker image inspect "${M80_IMAGE}" >/dev/null 2>&1; then
    echo "==> importing local image ${M80_IMAGE}"
    k3d image import "${M80_IMAGE}" -c "${CLUSTER}" >/dev/null
fi

kubectl create namespace "${NS}" --dry-run=client -o yaml | kubectl apply -f - >/dev/null

echo "==> m80 (the MicroVMs API, and the sts:GetCallerIdentity the operator gates on)"
kubectl apply -f - >/dev/null <<YAML
apiVersion: apps/v1
kind: Deployment
metadata: { name: m80, namespace: ${NS} }
spec:
  replicas: 1
  selector: { matchLabels: { app: m80 } }
  template:
    metadata: { labels: { app: m80 } }
    spec:
      containers:
        - name: m80
          image: ${M80_IMAGE}
          args: ["-addr", ":${M80_PORT}", "-build-delay", "500ms", "-max-account-memory-mib", "${MAX_ACCOUNT_MEMORY_MIB}", "-serve-sts"${INJECT_ARG}]
          ports: [{ containerPort: ${M80_PORT} }]
          readinessProbe:
            httpGet: { path: /_m80/health, port: ${M80_PORT} }
            initialDelaySeconds: 2
---
apiVersion: v1
kind: Service
metadata: { name: m80, namespace: ${NS} }
spec:
  selector: { app: m80 }
  ports: [{ port: ${M80_PORT}, targetPort: ${M80_PORT} }]
YAML
# On failure this is a five minute wait followed by one line about a deadline,
# which says nothing about the emulator having exited on an argument it did not
# recognise. m80's own logs say exactly that, so print them.
if ! kubectl -n "${NS}" rollout status deploy/m80 --timeout=300s; then
    echo "" >&2
    echo "m80 did not become ready. Its last output:" >&2
    kubectl -n "${NS}" logs deploy/m80 --tail=20 --all-containers --ignore-errors >&2 || true
    kubectl -n "${NS}" get pods -l app=m80 -o wide >&2 || true
    echo "" >&2
    echo "M80_IMAGE is ${M80_IMAGE}. The harness passes -serve-sts, which needs" >&2
    echo "v0.3.0 or newer; older tags exit rather than ignore it." >&2
    exit 1
fi

# From here the install Op owns the ordering — AWS plane, operator, estate,
# converge. This script's job was the substrate underneath it: floci, k3d and
# m80 are the local target's own lifecycle and nothing an adopter on EKS has.
#
# So what CI proves and what an adopter runs are the same four phases, reached
# by different routes.
export AWS_MICROVM_ENDPOINT="http://m80.${NS}.svc.cluster.local:${M80_PORT}"
export AWS_ENDPOINT_URL_STS="${AWS_MICROVM_ENDPOINT}"

echo "==> install Op"
(cd "${ROOT}" && npx chant run kubemicrovm-install)

echo
echo "local target up at tier ${TIER}."
health="$(kubectl -n "${NS}" logs deploy/kube-microvm-operator --tail=200 2>/dev/null || true)"
if line="$(printf '%s\n' "${health}" | grep -m1 'AWS connectivity confirmed')"; then
    echo "  operator: ${line}"
else
    echo "  the operator has not confirmed connectivity yet."
    echo "  kubectl -n ${NS} logs deploy/kube-microvm-operator"
    exit 1
fi
echo
echo "  kubectl -n ${KMV_NAMESPACE} get microvms,microvmimages,microvmreplicasets"
echo "  just validate      # whether the estate converged, not just applied"
echo "  just doctor        # what state each piece is in"
# Only suggested when it would work. Printing a command that fails for most
# readers costs more than printing nothing, and this one fails for anyone who
# followed the quick start, which never clones behold.
if [ -d "${BEHOLD_DIR:-../behold}" ]; then
    echo "  just view          # the estate across both substrates"
fi
echo
echo "  Local validates that the estate declares and reconciles. It does not"
echo "  validate that AWS will accept the roles at runtime: nothing fetches"
echo "  your artifact and nothing runs it."
