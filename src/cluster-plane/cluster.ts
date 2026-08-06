/**
 * The cluster plane: a 2-AZ VPC and the EKS cluster with its node group,
 * from the aws lexicon's own composites (`VpcDefault`, `EksCluster`) —
 * nothing here is hand-rolled network or IAM.
 *
 * Declared only when `clusterMode=provision` (the seam, not the tier: any
 * tier can provision or reference). The tier shapes the node group's size;
 * the control plane and VPC are tier-invariant because EKS requires two AZs
 * regardless — see NODEGROUP_BY_TIER in ./params.ts.
 *
 * Downstream wiring is readback, not reference: the workload build reads the
 * subnet/SG/cluster names off the deployed stack (scripts/install/
 * build-estate.sh), the same two-planes-agree pattern the AWS plane uses for
 * its bucket and roles.
 */

import { EksCluster, VpcDefault } from "@intentius/chant-lexicon-aws";
import { kmvNaming } from "../lib/naming";
import { clusterMode, namingParams, nodegroupShape, tier } from "./params";

const naming = kmvNaming(namingParams);
const tags = Object.entries(naming.tags()).map(([Key, Value]) => ({ Key, Value }));

const clusterName = naming.name("cluster", { service: "k8sObject" });
const ngShape = nodegroupShape(tier);

/** The 2-AZ network EKS requires: public+private subnets per AZ, one NAT. */
export const network = clusterMode === "provision" ? VpcDefault({ azCount: 2 }) : undefined;

// Bound to consts so the declaration stays statically evaluable.
const privateSubnetIds = network
  ? [network.privateSubnet1.SubnetId, network.privateSubnet2.SubnetId]
  : undefined;

export const cluster =
  clusterMode === "provision" && privateSubnetIds
    ? EksCluster({
        name: clusterName,
        subnetIds: privateSubnetIds,
        nodegroup: {
          desiredSize: ngShape.desiredSize,
          minSize: ngShape.desiredSize,
          maxSize: ngShape.maxSize,
        },
        tags,
      })
    : undefined;
