/**
 * The Kubernetes plane: two namespaces and the custom resources that describe
 * one MicroVM workload at the selected tier.
 *
 * Which resources exist is the tier's decision and nothing else's. `minimal`
 * declares an image and a single VM. The production tiers add a class carrying
 * the idle policy, a network connector for VPC egress, and swap the single VM
 * for a replica set whose `template` is the same spec a bare `MicroVM` carries.
 * No resource here is declared "empty" to keep the shape symmetrical: a tier
 * with no idle policy has no `MicroVMClass` at all.
 *
 * Every value a constructor property reads is bound to a const first, so each
 * property expression is a plain identifier and the whole stack folds without
 * being executed.
 */

import {
  MicroVM,
  MicroVMClass,
  MicroVMImage,
  MicroVMNetwork,
  MicroVMReplicaSet,
  Namespace,
} from "@intentius/chant-lexicon-k8s";
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

const imageMetadata = { name: imageName, namespace: workloadNamespace, labels };
const classMetadata = { name: className, namespace: workloadNamespace, labels };
const networkMetadata = { name: networkName, namespace: workloadNamespace, labels };
const vmMetadata = { name: vmName, namespace: workloadNamespace, labels };

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

const imageSource = { s3Bucket: bucketName, s3Key: sourceKey };
const imageSpec = {
  source: imageSource,
  baseImageArn,
  buildRoleArn,
  region,
  memorySizeMiB: profile.image.memorySizeMiB,
  maxVersionsToKeep: profile.image.maxVersionsToKeep,
  buildTimeoutSeconds: profile.image.buildTimeoutSeconds,
  autoActivate: profile.image.autoActivate,
};

/**
 * The image. Present at every tier, and the only place memory is set — memory
 * is a property of the built image, not of the class, which is the thing about
 * this API most likely to be guessed the other way round.
 */
export const image = new MicroVMImage({ metadata: imageMetadata, spec: imageSpec });

const classSpecBase = {
  description: profile.intent,
  maxIdleDurationSeconds: profile.class?.maxIdleDurationSeconds,
  suspendedDurationSeconds: profile.class?.suspendedDurationSeconds,
  autoResumeEnabled: profile.class?.autoResumeEnabled,
  ingressNetworkConnectors: profile.class?.ingressNetworkConnectors,
  egressNetworkConnectors: profile.class?.egressNetworkConnectors,
};
const maximumDuration = profile.class?.maximumDurationSeconds;
const classSpec = maximumDuration
  ? { ...classSpecBase, maximumDurationSeconds: maximumDuration }
  : classSpecBase;

/**
 * The idle and lifetime policy, referenced by name from a VM's `className`.
 * Absent at `minimal`, where VMs take the service defaults.
 */
export const vmClass = profile.class
  ? new MicroVMClass({ metadata: classMetadata, spec: classSpec })
  : undefined;

// As many subnets as the tier asks for. This one number is the whole of what
// makes prod-ha multi-AZ, once the subnets themselves are an input.
const connectorSubnetIds = subnetIds.slice(0, profile.network?.subnetCount ?? 0);
const networkSpec = {
  connectorName: networkName,
  networkProtocol: profile.network?.networkProtocol,
  operatorRoleArn,
  region,
  subnetIds: connectorSubnetIds,
  securityGroupIds,
  tags,
};

/**
 * The VPC egress connector. The ENIs behind it are created by EC2 on the
 * service's behalf, which is the part of the estate the local target cannot
 * reach at all.
 */
export const network = profile.network
  ? new MicroVMNetwork({ metadata: networkMetadata, spec: networkSpec })
  : undefined;

/**
 * The spec a VM runs with, shared verbatim between the single-VM and
 * replica-set shapes — `MicroVMReplicaSet.spec.template` is the MicroVM spec
 * inline, with no metadata wrapper, so one object serves both.
 */
const vmSpecBase = {
  imageRef: imageName,
  desiredState: "Running",
  region,
  tags,
};
const vmSpecWithClass = profile.class ? { ...vmSpecBase, className } : vmSpecBase;
const vmSpec = profile.network ? { ...vmSpecWithClass, networkRef: networkName } : vmSpecWithClass;

/** `minimal` — one VM, no class, no connector. */
export const vm =
  profile.workload.kind === "MicroVM"
    ? new MicroVM({ metadata: vmMetadata, spec: vmSpec })
    : undefined;

const replicaSetSpec = {
  replicas: profile.workload.kind === "MicroVMReplicaSet" ? profile.workload.replicas : undefined,
  minReady: profile.workload.kind === "MicroVMReplicaSet" ? profile.workload.minReady : undefined,
  maxSurge: profile.workload.kind === "MicroVMReplicaSet" ? profile.workload.maxSurge : undefined,
  maxUnavailable:
    profile.workload.kind === "MicroVMReplicaSet" ? profile.workload.maxUnavailable : undefined,
  updateStrategyType:
    profile.workload.kind === "MicroVMReplicaSet" ? profile.workload.updateStrategyType : undefined,
  scaleDown: profile.workload.kind === "MicroVMReplicaSet" ? profile.workload.scaleDown : undefined,
  template: vmSpec,
};

/** The production tiers — a replica set with a floor and a rolling update. */
export const replicaSet =
  profile.workload.kind === "MicroVMReplicaSet"
    ? new MicroVMReplicaSet({ metadata: vmMetadata, spec: replicaSetSpec })
    : undefined;
