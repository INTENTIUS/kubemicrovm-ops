/**
 * The Kubernetes plane: two namespaces, and the workload that goes in one of
 * them.
 *
 * Which resources exist is the tier's decision and nothing else's. `minimal`
 * declares an image and a single VM. The production tiers add a class carrying
 * the idle policy, a network connector for VPC egress, and swap the single VM
 * for a replica set whose `template` is the same spec a bare `MicroVM` carries.
 * No resource is declared "empty" to keep the shape symmetrical: a tier with no
 * idle policy has no `MicroVMClass` at all.
 *
 * That whole set is one composite, `MicrovmWorkload` — four resources the tier
 * chooses between, never a subset picked differently. The namespaces stay out
 * of it: they are where a workload goes rather than part of one, and the
 * operator's belongs to a chart this kit does not own.
 *
 * Every value a constructor property reads is bound to a const first, so each
 * property expression is a plain identifier and the whole stack folds without
 * being executed.
 */

import { Namespace } from "@intentius/chant-lexicon-k8s";
import { MicrovmWorkload } from "../composites/microvm-workload";
import { kmvNaming, MANAGED_NAMESPACE_LABEL, OPERATOR_NAMESPACE_LABEL } from "../lib/naming";
import {
  baseImageArn,
  bucketName,
  buildRoleArn,
  namingParams,
  operatorNamespace,
  operatorRoleArn,
  profile,
  securityGroupIds,
  sourceKey,
  subnetIds,
  workloadNamespace,
} from "./params";

const naming = kmvNaming(namingParams);
const labels = naming.labels();
const tags = naming.tags();
const region = namingParams.region;

// The image name carries the tier, and that is not cosmetic.
// `MicroVMImage.spec.memorySizeMiB` is immutable after creation — the
// admission webhook rejects a change with "spec.memorySizeMiB is immutable
// after image creation" — and memory is one of the things a tier sets. An
// image named without the tier would make `minimal` -> `prod` an apply that
// cannot succeed. Named with it, the two tiers own two images.
const imageName = naming.name(`${namingParams.tier}-image`, { service: "k8sObject" });
const className = naming.name("class", { service: "k8sObject" });
const networkName = naming.name("network", { service: "k8sObject" });
const vmName = naming.name("vm", { service: "k8sObject" });

const operatorNsLabels = { ...labels, [OPERATOR_NAMESPACE_LABEL]: "operator" };
const operatorNsMetadata = { name: operatorNamespace, labels: operatorNsLabels };
const workloadNsLabels = { ...labels, [MANAGED_NAMESPACE_LABEL]: "true" };
const workloadNsMetadata = { name: workloadNamespace, labels: workloadNsLabels };

/**
 * The operator's namespace. Declared so the pod identity association has
 * something to bind to and so a teardown knows what it owns, but the operator's
 * own objects inside it belong to the chart.
 */
export const operatorNs = new Namespace({ metadata: operatorNsMetadata });

/**
 * The workload namespace. The label is not decoration: the admission webhook
 * rejects any MicroVM custom resource in a namespace that does not carry it,
 * and the rejection names the resource rather than the namespace, so a missing
 * label is a confusing failure a long way from its cause.
 */
export const workloadNs = new Namespace({ metadata: workloadNsMetadata });

const workloadNames = { image: imageName, vmClass: className, network: networkName, vm: vmName };

/**
 * The image, the class, the connector and the VMs — whichever of them this tier
 * calls for. One composite, because the tier chooses between them as a set.
 */
export const workload = MicrovmWorkload({
  namespace: workloadNamespace,
  labels,
  tags,
  region,
  names: workloadNames,
  profile,
  bucketName,
  sourceKey,
  baseImageArn,
  buildRoleArn,
  operatorRoleArn,
  subnetIds,
  securityGroupIds,
});
