/**
 * The teardown Op — the install ordering, reversed, and stopping where the
 * install stopped.
 *
 * Reverse order matters for one reason: the operator refuses to delete a
 * MicroVMImage while a VM references it, so the custom resources have to go
 * before the chart that reconciles them, and the chart before the roles it
 * assumes. Deleting the AWS plane first leaves an operator reconciling against
 * roles that no longer exist, which it reports as an error every ten seconds
 * rather than as a teardown.
 *
 *     chant run kubemicrovm-teardown
 *
 * It does not delete the cluster, floci or m80 — those are the local target's
 * lifecycle, and `scripts/local/local-down.sh` owns them. Against the real
 * target the cluster is the adopter's and this Op has no business with it.
 */

import { Op, phase, shell } from "@intentius/chant-lexicon-temporal";

const TEARDOWN = { profile: "longInfra" } as const;

export default Op({
  name: "kubemicrovm-teardown",
  overview: "Remove this kit's estate and the operator, leaving the cluster where it found it",
  phases: [
    // VMs before images: the operator refuses to delete an image a live VM
    // references, and the refusal is correct rather than a race to lose.
    phase("Estate", [shell("bash scripts/install/teardown-estate.sh", TEARDOWN)]),
    phase("Operator", [shell("bash scripts/install/teardown-operator.sh", TEARDOWN)]),
    phase("AwsPlane", [shell("bash scripts/install/teardown-aws-plane.sh", TEARDOWN)]),
  ],
});
