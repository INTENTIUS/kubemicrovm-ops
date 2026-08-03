#!/usr/bin/env bash
# Checks each piece of the local target in the order they depend on each other,
# and says what to run next about whichever one is wrong.
#
#   ./scripts/local/doctor.sh
#
# This answers "why is nothing happening", which is a different question from
# "did the estate converge" — that one is assert-converged.sh. Doctor does not
# wait for anything and does not care which tier is deployed; it reports what is
# true right now.
#
# Written for bash 3.2, which is what macOS ships: no associative arrays.
set -uo pipefail

CLUSTER="${CLUSTER:-kubemicrovm-local}"
NS="${NS:-kube-microvm}"
KMV_NAMESPACE="${KMV_NAMESPACE:-microvm-demo}"
FLOCI_PORT="${FLOCI_PORT:-4566}"
M80_PORT="${M80_PORT:-4290}"
FAILED=0

ok()   { printf '  ok    %s\n' "$1"; }
info() { printf '        %s\n' "$1"; }
bad()  { printf '  FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
next() { printf '        next: %s\n' "$1"; }

echo "==> the local target"

# ── floci ────────────────────────────────────────────────────────────────
# Published on the host, so this one is a plain curl.
if curl -sf "http://localhost:${FLOCI_PORT}/_localstack/health" >/dev/null 2>&1; then
    ok "floci answering on :${FLOCI_PORT}"
else
    bad "floci not answering on :${FLOCI_PORT}"
    if docker ps -a --filter "name=^${FLOCI_CONTAINER:-floci}$" --format '{{.Status}}' 2>/dev/null | grep -q .; then
        next "docker logs ${FLOCI_CONTAINER:-floci}"
    else
        next "just minimal-local-e2e    # nothing is up yet"
    fi
fi

# ── cluster ──────────────────────────────────────────────────────────────
if kubectl config get-contexts "k3d-${CLUSTER}" >/dev/null 2>&1 &&
   kubectl --context "k3d-${CLUSTER}" get nodes >/dev/null 2>&1; then
    ok "cluster ${CLUSTER} reachable"
else
    bad "cluster ${CLUSTER} not reachable"
    next "just minimal-local-e2e    # nothing below this can be checked"
    echo
    echo "${FAILED} check(s) failed."
    exit 1
fi

# ── m80 ──────────────────────────────────────────────────────────────────
# The image tag is worth printing whether or not m80 is healthy: an image
# predating a flag the harness passes exits at startup, and the tag is the
# only place that says so.
m80_image="$(kubectl -n "${NS}" get deploy/m80 \
    -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null)"
m80_ready="$(kubectl -n "${NS}" get deploy/m80 \
    -o jsonpath='{.status.readyReplicas}' 2>/dev/null)"

if [ -z "${m80_image}" ]; then
    bad "m80 is not deployed in namespace ${NS}"
    next "just minimal-local-e2e"
elif [ "${m80_ready:-0}" -lt 1 ] 2>/dev/null; then
    bad "m80 deployed from ${m80_image} but no replica is ready"
    next "kubectl -n ${NS} logs deploy/m80 --tail=20"
else
    ok "m80 ready, from ${m80_image}"

    # m80 is a ClusterIP service and a distroless image with no shell, so
    # reaching its health endpoint from here means a port-forward rather than
    # an exec. Worth it: the payload carries the version, which is what tells
    # a stale image apart from a broken one.
    pf_port=14290
    kubectl -n "${NS}" port-forward "deploy/m80" "${pf_port}:${M80_PORT}" >/dev/null 2>&1 &
    pf_pid=$!
    health=""
    for _ in 1 2 3 4 5 6 7 8 9 10; do
        health="$(curl -sf "http://localhost:${pf_port}/_m80/health" 2>/dev/null)" && break
        sleep 0.5
    done
    kill "${pf_pid}" >/dev/null 2>&1 || true
    wait "${pf_pid}" 2>/dev/null || true

    if [ -n "${health}" ]; then
        if command -v jq >/dev/null 2>&1; then
            info "m80 $(printf '%s' "${health}" | jq -r '.version'), $(printf '%s' "${health}" | jq -r '.coverage.implemented')/$(printf '%s' "${health}" | jq -r '.coverage.total') operations"
        else
            ok "m80 health endpoint answering"
        fi
    else
        bad "m80 is ready but its health endpoint did not answer"
        next "kubectl -n ${NS} port-forward deploy/m80 ${M80_PORT}:${M80_PORT}"
    fi
fi

# ── operator ─────────────────────────────────────────────────────────────
op_ready="$(kubectl -n "${NS}" get deploy/kube-microvm-operator \
    -o jsonpath='{.status.readyReplicas}' 2>/dev/null)"

if [ -z "${op_ready}" ]; then
    bad "the operator is not deployed in namespace ${NS}"
    next "just install    # the install Op, against a cluster that already exists"
elif [ "${op_ready}" -lt 1 ] 2>/dev/null; then
    bad "the operator is deployed but not ready"
    info "readiness gates on sts:GetCallerIdentity, which m80 answers"
    next "kubectl -n ${NS} logs deploy/kube-microvm-operator --tail=40"
else
    ok "operator ready"
    # The line local-up.sh calls the thing worth reading. It is the proof that
    # the operator reached the emulator rather than merely started.
    conn="$(kubectl -n "${NS}" logs deploy/kube-microvm-operator --tail=400 2>/dev/null |
        grep -m1 'AWS connectivity confirmed')"
    if [ -n "${conn}" ]; then
        info "${conn}"
    else
        bad "the operator has not confirmed AWS connectivity"
        next "kubectl -n ${NS} logs deploy/kube-microvm-operator --tail=40"
    fi
fi

# ── estate ───────────────────────────────────────────────────────────────
# None of KubeMicroVM's five CRDs declares additionalPrinterColumns, so a plain
# `kubectl get microvm` prints NAME and AGE and nothing else — the state, which
# is the only thing anyone is looking for, is not in the default output. Each
# kind is asked for its own status field by name instead.
estate="$(kubectl -n "${KMV_NAMESPACE}" get microvmimages,microvms,microvmreplicasets,microvmnetworks \
    --no-headers 2>/dev/null)"
if [ -n "${estate}" ]; then
    ok "estate in ${KMV_NAMESPACE}: $(printf '%s\n' "${estate}" | grep -c .) resource(s)"
    # kind:status-field pairs, matching what assert-converged.sh waits on.
    for pair in microvmimage:latestVersionState microvm:state \
                microvmnetwork:connectorState microvmreplicaset:readyReplicas; do
        kind="${pair%%:*}"
        field="${pair##*:}"
        kubectl -n "${KMV_NAMESPACE}" get "${kind}" \
            -o "custom-columns=NAME:.metadata.name,$(printf '%s' "${field}" |
                tr '[:lower:]' '[:upper:]'):.status.${field}" \
            --no-headers 2>/dev/null |
            grep -v '^$' |
            sed "s/^/        ${kind}  /" || true
    done
else
    bad "no custom resources in namespace ${KMV_NAMESPACE}"
    next "just minimal-local-e2e    # or KMV_TIER=prod-ha just install"
fi

echo
if [ "${FAILED}" -eq 0 ]; then
    echo "everything the local target needs is up."
    echo "  just validate    # and whether the estate actually converged"
    exit 0
fi
echo "${FAILED} check(s) failed."
exit 1
