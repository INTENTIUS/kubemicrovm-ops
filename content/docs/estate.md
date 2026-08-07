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
| VPC subnets + security groups for `MicroVMNetwork` egress | Existing VPC, referenced by ID | Referenced by default; `clusterMode=provision` declares a 2-AZ `VpcDefault` and the readbacks point at it |
| EKS cluster + node group | Existing | Referenced by default; `clusterMode=provision` declares the aws lexicon's `EksCluster` composite, node group sized by tier, pod-identity agent add-on included |

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

## What the snapshot keeps

A MicroVM image is a snapshot, and everything that goes into building it stays in it: the artifact's contents, the Dockerfile's `ENV` lines, and — on the CloudFormation path, where `AWS::Lambda::MicrovmImage` accepts `EnvironmentVariables` — anything passed as image environment. Every VM cloned from the image carries all of it, for as many versions as `maxVersionsToKeep` retains. A secret placed in any of those is a secret at rest in an artifact nothing rotates; KMV023 refuses the obviously-named ones at build time, and the rest is on the artifact's author. Secrets belong on the runtime side — the operator's token delivery, or your own at `RunMicrovm` time — never in the image.

## Cross-plane edges

These are the references that today exist only as strings and that the kit turns into checked edges.

`MicroVMImage.spec.buildRoleArn` points at the build role. `MicroVMImage.spec.source` points at an S3 bucket and key. `MicroVMNetwork` references subnet and security group IDs. The pod identity association binds the operator's service account name and namespace to the operator role ARN. Each of these crosses the plane boundary, and each is a place where a typo deploys cleanly on one side and fails at runtime on the other.

## Tiers

Three named tiers, `minimal`, `prod` and `prod-ha`, parameterised off `naming.tier` with no tier-specific files. Whether the kit provisions a given prerequisite or references one you already have is a separate per-resource setting, not a tier. Both are on [Tiers and targets]({{< relref "tiers" >}}), along with the local and real deploy targets that cut across them.

The "Kit declaration" column above describes the reference-existing default. Every referenced row is a seam that can be switched to provision instead — including the cluster itself: `KMV_CLUSTER_MODE=provision` makes the kit declare its own VPC and EKS cluster and stand the whole estate on them, which is how the real-AWS validation runs deploy. Full provision is no longer a deferred shape; it is a mode this page's table describes and the tier matrix tests.
