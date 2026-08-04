import { phase, type Component } from "@intentius/chant/components";

/**
 * cert-manager, the pinned CRDs, the operator's Helm release, and the two env
 * patches the chart cannot carry. It owns no declared resources on purpose:
 * the operator is a chart the kit installs at a pinned version, not a set of
 * objects the kit declares, and re-declaring its innards would fight the chart
 * on every upgrade (`../workload/params.ts` says the same thing from the other
 * side).
 *
 * So this component exists for the ordering rather than for the inventory. It
 * is the boundary the install Op's second phase encodes, and leaving it out
 * would draw `aws-plane -> workload` as if a custom resource could reconcile
 * with nothing reconciling it.
 *
 * There is no `src/operator/` directory and there should not be one. A
 * component with no source files correlates to no resources, which is the
 * honest answer here — the chart's objects belong to Helm, are never marked
 * `app.kubernetes.io/managed-by=chant`, and are therefore never touched by a
 * chant prune.
 */
export const operator: Component = {
  name: "operator",
  archetype: "infra",
  // The operator's first reconcile passes a build role to the MicroVMs
  // service. If the AWS plane has not been applied, that role does not exist
  // and the failure arrives in a controller log rather than at install time.
  dependsOn: ["aws-plane"],
  deploy: [
    phase("Install", [
      {
        kind: "shell",
        cmd: "bash scripts/install/operator.sh",
        // `shell` wants a justification for reaching past the capability set,
        // and this is a real one rather than a formality.
        reason:
          "chant has no helm or kubectl capability, and this is the same script the install Op runs — a second implementation would be a second thing to keep true.",
      },
    ]),
  ],
};
