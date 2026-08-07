---
title: Typed CRDs
weight: 30
---

# Typed CRDs

## Path

Settled, and not the way this page originally described it. The generation is not per-project: CRD sources are a curated list inside the chant k8s lexicon, fetched and code-generated at lexicon build time. KubeMicroVM's five are in that list as of `@intentius/chant-lexicon-k8s@0.35.0`, read straight out of the published chart by a `helm` source type added for the purpose ([chant#1306](https://github.com/INTENTIUS/chant/pull/1306)) — of the five CRDs exactly one is committed to their repo, so a URL source reaches one of five.

So the kit vendors no generated types. It imports them:

```ts
import { MicroVM, MicroVMImage, MicroVMReplicaSet, MicroVMNetwork, MicroVMClass }
  from "@intentius/chant-lexicon-k8s";
```

The five, all under `lambda.aws.amazon.com/v1alpha1`. The `lambda.aws.amazon.com` group maps to the `KubeMicroVM` namespace rather than `Lambda`, which would read as AWS Lambda proper and sit confusingly beside the aws lexicon's real Lambda functions.

| CRD | Resource type |
|-----|---------------|
| `MicroVM` | `K8s::KubeMicroVM::MicroVM` |
| `MicroVMImage` | `K8s::KubeMicroVM::MicroVMImage` |
| `MicroVMReplicaSet` | `K8s::KubeMicroVM::MicroVMReplicaSet` |
| `MicroVMNetwork` | `K8s::KubeMicroVM::MicroVMNetwork` |
| `MicroVMClass` | `K8s::KubeMicroVM::MicroVMClass` |

Needs 0.36.0 or later. Before that the generated classes had no `metadata` property at all, because four of the five CRDs are Fabric8-generated and declare only `spec` and `status` — so a namespaced resource had no way to be given a name without a cast ([chant#1309](https://github.com/INTENTIUS/chant/issues/1309)).

## Version pinning

Generated types are pinned to the KubeMicroVM release whose CRDs produced them, recorded in the repo. When KubeMicroVM ships a new release the regeneration is a reviewable diff. The chant lexicon self-upgrade pattern applies here at kit level. A pinned bump arrives as a PR.

## What typing buys, and what it does not

Less than this page first claimed. The generated constructor takes `metadata: ObjectMeta` and `spec: Record<string, unknown>` — the spec is deliberately opaque in the `.d.ts`, the same as every built-in kind's, with the rich shape carried through LSP, validation and MCP rather than through the constructor type. So the compiler does not catch a misspelled `className`.

The kit closes that gap itself, in `test/tier-matrix.test.ts`: it builds all three tiers and checks every emitted spec field against the CRD schemas in `crds/`, copied from the same pinned chart. The API server accepts an unknown field and the controller ignores it, so a typo is a VM silently running with the wrong policy — a real failure with no error attached to it.

What the schema cannot express at all moves to the lint pack: cross-resource references, the namespace label requirement, service limits the schema types as open integers. Three of those turned out to matter immediately — see [Running the local target]({{< relref "local-target" >}}) for `baseImageArn`, `networkProtocol` and `memorySizeMiB`, each of which the schema permits and the service refuses.

## Verified spec shapes

Read off the shipped CRDs at the pinned chart (1.0.12; byte-identical to 1.0.11's) rather than the upstream docs, which is how two assumptions on this site got corrected.

`MicroVM.spec` carries `imageRef`, `imageVersion`, `desiredState` (`Running` / `Suspended` / `Terminated`), `className`, `networkRef`, `templateRef`, `autoResumeEnabled`, `maxIdleDurationSeconds`, `suspendedDurationSeconds`, `maximumDurationSeconds`, `ingressNetworkConnectors`, `egressNetworkConnectors`, `executionRoleArn`, `region`, `tags`, `importMicroVmId` and `runHookPayload`. The class is referenced by `className`, not a `classRef`.

`MicroVMImage.spec` carries `source.s3Bucket`, `source.s3Key`, `baseImageArn`, `buildRoleArn`, `buildTimeoutSeconds`, `maxVersionsToKeep`, `autoActivate`, `region` and **`memorySizeMiB`** — memory is a property of the image, not of the class, and `MicroVMClass` has no memory field.

`MicroVMReplicaSet.spec` carries `replicas`, `minReady`, `maxSurge`, `maxUnavailable`, `updateStrategyType`, `desiredReplicaSetState`, `scaleDown.{policy,stabilizationWindowSeconds}` and `template` — where `template` is the MicroVM spec **inline, with no metadata wrapper**, unlike a Kubernetes `ReplicaSet`.

`MicroVMClass.spec` carries `description` and the idle and lifetime policy: `maxIdleDurationSeconds`, `suspendedDurationSeconds`, `autoResumeEnabled`, `maximumDurationSeconds`, and the two connector lists.

`MicroVMNetwork.spec` carries `connectorName`, `networkProtocol`, `operatorRoleArn`, `region`, `subnetIds`, `securityGroupIds` and `tags`.

Status subresources are operator-owned and out of scope for declaration. They matter for the lifecycle surface, where `chant lifecycle` snapshots can read them for readiness and drift context.
