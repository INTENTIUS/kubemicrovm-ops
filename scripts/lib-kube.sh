# Pin every kubectl call to the cluster this run is about. Sourced, not run.
#
# The bug this fixes (#44): doctor.sh checked that the right cluster was
# reachable with an explicit --context, then made every subsequent query
# without one. On a machine whose active context belonged to another project it
# verified cluster A and reported on cluster B — a healthy estate came back as
# three failures, and the "cluster reachable" line above them made the failures
# look credible.
#
# It needs a second cluster to show up, which is the machine of anyone who does
# this for a living. `k3d cluster create` switches the active context as a side
# effect, so a laptop with only this project's cluster never notices.
#
# Rather than adding --context to eighty-nine call sites, this shadows kubectl
# with a function that adds it. Every script sources this file, so each process
# gets its own definition — no exported functions, nothing inherited across a
# `bash script.sh` boundary by magic.
#
# KMV_KUBE_CONTEXT is what decides. local-up.sh sets it for the local target;
# the live target leaves it unset, because pinning a k3d context on a run
# against real EKS would be worse than the bug. Unset means kubectl behaves
# exactly as before.

kubectl() {
    if [ -n "${KMV_KUBE_CONTEXT:-}" ]; then
        command kubectl --context "${KMV_KUBE_CONTEXT}" "$@"
    else
        command kubectl "$@"
    fi
}

# Fail before touching anything if the pinned context is not there. Without
# this, kubectl's own error arrives per-call, halfway through whatever the
# script was doing, and the destructive paths (assert-quota-refusal.sh patches
# a deployment and deletes custom resources) would have started already.
kmv_require_context() {
    [ -n "${KMV_KUBE_CONTEXT:-}" ] || return 0
    if ! command kubectl config get-contexts "${KMV_KUBE_CONTEXT}" >/dev/null 2>&1; then
        echo "no kubectl context '${KMV_KUBE_CONTEXT}'" >&2
        echo "" >&2
        echo "  ./go              # stands the local target up and creates it" >&2
        echo "  kubectl config get-contexts" >&2
        return 1
    fi
}
