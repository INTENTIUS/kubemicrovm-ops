#!/usr/bin/env bash
# Does this estate fit in an AWS account's memory quota.
#
#   ./scripts/local/account-fit.sh          # warn, never fail
#   ./scripts/local/account-fit.sh --strict # exit 1 if it does not fit
#
# The MicroVMs service caps how much memory an account may have allocated
# across running VMs at once. A fresh account's ceiling is 8192 MiB — read
# live 2026-08-06 from Service Quotas ("Max allocated MicroVM memory", 8 GB
# applied; the on-paper default is 1024 GB, so new accounts run under a
# sub-default cap that only a support case can raise. m80 recorded 4096 from
# an earlier account, so the ramp varies). prod-ha's 2 x 4096 MiB was refused
# at exactly this wall: 402 ServiceQuotaExceededException on the second VM.
#
# This is the local target's whole reason for existing, applied to a cost: the
# estate that does not fit is discovered here in seconds, rather than after a
# real deploy, a support ticket and however many days a quota increase takes.
#
# Reads what is deployed rather than what tiers.ts declares, because a live
# replica floor and a live image memory size are the numbers the service will
# actually be asked for.
#
# Written for bash 3.2, which is what macOS ships.
set -uo pipefail
. "$(dirname "$0")/../lib-kube.sh"
# Local-target scripts know their own cluster — but only on the local target.
# assert-converged.sh calls this on the real target too, where the ambient
# context (the one cluster-kubeconfig.sh set) is the cluster and a forced k3d
# context makes every read fail. Same target-awareness as assert-converged.
if [ -n "${AWS_ENDPOINT_URL:-}" ]; then
    KMV_KUBE_CONTEXT="${KMV_KUBE_CONTEXT:-k3d-${CLUSTER:-kubemicrovm-local}}"
fi

STRICT=0
[ "${1:-}" = "--strict" ] && STRICT=1

NS="${KMV_NAMESPACE:-microvm-demo}"
# The ceiling a fresh AWS account has, read live from Service Quotas
# 2026-08-06. Override to whatever your account was raised to.
ACCOUNT_CEILING_MIB="${ACCOUNT_CEILING_MIB:-8192}"

. "$(dirname "$0")/lib-estate.sh"

# The image this tier's VMs reference — not `.items[0]`, which after a tier
# change is the previous tier's leftover image. Reading the wrong one here does
# not fail, it answers wrongly: 2048 x 2 = 4096 "fits", for an estate that
# needs 8192 and does not.
image="$(estate_image_name "${NS}")"
if [ -z "${image}" ]; then
    echo "account fit: nothing in ${NS} references an image, nothing to size" >&2
    exit 0
fi

per_vm="$(kubectl -n "${NS}" get microvmimage "${image}" \
    -o jsonpath='{.status.memorySizeMiB}' 2>/dev/null)"
if [ -z "${per_vm}" ]; then
    echo "account fit: ${image} reports no memorySizeMiB yet, nothing to size" >&2
    exit 0
fi

replicas="$(estate_vm_count "${NS}")"
needs=$((per_vm * replicas))

printf 'account fit: %s at %s MiB x %s = %s MiB, against a %s MiB ceiling\n' \
    "${image}" "${per_vm}" "${replicas}" "${needs}" "${ACCOUNT_CEILING_MIB}"

if [ "${needs}" -le "${ACCOUNT_CEILING_MIB}" ]; then
    echo "            fits"
    exit 0
fi

# A warning rather than a failure. An account raised to a higher ceiling is a
# perfectly ordinary thing to be deploying into, and the kit cannot tell that
# apart from an account that has not been raised — only you can.
cat >&2 <<EOF

  WARNING: this estate does not fit a default AWS account.

  It needs ${needs} MiB allocated at once, and a fresh account is capped at
  ${ACCOUNT_CEILING_MIB} MiB. On a real deploy the VMs past the ceiling are
  refused with 402 ServiceQuotaExceededException, and the operator reports
  that as a timeout rather than as a quota — so it reads like a hang.

  Either raise the account quota before deploying, which is a support
  request and not instant, or reduce the estate:

    a smaller memorySizeMiB profile, or a lower replica floor

  If your account is already raised, say so and this goes quiet:

    ACCOUNT_CEILING_MIB=${needs} just validate

EOF

[ "${STRICT}" -eq 1 ] && exit 1
exit 0
