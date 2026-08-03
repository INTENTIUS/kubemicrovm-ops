/**
 * The install Op — the ordering that stands a KubeMicroVM estate up, as a
 * durable workflow rather than as the top-to-bottom of a shell script.
 *
 * The ordering is not a design; it is what running it taught. Each phase
 * boundary below is a place where getting it wrong produced a specific,
 * confusing failure:
 *
 *   AWS plane before operator      the operator's first reconcile needs a
 *                                  build role that exists
 *   cert-manager before the chart  the operator's webhooks do not start
 *                                  without it, and the failure names the
 *                                  webhook rather than cert-manager
 *   CRDs before the chart          so a custom resource applies whether or
 *                                  not the chart's own CRD install has run
 *   env patches after the release  the chart drops the keys it does not
 *                                  know, so they cannot ride the install
 *   converge, not apply            every schema gap this kit has hit applied
 *                                  cleanly and failed afterwards
 *
 * Runs on the local executor with no Temporal server:
 *
 *     chant run kubemicrovm-install
 *
 * Target-agnostic in the same way the source is: the phases do not branch on
 * where they are pointed. `AWS_ENDPOINT_URL` set sends the AWS plane to floci
 * and the MicroVMs calls to m80; unset sends both to AWS. What differs is the
 * environment, not the Op.
 *
 * What this Op does NOT do is bring up the substrate. k3d, floci and m80 are
 * the local target's own lifecycle and belong to `scripts/local/local-up.sh`,
 * which brings them up and then runs this. An EKS cluster is the operator's
 * to have already.
 */

import { Op, phase, shell } from "@intentius/chant-lexicon-temporal";

/**
 * Timeout profiles. A helm install pulling cert-manager and an operator image
 * is minutes; a build is seconds; waiting for an image to build and a replica
 * floor to fill is the longest thing here and is bounded by the tier rather
 * than by the cluster.
 */
const INSTALL = { profile: "longInfra" } as const;

export default Op({
  name: "kubemicrovm-install",
  overview: "Stand up the KubeMicroVM operator and this kit's estate, against either target",
  phases: [
    // Once per region and idempotent through CloudFormation. The operator's
    // first reconcile passes this role to the MicroVMs service, so it has to
    // exist before the operator does anything.
    phase("AwsPlane", [
      shell("bash scripts/install/aws-plane.sh", INSTALL),
      // A placeholder object on the local target, a no-op on the real one
      // where the artifact is the adopter's. An estate whose image source
      // points at nothing is not an honest picture of one that points at
      // something.
      shell("bash scripts/install/seed-artifact.sh", INSTALL),
    ]),

    // cert-manager, the pinned CRDs, the chart, and the two patches the chart
    // cannot carry. One phase because the four are one decision — you do not
    // get to have some of them.
    phase("Operator", [shell("bash scripts/install/operator.sh", INSTALL)]),

    // Namespaces and the tier's custom resources, built from the same source
    // the lint pack checked. Reads the AWS plane's outputs off the stack, so
    // it cannot drift from what the first phase actually created.
    phase("Estate", [shell("bash scripts/local/apply-estate.sh", INSTALL)]),

    // The phase that makes the difference between "it applied" and "it
    // worked". Waits on the image reaching SUCCESSFUL, the connector ACTIVE,
    // and readyReplicas equal to the tier's floor.
    phase("Converge", [shell("bash scripts/local/assert-converged.sh", INSTALL)]),
  ],
});
