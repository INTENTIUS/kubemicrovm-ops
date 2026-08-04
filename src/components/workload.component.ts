import { phase, type Component } from "@intentius/chant/components";

/**
 * The Kubernetes plane: the two namespaces and whichever of the five custom
 * resources the selected tier declares. Synthesized from
 * `../workload/workload.ts`, which is why the component is named for the
 * directory — see the note in `./aws-plane.component.ts`.
 *
 * This is the component the tier axis moves. At `minimal` it owns a namespace
 * pair, an image and one `MicroVM`; at `prod-ha` the same component owns a
 * class, a connector and a replica set instead. Nothing about the component
 * changes — the resources hanging off it do, which is the thing the tier
 * picker is worth looking at for.
 */
export const workload: Component = {
  name: "workload",
  archetype: "infra",
  // Not `aws-plane` directly: a custom resource applied before the chart has
  // installed its CRDs is rejected by the API server, and one applied before
  // the webhook is up is rejected by the webhook. The operator carries the
  // AWS-plane dependency transitively.
  dependsOn: ["operator"],
  deploy: [
    // Two steps rather than one, because "it applied" and "it converged" are
    // different claims and every schema gap this kit has hit passed the first
    // and failed the second.
    phase("Apply", [
      {
        kind: "shell",
        cmd: "bash scripts/local/apply-estate.sh",
        reason:
          "the estate is built and applied by the same script the install Op runs, which reads the AWS-plane role and bucket names back off the deployed stack rather than guessing them.",
      },
    ]),
    phase("Converge", [
      {
        kind: "shell",
        cmd: "bash scripts/local/assert-converged.sh",
        reason:
          "readiness here is the operator's status fields reaching a value, not a kubectl exit code — the image SUCCESSFUL, the connector ACTIVE, readyReplicas at the tier's floor.",
      },
    ]),
  ],
};
