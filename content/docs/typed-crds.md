---
title: Typed CRDs
weight: 30
---

# Typed CRDs

## Path

The chant k8s lexicon generates typed constructors from CRD schemas on demand, per project. That is the settled approach from chant's CRD catalog decision. Nothing gets vendored into the lexicon. This kit runs the generation against KubeMicroVM's CRDs and keeps the generated types in-repo, pinned to a KubeMicroVM release.

The five inputs, all under `lambda.aws.amazon.com/v1alpha1`.

| CRD | Constructor |
|-----|-------------|
| `MicroVM` | `K8s.MicroVM` |
| `MicroVMImage` | `K8s.MicroVMImage` |
| `MicroVMReplicaSet` | `K8s.MicroVMReplicaSet` |
| `MicroVMNetwork` | `K8s.MicroVMNetwork` |
| `MicroVMClass` | `K8s.MicroVMClass` |

## Version pinning

Generated types are pinned to the KubeMicroVM release whose CRDs produced them, recorded in the repo. When KubeMicroVM ships a new release the regeneration is a reviewable diff. The chant lexicon self-upgrade pattern applies here at kit level. A pinned bump arrives as a PR.

## What typing buys

The CRD schemas are openAPIV3Schema, so structural typing comes straight from generation. Field names, enums such as `desiredState`, required properties, and integer bounds all surface in the IDE before any cluster is involved.

What the schema cannot express moves to the lint pack. Cross-resource references, the namespace label requirement, service limits that the schema types as open integers. See [Lint rules]({{< relref "lint-rules" >}}).

## Open items

The exact spec shapes need verification against the shipped CRDs rather than the docs. Known from the upstream README and user guides so far. `MicroVM.spec` carries `imageRef`, `desiredState`, `maxIdleDurationSeconds`, `suspendedDurationSeconds`. `MicroVMImage.spec` carries `source.s3Bucket`, `source.s3Key`, `baseImageArn`, `buildRoleArn`, memory sizing. Class reference and replica set field names are unverified. The first milestone extracts the CRD YAML from the Helm chart and locks these down.

Status subresources are operator-owned and out of scope for declaration. They matter for the lifecycle surface, where `chant lifecycle` snapshots can read them for readiness and drift context.
