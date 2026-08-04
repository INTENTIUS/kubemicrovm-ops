#!/usr/bin/env bash
# Stands the estate up against a real account's memory ceiling and checks the
# refusal is legible.
#
#   ./scripts/local/assert-quota-refusal.sh [prod|prod-ha]
#
# Every other run here raises m80's ceiling to 262144 MiB so the estate has
# room. That is the right default for everyday work and it hides the single
# most expensive surprise this kit can catch: `prod-ha` declares two VMs at
# 4096 MiB, and a fresh AWS account is capped at 4096 MiB across all running
# VMs. The second VM is refused with 402 ServiceQuotaExceededException.
#
# Finding that here costs five minutes. Finding it on AWS costs a support
# request and however long a quota increase takes, after you have already built
# everything else.
#
# What this asserts is not that the estate works — it cannot — but that the
# failure is one a reader can act on rather than a hang.
#
# Written for bash 3.2, which is what macOS ships.
set -uo pipefail
. "$(dirname "$0")/../lib-kube.sh"
# Local-target scripts know their own cluster. The install scripts under
# scripts/install/ deliberately do not default this: they are shared with the
# live target, where a k3d context would be the wrong cluster entirely.
KMV_KUBE_CONTEXT="${KMV_KUBE_CONTEXT:-k3d-${CLUSTER:-kubemicrovm-local}}"

TIER="${1:-prod-ha}"
case "${TIER}" in
    prod|prod-ha) ;;
    minimal) echo "minimal needs 2048 MiB and fits a default account; nothing to refuse" >&2; exit 2 ;;
    *) echo "unknown tier '${TIER}' (expected prod or prod-ha)" >&2; exit 2 ;;
esac

NS="${KMV_NAMESPACE:-microvm-demo}"
OPERATOR_NS="${NS_OPERATOR:-kube-microvm}"
CEILING="${ACCOUNT_CEILING_MIB:-4096}"
TIMEOUT="${TIMEOUT:-420}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
. "$(dirname "$0")/lib-estate.sh"

echo "==> the ${TIER} estate against a ${CEILING} MiB account ceiling"

# Re-arm m80 at the recorded ceiling rather than restarting the whole stack:
# the deployment's args are the only thing that has to change.
current="$(kubectl -n "${OPERATOR_NS}" get deploy/m80 \
    -o jsonpath='{.spec.template.spec.containers[0].args}' 2>/dev/null)"
if [ -z "${current}" ]; then
    echo "no m80 deployment in ${OPERATOR_NS} — stand the tier up first" >&2
    exit 1
fi

kubectl -n "${OPERATOR_NS}" patch deploy/m80 --type=json -p "$(cat <<PATCH
[{"op":"replace","path":"/spec/template/spec/containers/0/args","value":
  ["-addr",":${M80_PORT:-4290}","-build-delay","500ms",
   "-max-account-memory-mib","${CEILING}","-serve-sts"]}]
PATCH
)" >/dev/null || { echo "could not patch m80's ceiling" >&2; exit 1; }

kubectl -n "${OPERATOR_NS}" rollout status deploy/m80 --timeout=180s >/dev/null || {
    echo "m80 did not come back after the ceiling change" >&2; exit 1
}
echo "    m80 restarted at -max-account-memory-mib ${CEILING}"

# m80 is stateful per run and this restart emptied it, so the estate has to be
# rebuilt from nothing against the new ceiling.
#
# Every kind, and microvmnetwork is the one that matters: a MicroVMNetwork CR
# keeps status.connectorArn, and after the restart that ARN names a connector
# the fresh m80 has never heard of. The operator then loops on
# ResourceNotFoundException and the estate never gets as far as running a VM —
# so the replica floor sits at 0 for a reason that has nothing to do with
# memory, and this check reads it as "the quota refusal was not legible". It
# did exactly that, and the finding was wrong.
kubectl -n "${NS}" delete microvmreplicaset,microvm,microvmimage,microvmnetwork,microvmclass \
    --all --timeout=180s >/dev/null 2>&1 || true
kubectl apply -f "${ROOT}/dist/workload-${TIER}.yaml" >/dev/null

# The connector has to come back before anything can be concluded about memory.
# Without this the check cannot tell "the quota bound silently" apart from
# "something else broke first", and those want opposite responses.
echo "    waiting for the connector, which has to work before memory can bind"
conn_deadline=$((SECONDS + 240))
conn_ok=""
while [ "${SECONDS}" -lt "${conn_deadline}" ]; do
    case "$(kubectl -n "${NS}" get microvmnetwork -o jsonpath='{.items[*].status.connectorState}' 2>/dev/null)" in
        *ACTIVE*) conn_ok=1; break ;;
    esac
    sleep 5
done
if [ -z "${conn_ok}" ]; then
    echo "" >&2
    echo "    the connector never came back, so nothing can be said about the quota." >&2
    echo "    This is a broken precondition, not a finding about memory." >&2
    kubectl -n "${NS}" get microvmnetwork -o jsonpath='{range .items[*]}{.metadata.name}: {.status}{"\n"}{end}' >&2 2>/dev/null || true
    kubectl -n "${OPERATOR_NS}" logs deploy/kube-microvm-operator --tail=30 >&2 2>/dev/null || true
    exit 1
fi
echo "    connector ACTIVE"

echo "    waiting for the account ceiling to bind"

# What we are looking for is the estate stuck below its replica floor, with the
# operator or m80 naming a quota. Not a converged estate, and not a silent hang.
deadline=$((SECONDS + TIMEOUT))
saw_quota=""
ready=""
want="$(estate_vm_count "${NS}")"

# Both patterns are exact strings that only a real refusal produces.
#
# An earlier version also accepted a bare "quota" or "Quota" anywhere in the
# operator's log, and passed on it. That is not evidence: the operator ships a
# QuotaDiscovery component whose class name alone satisfies the match, and it
# logs at startup whether or not anything was ever refused. A check that cannot
# fail is not a check, and this one is asserting the exact property — that the
# refusal is *legible* — which a substring of a class name does not establish.
OPERATOR_PATTERN='ServiceQuotaExceeded'
M80_PATTERN='account memory ceiling reached'

while [ "${SECONDS}" -lt "${deadline}" ]; do
    ready="$(kubectl -n "${NS}" get microvmreplicaset -o jsonpath='{.items[0].status.readyReplicas}' 2>/dev/null)"
    [ -z "${ready}" ] && ready=0

    evidence="$(kubectl -n "${OPERATOR_NS}" logs deploy/kube-microvm-operator --tail=400 2>/dev/null |
        grep -m1 "${OPERATOR_PATTERN}")"
    if [ -n "${evidence}" ]; then saw_quota="the operator's log"; break; fi

    evidence="$(kubectl -n "${OPERATOR_NS}" logs deploy/m80 --tail=400 2>/dev/null |
        grep -m1 "${M80_PATTERN}")"
    if [ -n "${evidence}" ]; then saw_quota="m80's log"; break; fi

    sleep 10
done

echo ""
echo "    replica floor asked for ${want}, ready ${ready}"

if [ -n "${saw_quota}" ]; then
    echo "    the ceiling was named, in ${saw_quota}:"
    printf '        %s\n' "${evidence}"
    echo ""
    echo "==> the refusal is legible: something names the quota, not just 'not ready'"
    exit 0
fi

echo ""
echo "    nothing named a quota within ${TIMEOUT}s." >&2
echo "" >&2
echo "    Looked for '${OPERATOR_PATTERN}' in the operator's log and" >&2
echo "    '${M80_PATTERN}' in m80's, and found neither." >&2
echo "" >&2
echo "    This is the finding, not a broken check: an estate that cannot fit" >&2
echo "    its account is failing silently, which is the expensive shape — and" >&2
echo "    silence is what an adopter would get on a real account too." >&2
echo "" >&2
echo "  what m80 said about memory:" >&2
kubectl -n "${OPERATOR_NS}" logs deploy/m80 --tail=400 2>/dev/null |
    grep -iE 'memory|ceiling|quota|reject' | tail -10 | sed 's/^/    /' >&2 || true
echo "" >&2
kubectl -n "${NS}" get microvmimages,microvms,microvmreplicasets -o wide >&2 || true
kubectl -n "${OPERATOR_NS}" logs deploy/kube-microvm-operator --tail=60 >&2 || true
exit 1
