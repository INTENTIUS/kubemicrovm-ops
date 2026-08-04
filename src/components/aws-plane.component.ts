import { phase, type Component } from "@intentius/chant/components";

/**
 * The AWS plane: the artifact bucket, the build role, the operator role and
 * its three managed policies, and — against a real EKS cluster — the pod
 * identity association. One CloudFormation stack, synthesized from
 * `../aws-plane/plane.ts`.
 *
 * The name is `aws-plane` because the directory is `src/aws-plane/`, and that
 * is not a coincidence anyone should have to rediscover: a reader correlates a
 * resource to a component by the source file it came from, and so does behold
 * — `resourcesByComponent` keys off the `<component>/` segment of each node's
 * `sourceLoc.file` (behold/src/resources.ts). A component whose name does not
 * match its directory owns nothing as far as the graph is concerned.
 *
 * Nothing depends on this component's outputs by name. The bucket and the two
 * role ARNs reach the Kubernetes plane through
 * `scripts/local/apply-estate.sh`, which reads them off the deployed stack —
 * so the wiring is a real read of what CloudFormation created rather than a
 * `stackOutput` reference resolved at graph time. That is deliberate: the
 * roles are named by the stack, and reading them back is what stops the two
 * planes disagreeing about what the names are.
 */
export const awsPlane: Component = {
  name: "aws-plane",
  archetype: "infra",
  dependsOn: [],
  deploy: [
    // Once per region, and a no-op on re-run through CloudFormation's own
    // idempotency — which is why the install Op can be re-run against a
    // standing estate rather than being an install-only path.
    phase("Apply", [
      {
        kind: "cfn-deploy",
        stack: "kubemicrovm-ops-aws-plane",
        template: "dist/aws-plane.template.json",
      },
    ]),
  ],
};
