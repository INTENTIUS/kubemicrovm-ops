import { phase, type Component } from "@intentius/chant/components";
import { params } from "@intentius/chant/params";

const goldenImageMode = (params.goldenImageMode as string | undefined) ?? "omit";

/**
 * The operator-less path: chant's `MicrovmApp` composite, which builds an
 * image and the two IAM roles the MicroVMs service assumes through plain
 * CloudFormation with no cluster involved.
 *
 * It hangs off `aws-plane` rather than off `operator` because that is the
 * whole point of it — this branch of the graph never reaches Kubernetes, and
 * drawing it as a second edge out of the AWS plane is what makes the two paths
 * to the same service visible as two paths.
 *
 * Declared even though the seam is off by default, so the graph shows the
 * branch exists. With `goldenImageMode=omit` the component owns no resources;
 * with `--param goldenImageMode=provision` three appear under it. That is the
 * seam doing what a seam does, and a component that only appeared once it was
 * switched on would make the choice invisible until after it was made.
 */
export const goldenImage: Component = {
  name: "golden-image",
  // Seam-gated (#1522): only a run that provisions the golden image carries
  // this unit — under the default `omit`, `run all` deploys the estate the
  // parameters describe and this component sits out.
  enabled: goldenImageMode === "provision",
  archetype: "infra",
  // The image is built from an object in the artifact bucket, so the bucket
  // has to exist first. Nothing in the cluster is involved at all.
  dependsOn: ["aws-plane"],
  deploy: [
    phase("Apply", [
      {
        kind: "cfn-deploy",
        stack: "kubemicrovm-ops-golden-image",
        template: "dist/golden-image.template.json",
      },
    ]),
  ],
};
