/**
 * One MicroVM workload: the image it is built from, the policy it runs under,
 * the connector it egresses through, and the VMs themselves.
 *
 * A composite because these four are one deployment decision taken four ways.
 * The tier picks which of them exist — `minimal` is an image and a bare
 * `MicroVM`, the production tiers swap in a class, a connector and a replica
 * set — and nothing in the kit ever wants a subset chosen differently. Grouping
 * them means the composites zoom shows "the workload" rather than five rows a
 * reader has to reassemble into one.
 *
 * The namespaces stay outside it. They are where a workload goes, not part of
 * one, and the operator's namespace belongs to a chart this kit does not own.
 *
 * Named for what it groups rather than for the component that deploys it — see
 * `./operator-role.ts`.
 *
 * ## Logical ids are free here
 *
 * A composite member's logical id becomes `<instanceName><MemberName>`, which
 * on the AWS side is a CloudFormation resource name and therefore a
 * replacement risk. Kubernetes objects are identified by `metadata.name`, which
 * this sets explicitly, so the emitted YAML is byte-identical whatever the
 * members are called. `test/tier-matrix.test.ts` is what proves that.
 */

import { Composite } from "@intentius/chant";
import {
  MicroVM,
  MicroVMClass,
  MicroVMImage,
  MicroVMNetwork,
  MicroVMReplicaSet,
} from "@intentius/chant-lexicon-k8s";
import type { TierProfile } from "../lib/tiers";

export interface MicrovmWorkloadNames {
  image: string;
  vmClass: string;
  network: string;
  vm: string;
}

export interface MicrovmWorkloadProps {
  namespace: string;
  labels: Record<string, string>;
  /** Applied to the VMs and the connector; the same set `naming.tags()` emits. */
  tags: Record<string, string>;
  region: string;
  names: MicrovmWorkloadNames;
  /** Everything the tier varies, and the only thing that does. */
  profile: TierProfile;
  bucketName?: string;
  sourceKey: string;
  baseImageArn?: string;
  buildRoleArn?: string;
  operatorRoleArn?: string;
  subnetIds: string[];
  securityGroupIds: string[];
}

/**
 * The VPC egress connector. The ENIs behind it are created by EC2 on the
 * service's behalf, which is the part of the estate the local target cannot
 * reach at all.
 */
function buildNetwork(props: MicrovmWorkloadProps, network: NonNullable<TierProfile["network"]>) {
  const metadata = { name: props.names.network, namespace: props.namespace, labels: props.labels };
  // As many subnets as the tier asks for. This one number is the whole of what
  // makes prod-ha multi-AZ, once the subnets themselves are an input.
  const connectorSubnetIds = props.subnetIds.slice(0, network.subnetCount);
  const spec = {
    connectorName: props.names.network,
    networkProtocol: network.networkProtocol,
    operatorRoleArn: props.operatorRoleArn,
    region: props.region,
    subnetIds: connectorSubnetIds,
    securityGroupIds: props.securityGroupIds,
    tags: props.tags,
  };
  return new MicroVMNetwork({ metadata, spec });
}

function buildReplicaSet(
  props: MicrovmWorkloadProps,
  workload: Extract<TierProfile["workload"], { kind: "MicroVMReplicaSet" }>,
  vmSpec: Record<string, unknown>,
) {
  const metadata = { name: props.names.vm, namespace: props.namespace, labels: props.labels };
  const spec = {
    replicas: workload.replicas,
    minReady: workload.minReady,
    maxSurge: workload.maxSurge,
    maxUnavailable: workload.maxUnavailable,
    updateStrategyType: workload.updateStrategyType,
    scaleDown: workload.scaleDown,
    template: vmSpec,
  };
  return new MicroVMReplicaSet({ metadata, spec });
}

export const MicrovmWorkload = Composite((props: MicrovmWorkloadProps) => {
  const imageMetadata = { name: props.names.image, namespace: props.namespace, labels: props.labels };
  const imageSource = { s3Bucket: props.bucketName, s3Key: props.sourceKey };
  const imageSpec = {
    source: imageSource,
    baseImageArn: props.baseImageArn,
    buildRoleArn: props.buildRoleArn,
    region: props.region,
    memorySizeMiB: props.profile.image.memorySizeMiB,
    maxVersionsToKeep: props.profile.image.maxVersionsToKeep,
    buildTimeoutSeconds: props.profile.image.buildTimeoutSeconds,
    autoActivate: props.profile.image.autoActivate,
  };

  /**
   * Present at every tier, and the only place memory is set — memory is a
   * property of the built image, not of the class, which is the thing about
   * this API most likely to be guessed the other way round.
   */
  const image = new MicroVMImage({ metadata: imageMetadata, spec: imageSpec });

  const profileClass = props.profile.class;
  const profileNetwork = props.profile.network;

  /**
   * The idle and lifetime policy, referenced by name from a VM's `className`.
   * Absent at `minimal`, whose idle policy rides the VM spec instead — the
   * service has no defaults to take (see IdleProfile in ../lib/tiers.ts).
   *
   * Assembled here rather than in a helper like the connector and the replica
   * set below, because the lifetime cap is a *conditional property* and a
   * conditional property means a spread. EVL004 exempts a spread in the factory
   * body and flags one anywhere else, so this is the only place the merge can
   * live. Emitting `maximumDurationSeconds: undefined` instead would serialize
   * an explicit null, which is the shape that put `baseImageArn: null` on a
   * cluster and had the service reject it.
   */
  const classMetadata = { name: props.names.vmClass, namespace: props.namespace, labels: props.labels };
  const classSpecBase = {
    description: props.profile.intent,
    maxIdleDurationSeconds: profileClass?.maxIdleDurationSeconds,
    suspendedDurationSeconds: profileClass?.suspendedDurationSeconds,
    autoResumeEnabled: profileClass?.autoResumeEnabled,
    ingressNetworkConnectors: profileClass?.ingressNetworkConnectors,
    egressNetworkConnectors: profileClass?.egressNetworkConnectors,
  };
  const maximumDuration = profileClass?.maximumDurationSeconds;
  const classSpec = maximumDuration
    ? { ...classSpecBase, maximumDurationSeconds: maximumDuration }
    : classSpecBase;
  const vmClass = profileClass ? new MicroVMClass({ metadata: classMetadata, spec: classSpec }) : undefined;

  const network = profileNetwork ? buildNetwork(props, profileNetwork) : undefined;

  /**
   * The spec a VM runs with, shared verbatim between the single-VM and
   * replica-set shapes — `MicroVMReplicaSet.spec.template` is the MicroVM spec
   * inline, with no metadata wrapper, so one object serves both.
   */
  const vmSpecBase = {
    imageRef: props.names.image,
    desiredState: "Running",
    region: props.region,
    tags: props.tags,
  };
  // The create call requires an idle policy from somewhere (see IdleProfile
  // in ../lib/tiers.ts): by class name where the tier declares a class, flat
  // on the VM spec where it does not.
  const profileVmIdle = props.profile.vmIdle;
  const vmSpecWithClass = profileClass
    ? { ...vmSpecBase, className: props.names.vmClass }
    : profileVmIdle
      ? {
          ...vmSpecBase,
          maxIdleDurationSeconds: profileVmIdle.maxIdleDurationSeconds,
          suspendedDurationSeconds: profileVmIdle.suspendedDurationSeconds,
          autoResumeEnabled: profileVmIdle.autoResumeEnabled,
        }
      : vmSpecBase;
  const vmSpec = profileNetwork ? { ...vmSpecWithClass, networkRef: props.names.network } : vmSpecWithClass;
  const vmMetadata = { name: props.names.vm, namespace: props.namespace, labels: props.labels };

  const workload = props.profile.workload;
  const isSingle = workload.kind === "MicroVM";
  const vm = isSingle ? new MicroVM({ metadata: vmMetadata, spec: vmSpec }) : undefined;
  const replicaSet = workload.kind === "MicroVMReplicaSet" ? buildReplicaSet(props, workload, vmSpec) : undefined;

  return {
    image,
    ...(vmClass ? { vmClass } : {}),
    ...(network ? { network } : {}),
    ...(vm ? { vm } : {}),
    ...(replicaSet ? { replicaSet } : {}),
  };
}, "MicrovmWorkload");
