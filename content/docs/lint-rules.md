---
title: Lint rules
weight: 40
---

# Lint rules

Six rules are implemented across two mechanisms, and which mechanism a rule needs is the most useful thing on this page.

`.chant/rules/kmv-spec-values.ts` holds the ones that read **one file**: is this memory size real, is this field set, is this enum value one the service takes. Those are `LintRule`s, auto-discovered from the directory.

`.chant/policies/kmv-estate.ts` holds the ones that read **the whole build**: does the namespace this resource names exist and carry the label, does this reference resolve. Those are `PostSynthCheck`s, listed in `chant.config.ts` under `lint.policies`, and they run against every serialized output at once. A source rule cannot answer either question, because both are about two files.

The rest are designed and not built — [#15](https://github.com/INTENTIUS/kubemicrovm-ops/issues/15) carries them.

The kit ships a lint pack with the `KMV` prefix. The principle is the same one the chant lexicons follow. Anything answerable from the declared source is checked at build time. The operator's webhook and the MicroVM service remain the runtime authority. The lint pack mirrors them so their rejections arrive before apply, all at once, with source locations.

Declarative rules run against the resource graph. Post-synth checks run against the serialized output. Numbering follows chant convention, declarative from KMV001, post-synth from KMV020.

## Implemented

Each of these was found by deploying the kit against a local target, not by reading a schema. All three are accepted by the API server, permitted by the CRD, and refused by the service — so without them the failure arrives minutes later, in a controller log, with nothing pointing at the line that caused it.

| Rule | Check | The runtime error it replaces |
|------|-------|------------------------------|
| KMV003 | `memorySizeMiB` is one of the service's five sizes | Silently wrong compute, or a rejected create |
| KMV009 | A `MicroVMImage` spec sets `baseImageArn` | `Value null at 'baseImageArn' failed to satisfy constraint: Member must not be null`, on every reconcile, forever |
| KMV010 | `networkProtocol` is `IPv4` or `DualStack` | `Member must satisfy enum value set: [IPv4, DualStack]` — the connector never leaves `PENDING` and every VM behind it stays `Pending` |

They match on the **shape of a spec object literal** rather than on the constructor it is passed to. The kit builds its specs as named consts and hands the identifier to `new MicroVMImage({ spec })`, so a rule keyed on the constructor would see an identifier and nothing else. What identifies an image spec is carrying both `buildRoleArn` and `source`; a connector spec, `connectorName`. That is looser than a type check, and it is what a source-level rule can see.

The first cut of KMV009 was looser still — it treated `maxVersionsToKeep` as an image-spec marker, and fired on the three tier profiles in `src/lib/tiers.ts`, which are not specs and correctly carry no base image. Requiring both markers fixed it, and `test/lint-pack.test.ts` asserts the kit's own source stays clean so the next loosening is caught.

### The fixtures

`test/fixtures/broken/` holds one deliberately-wrong file per rule, each a faithful copy of a mistake that was actually made. `test/lint-pack.test.ts` asserts each fails its own rule and no other, that the diagnostic carries a line number, and that `test/fixtures/ok.ts` fails none of them — a rule that fires on everything catches nothing.

This is the beginning of M2's webhook-rejection test. It is not the whole of it: the exit criterion is every admission-time failure the upstream UAT exercises, and this is three.

## Implemented: estate-level

These run after synthesis, over every emitted document. `test/fixtures/estate-broken/` is a source that fails both, and `test/estate-policies.test.ts` drives it through a real `chant build` rather than calling the checks directly — half of what is being tested is the wiring, and a policy listed in the config that never loads would pass a unit test and catch nothing.

| Rule | Check | The runtime error it replaces |
|------|-------|------------------------------|
| KMV001 | Every custom resource sits in a namespace this build declares with `lambda.aws.amazon.com/manage-microvms=true` | The admission webhook rejects the resource and names the *resource*, when what is wrong is a `Namespace` in another file |
| KMV002 | `imageRef`, `className` and `networkRef` resolve to something declared in the same namespace | Nothing. The resource applies cleanly and never becomes ready, with no error anywhere |
| KMV020 | An image nothing references. Warning, not error | Nothing — a built image that never runs |

Two limits worth stating rather than discovering. The reader these use is structural rather than a YAML parser, because it reads chant's own emissions and needs `apiVersion`, `kind`, `metadata` and one level of `spec`. It does not descend into `MicroVMReplicaSet.spec.template`, so a replica set's references are checked by `test/tier-matrix.test.ts` and not by KMV002 — and KMV020 skips a build with no bare `MicroVM` in it rather than report a false orphan.

## Designed, not built

| Rule | Check |
|------|-------|
| KMV001 | Every MicroVM CR sits in a namespace declared with the `lambda.aws.amazon.com/manage-microvms=true` label. Mirrors the webhook's namespace enforcement. |
| KMV002 | `imageRef` on a `MicroVM` or `MicroVMReplicaSet` resolves to a declared `MicroVMImage` in the same namespace. |
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
