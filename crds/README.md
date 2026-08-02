# KubeMicroVM CRDs, pinned

Copied verbatim from the `crds/` directory of

    oci://ghcr.io/codriverlabs/helm/kube-microvm-operator:1.0.11

They are here for two reasons. `test/tier-matrix.test.ts` reads them to check
that every field the kit emits is one the schema actually declares — a typo in
a custom-resource spec is accepted by the API server and ignored by the
controller, so nothing else catches it. And `scripts/local/local-up.sh` applies
them to the k3d cluster before the operator chart, so the CRs can be applied
whether or not the chart's own CRD install has run.

Regenerate on a version bump:

    helm pull oci://ghcr.io/codriverlabs/helm/kube-microvm-operator \
      --version <new> --untar --untardir /tmp/kmv-chart
    cp /tmp/kmv-chart/kube-microvm-operator/crds/*.yml crds/

The typed classes the kit builds against come from the same chart, generated
into the chant k8s lexicon rather than into this repo — see
`content/docs/typed-crds.md`.
