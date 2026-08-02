---
title: Tiers and targets
weight: 25
---

# Tiers and targets

The kit ships one source tree. Three axes vary independently over it, and keeping them separate is what stops the matrix collapsing into a pile of per-environment files.

A *tier* is how much estate you want. `KMV_TIER` selects it, and no tier has its own files.

A *target* is where that estate deploys. Any tier can deploy to either target, and the target is chosen by whether `AWS_ENDPOINT_URL` is set. Nothing else in the source changes.

An *adoption seam* is whether the kit provisions a given prerequisite, references one you already have, or leaves it out. Seams are per-resource and independent of both tier and target.

## Tiers

Every row below is a field KubeMicroVM's own CRDs define at the pinned chart release. Nothing is invented to make the table symmetrical: where a tier has no answer for a knob, the resource carrying that knob is not declared at all. The table and `src/lib/tiers.ts` are the same thing written twice, and `test/tier-matrix.test.ts` checks the second one against the shipped schemas.

| | `minimal` | `prod` | `prod-ha` |
|---|---|---|---|
| Intended use | Evaluate the kit, one namespace, laptop or dev cluster | Adoptable single-AZ deployment | Adoptable multi-AZ deployment |
| Which resource holds the VMs | One `MicroVM` | `MicroVMReplicaSet`, `replicas: 1` | `MicroVMReplicaSet`, `replicas: 2` |
| Rolling update | Not applicable | `maxSurge: 1`, `maxUnavailable: 0`, `minReady: 1` | Same, `minReady: 2` |
| `MicroVMImage.spec.memorySizeMiB` | 2048 | 4096 | 4096 |
| `MicroVMImage.spec.maxVersionsToKeep` | 2 | 5 | 5 |
| `MicroVMClass` | Not declared | Declared, VMs reference it by `className` | Declared |
| Idle policy | Service defaults | `maxIdleDurationSeconds: 900`, `autoResumeEnabled: true`, `suspendedDurationSeconds: 3600` | Same |
| Lifetime cap | None | None | `maximumDurationSeconds: 28800` |
| `MicroVMNetwork` | Not declared, managed egress | Declared, `IPv4`, one subnet | Declared, `IPv4`, two subnets |
| AWS prerequisites | S3 bucket, build role | Plus the operator role as the connector's `operatorRoleArn`, subnets, security groups | Plus a second availability zone's subnet |
| Quota discovery | Off | On | On |

Two things that table corrects, because both are easy to assume the other way round:

**Memory is a property of the image, not of the class.** `MicroVMImage.spec.memorySizeMiB` is where a VM's memory comes from. `MicroVMClass` carries the idle and lifetime policy — `maxIdleDurationSeconds`, `suspendedDurationSeconds`, `autoResumeEnabled`, `maximumDurationSeconds` and the connector lists — and has no memory field at all.

**The image name carries the tier.** `MicroVMImage.spec.memorySizeMiB` is immutable after creation and the webhook rejects a change, so an image named without the tier would make `minimal` to `prod` an apply that cannot succeed. Named with it, the two tiers own two images.

**A replica set's `template` is the MicroVM spec inline.** There is no metadata wrapper the way there is in a Kubernetes `ReplicaSet`, so the same object serves both shapes and the kit builds it once.

The memory sizes named here are the service's five runtime profiles (512, 1024, 2048, 4096, 8192). They are unrelated to deployment tiers and the collision in the word is unfortunate. Where the docs say "tier" without qualification they mean the deployment tier in this table.

Constant across every tier: the five CRDs, the operator install, the namespace label the webhook enforces, the cross-plane edges the lint pack checks, and the naming scheme.

## Targets

| Target | Selected by | What runs | Cost |
|--------|-------------|-----------|------|
| Local | `AWS_ENDPOINT_URL` set | floci for the AWS plane, [m80](https://github.com/INTENTIUS/m80) for the MicroVMs API, k3d instead of EKS, real operator, real pods | Free, runs per commit |
| Real | `AWS_ENDPOINT_URL` unset | Live AWS and a live EKS cluster | Billed |

The local target is two endpoints rather than one, because the estate spans two planes and the emulators are split the same way.

| Variable | Points at | Serves |
|----------|-----------|--------|
| `AWS_ENDPOINT_URL` | floci | S3 bucket, build role, pod identity association, VPC references |
| `AWS_MICROVM_ENDPOINT` | m80 | The MicroVMs API the operator itself calls |

Both emulators use account `000000000000`, so ARNs minted by floci feed m80 with nothing rewritten. Verified by hand on 2026-08-02: floci created a bucket and a build role, and `CreateMicrovmImage` on m80 accepted both and built through to `SUCCESSFUL`.

The Kubernetes half of the local target is not emulated at all. It is a real cluster running the real operator, reconciling real custom resources, scheduling real pods. Only the AWS side is stood in for.

## What the local target cannot cover

The kit's own claim about local testing has to be bounded, in the same place a reader meets the claim, or the boundary gets discovered at the worst moment.

The operator calls exactly four AWS SDK clients: `lambdamicrovms`, `lambdacore`, `sts` and `servicequotas`. Those calls are what the local target intercepts. What it cannot intercept is what AWS then does because of them. Handed a build role ARN and an S3 URI, the real MicroVMs service assumes that role and fetches that object itself, inside AWS's implementation of a service being called. There is no request to redirect and no endpoint to override. The same holds for the connector operator role, for the ENIs EC2 creates against it, and for every real IAM authorisation decision.

So the local target validates that the estate declares and reconciles correctly. It does not validate that AWS will accept the roles at runtime. That distinction is the one thing on this page most worth carrying into the README.

## Recipes

One recipe per tier and target pair, following loomster's `production-floci-e2e` and `production-live-e2e` shape. The word is `local` rather than `floci` here because the local target is three pieces, not one.

```
just minimal-local-e2e     # k3d + floci + m80 + operator, minimal tier
just prod-local-e2e
just prod-ha-local-e2e

just minimal-live-e2e      # real EKS, real AWS. Costs money.
just prod-live-e2e
just prod-ha-live-e2e
```

`minimal` and `prod-ha` run on every push and pull request, on a hosted runner with no AWS account — `.github/workflows/local-e2e.yml`. It applies `prod-ha` over a live `minimal` estate rather than from scratch, so the tier change is exercised too, and asserts convergence rather than a clean apply: the image reaching `SUCCESSFUL`, the connector `ACTIVE`, and `readyReplicas` equal to the tier's floor. `prod` declares nothing `prod-ha` does not, so it is checked by the tier matrix and not deployed.

The live recipes are on-demand, gated, and each one names its cost in its comment.

## Adoption seams

Every AWS-plane prerequisite carries a seam of `provision`, `reference-existing` or `omit`. Seams are independent of tier, so a `minimal` deploy can reference an existing VPC and a `prod` deploy can provision one.

This replaces the two-shape split the [estate]({{< relref "estate" >}}) page originally described. Reference-existing versus full-provision is not a tier, it is a per-resource setting, and treating it as a tier forced unrelated choices to move together.

### The full-provision decision

The [roadmap]({{< relref "roadmap" >}}) left this open, leaning reference-existing only until someone asked. The reasoning behind that lean was cost: every test of a provisioning path meant standing up an EKS cluster. Against the local target it costs nothing, and what provisioning code needs checking, that the estate declares correctly, is exactly what the local target can check.

The decision is to split it rather than answer it once.

`provision` is built for the AWS-plane prerequisites the operator needs to function at all: the S3 bucket, the build role, the operator role and its pod identity association. These are the resources their `setup-test-env.sh` creates by hand today, they are what the kit replaces in [#6](https://github.com/INTENTIUS/kubemicrovm-ops/issues/6), and the local target validates them for free.

`provision` is deferred for the EKS cluster and the VPC. Those default to `reference-existing`. Nobody adopting this kit is standing up their first cluster with it, the local target substitutes k3d for EKS so it would validate the least useful part, and deferring costs nothing because the seam already exists to fill in later.

## What has been validated

Filled in as each cell is actually run, rather than written from what the code implies.

| Tier | Local | Real |
|------|-------|------|
| `minimal` | **Deployed end to end 2026-08-02.** Image built to `SUCCESSFUL` on m80, MicroVM reached `Running`, operator confirmed connectivity | Not run |
| `prod` | Builds and lints clean; every emitted field checked against the pinned CRD schemas. Not applied on its own — `prod-ha` covers the same resource set | Not run |
| `prod-ha` | **Deployed end to end 2026-08-02.** `MicroVMReplicaSet` 2/2 ready, both VMs `Running`, `MicroVMNetwork` connector `ACTIVE`, `MicroVMClass` applied. Deployed over a live `minimal` estate, so the tier change is exercised too | Not run |

Everything not marked deployed is the narrower claim `test/tier-matrix.test.ts` supports: it builds all three tiers, checks that each declares the resources this page says it does, that every spec field it emits exists in the shipped CRD schema, that the workload namespace carries the label the webhook requires, and that every `imageRef`, `className` and `networkRef` resolves to something declared alongside it. It does not apply anything to a cluster.

The two deployed runs found four things a schema check could not, all in [Running the local target]({{< relref "local-target" >}}). Each was accepted at apply time and failed later.

What is proven beneath the kit, rather than by it: m80 answers 29 of 29 MicroVMs operations against fixtures recorded from live AWS, and 50 of 63 cases of KubeMicroVM's own UAT suite pass against it with every failure accounted for. Three of those failures were issues in the operator rather than the emulator, and all three are filed upstream.
