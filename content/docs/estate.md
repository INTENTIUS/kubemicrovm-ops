---
title: The estate
weight: 20
---

# The estate

What a KubeMicroVM consumer actually operates, split by plane. The kit declares both planes in one chant project so one build, one lint pass, and one graph cover the whole thing.

## AWS plane

| Resource | Source today | Kit declaration |
|----------|-------------|-----------------|
| Operator IAM role + managed policy | `iam/kube-microvm-operator-role.yaml` CFN template | aws lexicon, typed port of the upstream template |
| Pod Identity association | `aws eks create-pod-identity-association` CLI call | aws lexicon (`AWS::EKS::PodIdentityAssociation`) |
| Build role (`KubeMicroVMBuildRole`) | Manual | aws lexicon |
| S3 bucket + code artifacts for image sources | Manual | aws lexicon |
| VPC subnets + security groups for `MicroVMNetwork` egress | Existing VPC, referenced by ID | Parameters by default, declarable for full-provision tier |
| EKS cluster | Existing | Parameter by default, declarable in the full-provision tier |

The operator role is deployed once per region and shared across clusters through per-cluster pod identity associations. The kit preserves this shape. The role stack is a singleton component, associations are per-cluster.

## Kubernetes plane

| Resource | Notes |
|----------|-------|
| Operator namespace + Helm release | Chart at `oci://ghcr.io/codriverlabs/helm/kube-microvm-operator`, pinned version |
| Workload namespaces | Must carry `lambda.aws.amazon.com/manage-microvms=true`, enforced by the webhook |
| `MicroVMImage` | Builds an image from an S3 source, needs `buildRoleArn` |
| `MicroVM` | One instance, references an image, has desired state and idle policy |
| `MicroVMReplicaSet` | Pool of identical replicas |
| `MicroVMNetwork` | VPC egress connector configuration |
| `MicroVMClass` | Named runtime profile, referenced by VMs |
| Consumer pods with `lambda.microvm.auth` annotations | Token injection targets |

## Cross-plane edges

These are the references that today exist only as strings and that the kit turns into checked edges.

`MicroVMImage.spec.buildRoleArn` points at the build role. `MicroVMImage.spec.source` points at an S3 bucket and key. `MicroVMNetwork` references subnet and security group IDs. The pod identity association binds the operator's service account name and namespace to the operator role ARN. Each of these crosses the plane boundary, and each is a place where a typo deploys cleanly on one side and fails at runtime on the other.

## Tiers

Following the loom-on-chant tiering, the kit targets two shapes.

The reference-existing tier takes cluster name, VPC IDs, and optionally existing IAM as parameters and declares only what KubeMicroVM itself needs. This is the adoption default.

The full-provision tier additionally declares the EKS cluster, VPC, and S3 bucket for teams standing up an isolated MicroVM environment from nothing.
