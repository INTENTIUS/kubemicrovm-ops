#!/usr/bin/env bash
# Causes failures on purpose and checks the estate reports them.
#
#   ./scripts/local/assert-failure-paths.sh [minimal|prod|prod-ha]
#
# Everything else here tests success. The estate applies, the operator
# reconciles, the image reaches SUCCESSFUL and the VM reaches Running. What the
# kit does when a build fails or a connector cannot be created was untested,
# and until m80#56 gave the injection levers an HTTP surface it was untestable
# from outside the emulator's own process.
#
# Against real AWS you cannot ask EC2 to run a subnet out of addresses. Against
# m80 you can, on demand, which is most of the argument for having an emulator
# in the loop at all.
#
# Needs m80 started with -enable-injection; local-up.sh does that by default.
# Written for bash 3.2, which is what macOS ships.
set -uo pipefail
. "$(dirname "$0")/../lib-kube.sh"
# Local-target scripts know their own cluster. The install scripts under
# scripts/install/ deliberately do not default this: they are shared with the
# live target, where a k3d context would be the wrong cluster entirely.
KMV_KUBE_CONTEXT="${KMV_KUBE_CONTEXT:-k3d-${CLUSTER:-kubemicrovm-local}}"

TIER="${1:-${KMV_TIER:-minimal}}"
case "${TIER}" in
    minimal|prod|prod-ha) ;;
    *) echo "unknown tier '${TIER}' (expected minimal, prod or prod-ha)" >&2; exit 2 ;;
esac

NS="${KMV_NAMESPACE:-microvm-demo}"
OPERATOR_NS="${NS_OPERATOR:-kube-microvm}"
M80_PORT="${M80_PORT:-4290}"
PF_PORT="${PF_PORT:-14291}"
TIMEOUT="${TIMEOUT:-300}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MANIFEST="${ROOT}/dist/workload-${TIER}.yaml"
. "$(dirname "$0")/lib-estate.sh"

fail() {
    echo "" >&2
    echo "failure-path check failed at tier ${TIER}: $1" >&2
    echo "" >&2
    kubectl -n "${NS}" get microvmimages,microvms,microvmnetworks -o wide >&2 || true
    # -o wide shows NAME and AGE and nothing else, since none of these CRDs
    # declares printer columns. The status blocks are the whole point of
    # looking, so print them rather than a table that cannot carry them.
    echo "" >&2
    echo "status blocks:" >&2
    for kind in microvmimage microvmnetwork microvmreplicaset; do
        kubectl -n "${NS}" get "${kind}" \
            -o "jsonpath={range .items[*]}${kind}/{.metadata.name}: {.status}{\"\n\"}{end}" 2>/dev/null >&2 || true
    done
    echo "" >&2
    kubectl -n "${OPERATOR_NS}" logs deploy/kube-microvm-operator --tail=60 >&2 || true
    exit 1
}

[ -f "${MANIFEST}" ] || fail "no built manifest at ${MANIFEST} — run the tier once first"

# ── reach m80 ────────────────────────────────────────────────────────────
# Same port-forward doctor.sh uses, and for the same reason: m80 is a ClusterIP
# service on a distroless image, so there is nothing to exec into.
kubectl -n "${OPERATOR_NS}" port-forward deploy/m80 "${PF_PORT}:${M80_PORT}" >/dev/null 2>&1 &
PF_PID=$!
trap 'kill "${PF_PID}" >/dev/null 2>&1 || true' EXIT

M80="http://localhost:${PF_PORT}"
up=0
for _ in $(seq 1 20); do
    if curl -sf "${M80}/_m80/health" >/dev/null 2>&1; then up=1; break; fi
    sleep 0.5
done
[ "${up}" -eq 1 ] || fail "could not reach m80 through a port-forward on ${PF_PORT}"

# Arm a lever and insist m80 says it did. A 404 here is the -enable-injection
# flag missing, which is a different problem from the estate misbehaving and
# deserves to be said so.
arm() {
    local body="$1" out
    out="$(curl -sf -X POST "${M80}/_m80/inject" -d "${body}" 2>/dev/null)"
    if [ -z "${out}" ]; then
        fail "m80 refused the lever, which is one of two things and not the estate.

    The flag is off. local-up.sh leaves -enable-injection off by default:
        M80_ENABLE_INJECTION=1 just prod-ha-local-e2e

    Or the image has no such flag. -enable-injection landed on m80 main
    after v0.3.0 was tagged, so no published image carries it (m80#74) and
    turning it on with one crashloops m80 rather than being ignored. Until
    a release carries it, this needs a build of m80 main:
        docker build -t m80:main ~/checkouts/m80
        M80_IMAGE=m80:main M80_ENABLE_INJECTION=1 just prod-ha-local-e2e

    body was: ${body}"
    fi
    case "${out}" in
        *'"injected":true'*) : ;;
        *) fail "m80 answered without injected=true: ${out}" ;;
    esac
    echo "    armed: ${body}"
}

# Poll a jsonpath until it matches.
wait_for() {
    local what="$1" query="$2" want="$3" deadline=$((SECONDS + TIMEOUT)) seen=""
    while [ "${SECONDS}" -lt "${deadline}" ]; do
        seen="$(kubectl -n "${NS}" get ${query} 2>/dev/null)"
        case "${seen}" in
            *${want}*) echo "    ${what}: ${want}"; return 0 ;;
        esac
        sleep 5
    done
    fail "${what} never reached ${want} within ${TIMEOUT}s (last: '${seen}')"
}

echo "==> failure paths at tier ${TIER}"

# ── a build that fails ───────────────────────────────────────────────────
# The lever is keyed by name and arms before the resource exists, so the image
# has to be removed and recreated for it to bite. The name comes off the live
# CR rather than being rederived, since naming.ts is the only thing that knows
# how it is built.
# Which image, and not `.items[0]`. A tier change leaves the previous tier's
# image in place — kubectl apply does not prune — so after minimal -> prod-ha
# there are two, and the first one is the wrong one. Arming the wrong lever
# then watching the right image build successfully is a five minute wait ending
# in a message that names neither. Ask what this tier's VMs actually reference.
image="$(estate_image_name "${NS}")"
[ -n "${image}" ] || fail "nothing in ${NS} references an image — stand the tier up first"

# The lever keys by the name m80 knows, which is the CR name the operator
# passed to CreateMicrovmImage. imageRef is that name.
kubectl -n "${NS}" get microvmimage "${image}" >/dev/null 2>&1 ||
    fail "the VMs reference image ${image}, which does not exist in ${NS}"
echo "    this tier's VMs reference ${image}"

echo "  a build that fails"
# The replica set goes first. m80 refuses to delete an image a live VM still
# references — recorded behaviour, and the same on real AWS — and at the
# production tiers a replica set recreates a deleted VM immediately, so
# deleting VMs alone leaves the image undeletable and the lever unarmed.
kubectl -n "${NS}" delete microvmreplicaset --all --timeout=120s >/dev/null 2>&1 || true
kubectl -n "${NS}" delete microvm --all --timeout=120s >/dev/null 2>&1 || true
kubectl -n "${NS}" delete microvmimage "${image}" --timeout=120s >/dev/null 2>&1 || true
# Insist the image is actually gone. If it is not, the lever will not bite and
# the check would fail later for a reason that has nothing to do with it.
for _ in $(seq 1 24); do
    kubectl -n "${NS}" get microvmimage "${image}" >/dev/null 2>&1 || break
    sleep 5
done
if kubectl -n "${NS}" get microvmimage "${image}" >/dev/null 2>&1; then
    fail "MicroVMImage ${image} would not delete, so the build lever cannot arm.
    A live VM referencing it is the usual cause."
fi
arm "{\"target\":\"build\",\"name\":\"${image}\"}"
kubectl apply -f "${MANIFEST}" >/dev/null

# FAILED rather than a timeout is the whole assertion: the operator has to
# surface the service's answer, not sit on it.
# Named, not {.items[*]}: with two images present a wildcard would report
# "SUCCESSFUL FAILED" and match on the other tier's image.
wait_for "the image build" \
    "microvmimage ${image} -o jsonpath={.status.latestVersionState}" \
    "FAILED"

reason="$(kubectl -n "${NS}" get microvmimage "${image}" -o jsonpath='{.status.latestVersionStateReason}' 2>/dev/null)"
if [ -n "${reason}" ]; then
    echo "    reason surfaced: ${reason}"
else
    echo "    note: latestVersionStateReason is empty — the state is there, the why is not"
fi

# ── a connector that cannot be created ───────────────────────────────────
# minimal declares no MicroVMNetwork, so there is nothing to fail.
if [ "${TIER}" = "minimal" ]; then
    echo "  a connector that fails: skipped, ${TIER} declares no MicroVMNetwork"
else
    echo "  a connector that fails"
    network="$(kubectl -n "${NS}" get microvmnetwork -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)"
    [ -n "${network}" ] || fail "no MicroVMNetwork in ${NS} at tier ${TIER}"

    code="${REASON_CODE:-SubnetOutOfIPAddresses}"

    # The VMs go first, and this is not the same clearing the build stage did:
    # re-applying the manifest there brought the replica set and its VMs back,
    # and a MicroVM referencing this connector holds its deletion open. The
    # first version of this deleted the network with VMs live, swallowed the
    # error, and then waited five minutes for a state change on a CR that had
    # never been recreated — nine minutes old at the point it gave up.
    kubectl -n "${NS}" delete microvmreplicaset --all --timeout=120s >/dev/null 2>&1 || true
    kubectl -n "${NS}" delete microvm --all --timeout=120s >/dev/null 2>&1 || true

    if ! kubectl -n "${NS}" delete microvmnetwork "${network}" --timeout=180s >/dev/null 2>&1; then
        fail "MicroVMNetwork ${network} would not delete, so the connector lever cannot arm.
    A MicroVM still referencing it is the usual cause, and a finalizer that
    outlives the reference is the other."
    fi
    for _ in $(seq 1 24); do
        kubectl -n "${NS}" get microvmnetwork "${network}" >/dev/null 2>&1 || break
        sleep 5
    done
    if kubectl -n "${NS}" get microvmnetwork "${network}" >/dev/null 2>&1; then
        fail "MicroVMNetwork ${network} is still present after a successful delete call"
    fi

    arm "{\"target\":\"connector\",\"name\":\"${network}\",\"reasonCode\":\"${code}\"}"
    kubectl apply -f "${MANIFEST}" >/dev/null

    # Named for the same reason the image is, even though minimal declares no
    # network so there is only ever one today.
    wait_for "the connector" \
        "microvmnetwork ${network} -o jsonpath={.status.stateReasonCode}" \
        "${code}"
fi

echo "==> the estate reported every injected failure"
