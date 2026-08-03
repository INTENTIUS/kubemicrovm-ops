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

## In the kit today

`src/golden-image/` declares it, behind a seam that is off by default:

```
chant build src/golden-image --lexicon aws --param goldenImageMode=provision
```

Three resources come out: the `AWS::Lambda::MicrovmImage`, and the build and execution roles the service assumes. Memory comes from the same tier profile the CRD path reads, so a golden image and a kit-declared image at the same tier are the same size — though the two spell it differently, `Resources: [{ MinimumMemoryInMiB }]` against `spec.memorySizeMiB`, which is the sort of drift declaring both planes in one project is meant to catch.

It is off by default deliberately. A deployment that declares its own `MicroVMImage` needs none of this, and turning it on for symmetry would build a second image nothing references.

Until recently the composite was not reachable at all: it was exported from the aws lexicon's `composites/index` but missing from the package root, so `import { MicrovmApp } from "@intentius/chant-lexicon-aws"` failed. Fixed in [chant#1219](https://github.com/INTENTIUS/chant/issues/1219) and released in `@intentius/chant-lexicon-aws@0.37.1`, which is what this kit now takes.

## Reuse into the kit

Two pieces of `MicrovmApp` should carry over and do not yet. Its validation constants for memory tiers and connector limits are the source for KMV003 and KMV006, and are currently declared a second time in `src/lib/tiers.ts` — the lint pack should collapse that rather than let two copies drift. They are not exported from the lexicon today, so collapsing them means exporting them first. Its IAM shapes, verified against the upstream CDK construct and AWS docs, already informed the typed port of KubeMicroVM's build role.
