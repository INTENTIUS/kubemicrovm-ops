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
FLOCI_CONTAINER, FLOCI_PORT, M80_IMAGE, M80_PORT, M80_ENABLE_INJECTION,
CHART_VERSION, AWS_REGION, MAX_ACCOUNT_MEMORY_MIB, RECREATE_CLUSTER.

A cluster that is already up is reused. RECREATE_CLUSTER=1 rebuilds it from
nothing, which is what you want after changing m80's flags or when the estate
has got into a state not worth reasoning about.

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
# `floci`, not `floci-kmv`. behold detects the Floci substrate with
# `docker ps --filter name=^floci$`, anchored — so a suffixed name is reported
# as "not running" while it is running, and the substrate pill offers to boot a
# container that is already there. The suffix was this kit's invention and the
# bare name is the convention, so the kit moves. FLOCI_CONTAINER renames it if
# something else on the machine already owns `floci`.
FLOCI_CONTAINER="${FLOCI_CONTAINER:-floci}"
# Pinned rather than :latest, and v0.4.0 or newer is required: the args below
# pass -serve-sts and -enable-injection, and an m80 that does not know a flag
# exits rather than ignoring it — so an older tag does not degrade, it
# crashloops (m80#65 for the first flag, m80#74 for the second).
M80_IMAGE="${M80_IMAGE:-ghcr.io/intentius/m80:v0.4.0}"
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
# On, because a throwaway k3d cluster is exactly where that trade is worth
# making: nothing under /_m80/ is signed, which is why m80 leaves the flag off
# by default and is right to, and which matters not at all on a laptop cluster
# whose whole purpose is provoking failures.
#
# It was off until v0.4.0, because the flag existed on m80 main and in no
# published image (m80#74). Requires that release or newer.
#
# M80_ENABLE_INJECTION=0 declines it, and `just break-it` then says so.
M80_ENABLE_INJECTION="${M80_ENABLE_INJECTION:-1}"
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
if ! bash "$(dirname "$0")/prereqs.sh" --check; then
    echo "" >&2
    echo "  ./go              # offers to install these, asking first" >&2
    echo "  just prereqs      # the same check on its own" >&2
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
            echo "  docker container ${FLOCI_CONTAINER}" >&2
        fi
        echo "" >&2
        echo "  just local-down   # removes both" >&2
    fi
    exit "${status}"
}
trap on_failure EXIT

# floci is replaced on every run, and the cluster below is not. That asymmetry
# is the opposite of what it looks like it should be, so it is worth the words.
#
# The first cut of this reused both, reasoning that reusing one plane and
# replacing the other was incoherent. CI disagreed: the second run failed with
#
#   An error occurred (UnknownAction) when calling the GetTemplateSummary
#   operation: Action GetTemplateSummary is not supported.
#
# `aws cloudformation deploy` calls GetTemplateSummary to resolve parameters and
# capabilities, and floci does not implement it (#45). It works against a stack
# that does not exist and fails against one that does — so a *fresh* floci is
# what keeps the AWS plane on the create path.
#
# Recreating it is cheap and safe: every name the stack produces is
# deterministic, so the roles and bucket the operator references come back
# identical. The estate that matters — the cluster, the operator, the custom
# resources, and m80's in-memory state — survives, which is what behold's Bring
# up button was destroying.
echo "==> floci (the AWS plane) on :${FLOCI_PORT}"
docker rm -f "${FLOCI_CONTAINER}" >/dev/null 2>&1 || true
docker run -d --rm --name "${FLOCI_CONTAINER}" -p "${FLOCI_PORT}:4566" "${FLOCI_IMAGE}" >/dev/null
created_floci=1
for _ in $(seq 1 60); do
    if curl -sf "${AWS_ENDPOINT_URL}/_localstack/health" >/dev/null 2>&1; then break; fi
    sleep 1
done
curl -sf "${AWS_ENDPOINT_URL}/_localstack/health" >/dev/null || {
    echo "floci did not come up on ${AWS_ENDPOINT_URL}" >&2; exit 1
}

# Reuse a cluster that is already there, rather than deleting it.
#
# This used to open with `k3d cluster delete`, which made the script safe to
# re-run and unsafe to *call*. behold offers a substrate a "Bring up" button
# wired to exactly this path (behold src/substrates.ts), so clicking it while
# looking at a healthy estate tore the estate down and rebuilt it. behold's own
# k3d demo documents its local-up.sh as "idempotent — reuses one already up",
# which is the convention this was not following.
#
# Reuse is safe here because everything downstream is idempotent: helm upgrade
# --install for the operator, kubectl apply for the CRs. What is not idempotent
# is m80 — it is in-memory and reserves image names through the async delete
# window, so a *fresh* estate against a *stale* m80 answers "already exists".
# Reusing both together is consistent; reusing one is not. Since m80 lives in
# the cluster, keeping the cluster keeps them in step.
if k3d cluster list --no-headers 2>/dev/null | awk '{print $1}' | grep -qx "${CLUSTER}"; then
    if [ "${RECREATE_CLUSTER:-0}" = "1" ]; then
        echo "==> cluster ${CLUSTER} — rebuilding, RECREATE_CLUSTER=1"
        k3d cluster delete "${CLUSTER}" >/dev/null 2>&1 || true
        k3d cluster create "${CLUSTER}" --agents 1 --wait --timeout 300s >/dev/null
        created_cluster=1
    else
        echo "==> cluster ${CLUSTER} already up, reusing it"
        echo "    RECREATE_CLUSTER=1 to rebuild from nothing"
        kubectl config use-context "k3d-${CLUSTER}" >/dev/null 2>&1 || true
    fi
else
    echo "==> cluster ${CLUSTER}"
    k3d cluster create "${CLUSTER}" --agents 1 --wait --timeout 300s >/dev/null
    created_cluster=1
fi

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
