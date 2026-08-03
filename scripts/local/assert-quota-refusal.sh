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
kubectl -n "${NS}" delete microvmreplicaset,microvm,microvmimage --all --timeout=180s >/dev/null 2>&1 || true
kubectl apply -f "${ROOT}/dist/workload-${TIER}.yaml" >/dev/null

echo "    waiting for the account ceiling to bind"

# What we are looking for is the estate stuck below its replica floor, with the
# operator or m80 naming a quota. Not a converged estate, and not a silent hang.
deadline=$((SECONDS + TIMEOUT))
saw_quota=""
ready=""
want="$(kubectl -n "${NS}" get microvmreplicaset -o jsonpath='{.items[0].spec.replicas}' 2>/dev/null)"
[ -z "${want}" ] && want=1

while [ "${SECONDS}" -lt "${deadline}" ]; do
    ready="$(kubectl -n "${NS}" get microvmreplicaset -o jsonpath='{.items[0].status.readyReplicas}' 2>/dev/null)"
    [ -z "${ready}" ] && ready=0
    logs="$(kubectl -n "${OPERATOR_NS}" logs deploy/kube-microvm-operator --tail=400 2>/dev/null)"
    case "${logs}" in
        *ServiceQuotaExceeded*|*"quota"*|*"Quota"*) saw_quota="operator log" ;;
    esac
    m80logs="$(kubectl -n "${OPERATOR_NS}" logs deploy/m80 --tail=200 2>/dev/null)"
    case "${m80logs}" in
        *"account memory ceiling reached"*) saw_quota="m80 log" ;;
    esac
    [ -n "${saw_quota}" ] && break
    sleep 10
done

echo ""
echo "    replica floor asked for ${want}, ready ${ready}"

if [ -n "${saw_quota}" ]; then
    echo "    the ceiling was named, in the ${saw_quota}"
    kubectl -n "${OPERATOR_NS}" logs deploy/m80 --tail=200 2>/dev/null |
        grep -i 'ceiling' | tail -3 | sed 's/^/        /'
    echo ""
    echo "==> the refusal is legible: something says quota, not just 'not ready'"
    exit 0
fi

echo ""
echo "    nothing named a quota within ${TIMEOUT}s." >&2
echo "" >&2
echo "    This is the finding, not a broken check: an estate that cannot fit" >&2
echo "    its account is failing silently, which is the expensive shape." >&2
echo "" >&2
kubectl -n "${NS}" get microvmimages,microvms,microvmreplicasets -o wide >&2 || true
kubectl -n "${OPERATOR_NS}" logs deploy/kube-microvm-operator --tail=60 >&2 || true
exit 1
