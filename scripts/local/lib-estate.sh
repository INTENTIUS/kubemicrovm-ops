# Shared estate lookups. Sourced, not run.
#
# These exist because "which image does this tier use" has one right answer and
# three scripts kept inventing their own. `.items[0]` was the wrong one, twice:
# kubectl apply does not prune, so a minimal -> prod-ha tier change leaves both
# images in the namespace and the first is the older one.
#
# That mistake failed loudly in assert-failure-paths.sh, which armed a lever on
# the wrong image and timed out. It failed *silently* in account-fit.sh, which
# read 2048 MiB off the leftover minimal image, computed 2048 x 2 = 4096, and
# reported that a prod-ha estate needing 8192 MiB fits in a 4096 MiB account.
# A wrong "fits" is worse than no check, so the lookup lives in one place now.

# The image this tier's VMs actually reference, which is also the name the
# operator passed to CreateMicrovmImage and therefore the name m80 knows.
#
#   estate_image_name <namespace>
estate_image_name() {
    local ns="$1" name=""
    name="$(kubectl -n "${ns}" get microvmreplicaset \
        -o jsonpath='{.items[0].spec.template.spec.imageRef}' 2>/dev/null)"
    if [ -z "${name}" ]; then
        name="$(kubectl -n "${ns}" get microvm \
            -o jsonpath='{.items[0].spec.imageRef}' 2>/dev/null)"
    fi
    printf '%s' "${name}"
}

# How many VMs this estate runs at its floor: the replica floor if a replica
# set declares one, otherwise however many MicroVMs are declared.
#
#   estate_vm_count <namespace>
estate_vm_count() {
    local ns="$1" n=""
    n="$(kubectl -n "${ns}" get microvmreplicaset \
        -o jsonpath='{.items[0].spec.replicas}' 2>/dev/null)"
    if [ -z "${n}" ]; then
        n="$(kubectl -n "${ns}" get microvm --no-headers 2>/dev/null | grep -c .)"
    fi
    [ -z "${n}" ] && n=1
    [ "${n}" -eq 0 ] 2>/dev/null && n=1
    printf '%s' "${n}"
}
