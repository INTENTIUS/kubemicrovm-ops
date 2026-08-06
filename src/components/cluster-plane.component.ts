import { phase, type Component } from "@intentius/chant/components";
import { params } from "@intentius/chant/params";

const clusterMode = (params.clusterMode as string | undefined) ?? "reference-existing";

/**
 * The VPC and EKS cluster, when the kit provisions them (clusterMode=
 * provision). First in the wave order on the real target: everything else —
 * the pod identity association, the operator, the workload — lands on this
 * cluster. Under reference-existing (the default, and the local-k3d flow)
 * the component sits out of `run all` (#1522) and its name in dependents'
 * dependsOn is satisfied vacuously.
 */
export const clusterPlane: Component = {
  name: "cluster-plane",
  enabled: clusterMode === "provision",
  archetype: "infra",
  dependsOn: [],
  liveNames: [
    "networkVpc",
    "networkPrivateSubnet1",
    "networkPrivateSubnet2",
    "clusterCluster",
    "clusterNodegroup",
  ],
  deploy: [
    phase("Apply", [
      {
        kind: "shell",
        cmd: "npx chant build src/cluster-plane --lexicon aws -o dist/cluster-plane.template.json",
        reason:
          "a synthesis step, not a mutation: chant building the template the next step deploys",
      },
      {
        kind: "cfn-deploy",
        stack: "kubemicrovm-ops-cluster-plane",
        template: "dist/cluster-plane.template.json",
      },
    ]),
  ],
};
