import { phase, type Component } from "@intentius/chant/components";
import { kubectlApply } from "@intentius/chant-lexicon-k8s/components";

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
  archetype: "infra",
  dependsOn: [],
  liveNames: ["m80Deploy", "m80Svc"],
  deploy: [
    phase("Apply", [
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
    ]),
  ],
};
