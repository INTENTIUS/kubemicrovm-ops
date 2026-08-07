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

import { AWS, EksCluster, FlowLog, LogGroup, Role, SecurityGroup, Sub, VpcDefault } from "@intentius/chant-lexicon-aws";
import { kmvNaming } from "../lib/naming";
import { clusterMode, connectorEgressPorts, namingParams, nodegroupShape, tier } from "./params";

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
        // Without the agent, the pod identity association delivers no
        // credentials and the operator crashloops on aws-connectivity DOWN —
        // the first real converge proved it.
        addons: [{ name: "eks-pod-identity-agent" }],
        tags,
      })
    : undefined;

/**
 * The connector's egress posture, owned because the kit provisioned it.
 *
 * Without this, build-estate.sh handed the connector the EKS cluster's own
 * security group — functional, and wide open. The kit applies no posture to
 * security groups it referenced (yours are yours), but "the kit provisioned
 * it" should mean the secure default: this SG's rules ARE the egress policy —
 * declaring any egress removes CloudFormation's implicit allow-all — and the
 * declared allows come from one param (connectorEgressPorts, default 443:
 * registries, package mirrors, Bedrock). No ingress: connector traffic
 * originates outbound, and the stateful return path needs no rule.
 */
const egressRules = connectorEgressPorts.map((port) => ({
  IpProtocol: "tcp",
  FromPort: port,
  ToPort: port,
  CidrIp: "0.0.0.0/0",
  Description: `connector egress, declared (port ${port})`,
}));
const connectorSgName = naming.name("connector-egress", { service: "k8sObject" });

export const connectorSecurityGroup =
  clusterMode === "provision" && network
    ? new SecurityGroup({
        GroupDescription: "MicroVM connector egress - deny-all except the declared ports; the rules are the policy.",
        GroupName: connectorSgName,
        VpcId: network.vpc.VpcId,
        SecurityGroupEgress: egressRules,
        Tags: tags,
      })
    : undefined;

/**
 * REJECT flow logs on the provisioned VPC: the record of what the posture
 * above refused. REJECT-only on purpose — accepted traffic is the estate
 * working, and logging it buys volume, not signal.
 */
const flowLogGroupName = `/kmv/${naming.name("vpc-flow-rejects", { service: "k8sObject" })}`;

export const flowLogGroup =
  clusterMode === "provision" && network
    ? new LogGroup({ LogGroupName: flowLogGroupName, RetentionInDays: 30 })
    : undefined;

const flowLogRoleName = naming.name("flow-logs", { service: "iamRole" });

export const flowLogRole =
  clusterMode === "provision" && network
    ? new Role({
        RoleName: flowLogRoleName,
        AssumeRolePolicyDocument: {
          Version: "2012-10-17",
          Statement: [
            { Effect: "Allow", Principal: { Service: "vpc-flow-logs.amazonaws.com" }, Action: "sts:AssumeRole" },
          ],
        },
        Policies: [
          {
            PolicyName: "DeliverFlowLogs",
            PolicyDocument: {
              Version: "2012-10-17",
              Statement: [
                {
                  Effect: "Allow",
                  Action: ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogGroups", "logs:DescribeLogStreams"],
                  Resource: Sub`arn:${AWS.Partition}:logs:${AWS.Region}:${AWS.AccountId}:log-group:${flowLogGroupName}:*`,
                },
              ],
            },
          },
        ],
        Tags: tags,
      })
    : undefined;

export const vpcFlowLog =
  clusterMode === "provision" && network && flowLogGroup && flowLogRole
    ? new FlowLog({
        ResourceId: network.vpc.VpcId,
        ResourceType: "VPC",
        TrafficType: "REJECT",
        LogDestinationType: "cloud-watch-logs",
        LogGroupName: flowLogGroupName,
        DeliverLogsPermissionArn: flowLogRole.Arn,
        Tags: tags,
      })
    : undefined;
