import { phase, type Component } from "@intentius/chant/components";
import { kubectlApply } from "@intentius/chant-lexicon-k8s/components";
import { params } from "@intentius/chant/params";
import { resolveTarget } from "../lib/target";

const target = resolveTarget({
  awsEndpointUrl: params.awsEndpointUrl as string | undefined,
  microvmEndpointUrl: params.microvmEndpointUrl as string | undefined,
});

/**
 * m80, deployed the way everything else now is: built from its declaration
 * (src/local-substrate/) and applied as a stack-marked kubectl-apply the
 * status walk observes by name.
 *
 * Local target only in effect: on the real target the declaration builds
 * nothing (the MicroVMs API is AWS's own), the build step writes an empty
 * manifest, and the apply applies nothing. First in the wave order — the
 * operator's AWS connectivity gate calls m80's STS shim, so m80 must be
 * serving before the operator install waits on readiness.
 */
export const localSubstrate: Component = {
  name: "local-substrate",
  // Target-gated (#1522): the real target's MicroVMs API is AWS's own — the
  // component sits out of `run all` there instead of applying an empty
  // manifest.
  enabled: target.target === "local",
  archetype: "infra",
  dependsOn: [],
  liveNames: ["m80Deploy", "m80Svc"],
  deploy: [
    phase("Apply", [
      {
        kind: "shell",
        cmd: "kubectl create namespace kube-microvm --dry-run=client -o yaml | kubectl apply -f - >/dev/null",
        reason:
          "bootstrap ordering, not ownership: the namespace is declared and labelled by the workload stack, which deploys last — m80 just needs somewhere to land first, and this bare create is what the old runner did",
      },
      {
        kind: "shell",
        cmd: "bash scripts/install/build-local-substrate.sh",
        reason:
          "a synthesis step: builds the m80 declaration on the local target, writes an empty manifest on the real one — an all-omitted stack build throws by convention, and the target split is exactly what this script encodes",
      },
      kubectlApply({
        manifest: "dist/local-substrate.yaml",
        stack: "kmv-local-substrate",
        delete: "owned-only",
        noRollback:
          "server-side apply keeps no previous object state; the pinned declaration is the restore path",
      }),
      {
        kind: "shell",
        cmd: "kubectl -n kube-microvm rollout status deploy/m80 --timeout=300s",
        reason:
          "the operator's AWS connectivity gate calls m80's STS shim at startup — waiting for the emulator's rollout here is what makes the operator install deterministic instead of racing it",
      },
    ]),
  ],
};
