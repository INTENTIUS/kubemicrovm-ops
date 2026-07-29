---
title: Lint rules
weight: 40
---

# Lint rules

The kit ships a lint pack with the `KMV` prefix. The principle is the same one the chant lexicons follow. Anything answerable from the declared source is checked at build time. The operator's webhook and the MicroVM service remain the runtime authority. The lint pack mirrors them so their rejections arrive before apply, all at once, with source locations.

Declarative rules run against the resource graph. Post-synth checks run against the serialized output. Numbering follows chant convention, declarative from KMV001, post-synth from KMV020.

## Declarative rules

| Rule | Check |
|------|-------|
| KMV001 | Every MicroVM CR sits in a namespace declared with the `lambda.aws.amazon.com/manage-microvms=true` label. Mirrors the webhook's namespace enforcement. |
| KMV002 | `imageRef` on a `MicroVM` or `MicroVMReplicaSet` resolves to a declared `MicroVMImage` in the same namespace. |
| KMV003 | Image memory is one of the five service tiers, 512, 1024, 2048, 4096, 8192 MiB. The schema types this as an open integer, the service does not. |
| KMV004 | A class reference on a VM resolves to a declared `MicroVMClass`. |
| KMV005 | `buildRoleArn` on a `MicroVMImage` matches a role declared in the AWS plane of the same project, and a `iam:PassRole` grant covers it. Skipped when IAM is referenced by parameter rather than declared. |
| KMV006 | `MicroVMNetwork` respects service limits on subnet count and egress connectors. Bounds mirror the chant `MicrovmApp` composite's validation, 1 to 16 subnets, at most 10 egress connectors. |
| KMV007 | A pod annotated `lambda.microvm.auth` references a declared `MicroVM` in a reachable namespace. |
| KMV008 | Idle and suspend durations are coherent, suspend threshold not shorter than idle threshold. |

## Post-synth checks

| Check | What it validates |
|-------|-------------------|
| KMV020 | Serialized CR set contains no image that is never referenced by a VM, replica set, or class. Warning, not error. |
| KMV021 | The operator Helm release version and the CRD schema pin agree. Guards against typed source drifting from the installed operator. |
| KMV022 | Every namespace the output touches is either the operator namespace or carries the manage label. |

## Sources of truth for each rule

KMV001 and KMV022 mirror the admission webhook. KMV002, KMV004, and KMV007 are reference-resolution rules that exist because the schema stores them as plain strings. KMV003 and KMV006 mirror service limits documented upstream and already encoded once in chant's `MicrovmApp` composite. KMV005 is the cross-plane rule and the main reason the kit declares both planes in one project.

Rule details will move to one page per rule once implementation starts, matching the chant lexicon docs layout.
