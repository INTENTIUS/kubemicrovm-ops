---
title: Relation to MicrovmApp
weight: 70
---

# Relation to MicrovmApp

chant's aws lexicon already ships `MicrovmApp` (chant issue #879), a composite that emits `AWS::Lambda::MicrovmImage`, the build and execution IAM roles, and optionally a `NetworkConnector` with its deny-all security group. It deploys through CloudFormation directly, no cluster involved.

That composite and this kit are two paths to the same service, and they differ by where the reconcile loop lives.

| | `MicrovmApp` | kubemicrovm-ops |
|---|---|---|
| Control plane | CloudFormation | KubeMicroVM operator on EKS |
| Resource model | CFN types | Kubernetes CRs |
| Replica pools, classes, idle policy | Not provided | Operator features |
| Token delivery to workloads | Caller's problem | Sidecar injection |
| Cluster required | No | Yes |
| Fit | Standalone MicroVM apps, CI-driven image builds | Teams whose workloads already live on Kubernetes |

## They compose

A project can use both. `MicrovmApp` provisions shared, slow-moving assets, the golden images and their build roles, through plain CFN in CI. The kit's CRs then drive fast-moving per-session VMs against those images from the cluster. Both planes sit in one chant project, one graph, one lint pass, and the image ARN reference between them is a checked edge rather than a pasted string.

## Reuse into the kit

Two pieces of `MicrovmApp` carry over directly. Its validation constants for memory tiers and connector limits become the source for KMV003 and KMV006. Its IAM shapes, verified against the upstream CDK construct and AWS docs, inform the typed port of KubeMicroVM's build role. The kit should import or mirror these rather than re-derive them.
