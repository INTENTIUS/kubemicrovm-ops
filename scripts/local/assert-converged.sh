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
. "$(dirname "$0")/../lib-kube.sh"
# Local-target scripts know their own cluster. The install scripts under
# scripts/install/ deliberately do not default this: they are shared with the
# live target, where a k3d context would be the wrong cluster entirely.
# The k3d default is a LOCAL-target assumption; on the real target the
# ambient context (the one cluster-kubeconfig.sh set) is the cluster, and
# forcing k3d here made every real-target read fail with "context does not
# exist" (first real converge).
if [ -n "${AWS_ENDPOINT_URL:-}" ]; then
    KMV_KUBE_CONTEXT="${KMV_KUBE_CONTEXT:-k3d-${CLUSTER:-kubemicrovm-local}}"
fi

TIER="${1:-${KMV_TIER:-minimal}}"
NS="${KMV_NAMESPACE:-microvm-demo}"
OPERATOR_NS="${NS_OPERATOR:-kube-microvm}"
# 600s fits the local target, where m80 collapses the image build to 500ms.
# The real service builds an image in ~45 minutes, so the real-target default
# has to outlast it — override with TIMEOUT either way.
if [ -n "${AWS_ENDPOINT_URL:-}" ]; then
    TIMEOUT="${TIMEOUT:-600}"
else
    TIMEOUT="${TIMEOUT:-3600}"
fi

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
#
# The optional fourth argument names states that waiting cannot fix. An image
# whose build reports CREATE_FAILED at minute two will still report it at
# minute sixty — the real-target timeout is an hour to outlast a real build,
# and spending the other fifty-eight minutes on a verdict already in hand just
# delays the log you need. Terminal states exit now, with the state named.
wait_for() {
    local what="$1" query="$2" want="$3" dead="${4:-}" deadline=$((SECONDS + TIMEOUT)) got
    while [ "${SECONDS}" -lt "${deadline}" ]; do
        got="$(kubectl -n "${NS}" get ${query} 2>/dev/null || true)"
        if grep -qE "${want}" <<< "${got}"; then
            echo "    ${what}: ok"
            return 0
        fi
        if [ -n "${dead}" ] && grep -qE "${dead}" <<< "${got}"; then
            fail "${what} reached a terminal state: $(echo ${got})"
        fi
        sleep 5
    done
    fail "${what} never reached ${want} within ${TIMEOUT}s"
}

# Every MicroVM's state, one per line. Empty when none are declared.
vm_states() {
    kubectl -n "${NS}" get microvm -o jsonpath='{range .items[*]}{.status.state}{"\n"}{end}' 2>/dev/null |
        grep -v '^$' || true
}

count_state() { vm_states | grep -cx "$1" || true; }

# A VM the operator suspended is a converged VM, and the whole reason this
# needs saying is that `readyReplicas` cannot tell you so.
#
# The production tiers declare `maxIdleDurationSeconds: 900` with
# `autoResumeEnabled: true`, so an estate nobody touches for fifteen minutes
# has its VMs suspended by the operator doing exactly what the tier asked. The
# floor then reads 0 and this script used to wait ten minutes and call a
# healthy estate broken (#52) — the failure most likely to be seen by somebody
# else, because it is what happens if you stand the estate up and then talk for
# a quarter of an hour.
#
# docs/lifecycle.md already draws the line: an auto-suspended VM is a status
# difference, not spec drift, and triggers nothing. This was the one place in
# the kit that did not honour it.
#
# Accepting `Suspended` costs a fresh run nothing. Suspension takes 900s of
# idle and TIMEOUT is 600s, so nothing on a stand-up can reach that state
# inside the window — CI still waits for VMs that genuinely come up Running.
# What it must not accept is `Pending`, `Failed` or a VM that is simply absent,
# so the floor is counted rather than assumed.
wait_for_floor() {
    local want="$1" deadline=$((SECONDS + TIMEOUT)) ready suspended running total failed
    while [ "${SECONDS}" -lt "${deadline}" ]; do
        ready="$(kubectl -n "${NS}" get microvmreplicaset -o jsonpath='{.items[0].status.readyReplicas}' 2>/dev/null || true)"
        [ -z "${ready}" ] && ready=0
        if [ "${ready}" -ge "${want}" ] 2>/dev/null; then
            echo "    the replica floor (${want}): ok"
            return 0
        fi
        running="$(count_state Running)"
        suspended="$(count_state Suspended)"
        total="$(vm_states | grep -c . || true)"
        # Every VM accounted for, enough of them, and none in a state that is
        # neither of the two the operator moves a healthy VM between.
        if [ "$((running + suspended))" -ge "${want}" ] && [ "$((running + suspended))" -eq "${total}" ]; then
            echo "    the replica floor (${want}): ok — ${running} running, ${suspended} suspended by the idle policy"
            echo "      readyReplicas is ${ready}: a suspended VM is not a ready one. Traffic auto-resumes it."
            return 0
        fi
        # Failed is terminal for a MicroVM: the operator does not retry it into
        # Running, so a floor short by a Failed VM stays short. Same reasoning
        # as wait_for's terminal states — exit with the verdict, not the clock.
        failed="$(count_state Failed)"
        if [ "${failed}" -gt 0 ]; then
            fail "the replica floor cannot fill: ${failed} VM(s) in terminal state Failed"
        fi
        sleep 5
    done
    fail "the replica floor (${want}) never filled within ${TIMEOUT}s"
}

echo "==> waiting for the ${TIER} estate to converge"

wait_for "image build" \
    "microvmimage -o jsonpath={.items[*].status.latestVersionState}" \
    "SUCCESSFUL" \
    "FAILED"

if [ "${TIER}" = "minimal" ]; then
    # `Suspended` for the same reason as the floor below — though `minimal`
    # declares no class, so it takes the service defaults and is far less
    # likely to get there.
    wait_for "the MicroVM" \
        "microvm -o jsonpath={.items[*].status.state}" \
        "Running|Suspended" \
        "Failed"
else
    wait_for "the network connector" \
        "microvmnetwork -o jsonpath={.items[*].status.connectorState}" \
        "ACTIVE" \
        "FAILED"

    # The floor, not just a replica: the tier asked for a number and the whole
    # point of prod-ha is that the number is two.
    want_replicas="$(kubectl -n "${NS}" get microvmreplicaset -o jsonpath='{.items[0].spec.replicas}')"
    wait_for_floor "${want_replicas}"
fi

echo "    the ${TIER} estate converged"

# Converged is not the same as deployable. The local target raises m80's
# account memory ceiling far above what a real account has, so an estate that
# converges here can still be refused on AWS for quota — and that refusal costs
# a support request and a wait, which is exactly the class of surprise this kit
# exists to move to a laptop. Warns, never fails: an account already raised is
# an ordinary thing to be deploying into and nothing here can tell.
bash "$(dirname "$0")/account-fit.sh" || true
