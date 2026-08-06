import { phase, type Component } from "@intentius/chant/components";
import { kubectlApply } from "@intentius/chant-lexicon-k8s/components";
import { params } from "@intentius/chant/params";

const tier = (params.tier as string | undefined) ?? "minimal";

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
  // The entity names this component owns, which are not its name.
  //
  // `chant components status --live` joins live evidence to a component by
  // name, and falls back to component-name == entity-name when nothing says
  // otherwise. Nothing here is called `workload`, so that join found nothing
  // and every component reported `resources: null` — no rollup, and behold
  // paints a component with no rollup neutral, which reads as "not deployed"
  // for an estate that is running.
  //
  // Listed across every tier on purpose. A name with no entity at the current
  // tier is filtered out rather than counted absent (`liveEvidenceFromChangeSet`
  // drops unresolved names), so one list covers `minimal`'s bare `workloadVm`
  // and the production tiers' replica set without branching.
  liveNames: [
    "operatorNs",
    "workloadNs",
    "workloadImage",
    "workloadVmClass",
    "workloadNetwork",
    "workloadVm",
    "workloadReplicaSet",
  ],
  deploy: [
    // Two steps rather than one, because "it applied" and "it converged" are
    // different claims and every schema gap this kit has hit passed the first
    // and failed the second.
    phase("Apply", [
      // Build first: the estate manifest wires in the AWS plane's REAL
      // outputs (bucket and role names read back off the deployed stack —
      // deliberate, see aws-plane.component.ts), so it cannot be built ahead
      // of the plane. Target-agnostic: the readbacks hit whichever AWS the
      // environment points at.
      {
        kind: "shell",
        cmd: `bash scripts/install/build-estate.sh ${tier}`,
        reason:
          "a build step, not an apply: the AWS-plane bucket and role names are read back off the deployed stack and wired into the manifest — reading what CloudFormation actually created is what stops the two planes disagreeing.",
      },
      // The apply itself is the capability: stack-marked, prune-scoped to
      // what this component owns, observed by name in components status.
      kubectlApply({
        manifest: `dist/workload-${tier}.yaml`,
        stack: "kmv-workload",
        delete: "owned-only",
        noRollback:
          "server-side apply keeps no previous object state; the declared source at the previous tier is the restore path (build-estate + re-apply)",
      }),
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
