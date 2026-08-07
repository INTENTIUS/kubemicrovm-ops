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
| Idle policy | Same numbers, flat on the VM spec — no class to carry them | `maxIdleDurationSeconds: 900`, `autoResumeEnabled: true`, `suspendedDurationSeconds: 3600` via the class | Same |
| Lifetime cap | None | None | `maximumDurationSeconds: 28800` |
| `MicroVMNetwork` | Not declared, managed egress | Declared, `IPv4`, one subnet | Declared, `IPv4`, two subnets |
| AWS prerequisites | S3 bucket, build role | Plus the operator role as the connector's `operatorRoleArn`, subnets, security groups | Plus a second availability zone's subnet |
| Node group, when `clusterMode=provision` | 1 node, capped at 1 | 2 nodes, capped at 3 | 2 nodes, capped at 4 |
| Quota discovery | Off | On | On |

Two things that table corrects, because both are easy to assume the other way round:

**Memory is a property of the image, not of the class.** `MicroVMImage.spec.memorySizeMiB` is where a VM's memory comes from. `MicroVMClass` carries the idle and lifetime policy — `maxIdleDurationSeconds`, `suspendedDurationSeconds`, `autoResumeEnabled`, `maximumDurationSeconds` and the connector lists — and has no memory field at all.

**The image name carries the tier.** `MicroVMImage.spec.memorySizeMiB` is immutable after creation and the webhook rejects a change, so an image named without the tier would make `minimal` to `prod` an apply that cannot succeed. Named with it, the two tiers own two images.

**A replica set's `template` is the MicroVM spec inline.** There is no metadata wrapper the way there is in a Kubernetes `ReplicaSet`, so the same object serves both shapes and the kit builds it once.

**There is no service default for the idle policy.** `minimal` originally declared none, on the assumption the service would supply one. The real service refuses the create — `ValidationException: Value null at 'idlePolicy.maxIdleDurationSeconds'` — and m80 had been accepting the null, which is how the assumption survived a month of local runs (filed as an m80 fidelity gap). The CRD carries the same three fields flat on the VM spec, so `minimal` declares them there rather than growing a class it has no other use for.

The memory sizes named here are the service's five runtime profiles (512, 1024, 2048, 4096, 8192). They are unrelated to deployment tiers and the collision in the word is unfortunate. Where the docs say "tier" without qualification they mean the deployment tier in this table.

Constant across every tier: the five CRDs, the operator install, the namespace label the webhook enforces, the cross-plane edges the lint pack checks, and the naming scheme. The provisioned cluster's control plane and VPC are also tier-invariant — EKS requires two availability zones whatever the tier, so the VPC is always 2-AZ and only the node group under it scales with the tier, the same way the replica floor does above it.

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

The live recipes are on-demand, gated, and each one names its cost in its comment. The gated form also exists as a workflow: `.github/workflows/real-e2e.yml` runs any tier against real AWS behind a reviewer-gated environment, with teardown guaranteed and a final sweep that fails the run if anything in the account survived it. Its one-time account setup — the OIDC provider and role are declared estate (`src/ci-plane`), the GitHub half is scripted — is `just setup-real-ci`.

## Adoption seams

Every AWS-plane prerequisite carries a seam of `provision`, `reference-existing` or `omit`. Seams are independent of tier, so a `minimal` deploy can reference an existing VPC and a `prod` deploy can provision one.

This replaces the two-shape split the [estate]({{< relref "estate" >}}) page originally described. Reference-existing versus full-provision is not a tier, it is a per-resource setting, and treating it as a tier forced unrelated choices to move together.

### The full-provision decision

This was left open at first, leaning reference-existing only until someone asked. The reasoning behind that lean was cost: every test of a provisioning path meant standing up an EKS cluster. Then the real-AWS validation runs needed the kit to stand on infrastructure it declared itself, and the lean reversed.

`provision` exists for every prerequisite now, split across two stacks. The AWS plane provisions the S3 bucket, the build role, the operator role and its pod identity association — the resources their `setup-test-env.sh` creates by hand today. The cluster plane, behind `clusterMode` (`KMV_CLUSTER_MODE`), provisions the 2-AZ VPC and the EKS cluster with its tier-sized node group, from the aws lexicon's own `VpcDefault` and `EksCluster` composites. Downstream waves read the cluster's outputs back off the deployed stack, so nothing is pasted between the planes.

When the kit provisions, the posture is the kit's: the connector gets a dedicated security group whose rules *are* the egress policy — deny-all except the ports `connectorEgressPorts` declares (default 443) — and the VPC carries REJECT-only flow logs, the record of what that policy refused. Referenced infrastructure gets no posture applied: yours is yours.

`clusterMode` defaults to `reference-existing`. Nobody adopting this kit is standing up their first cluster with it, and the local target's k3d cluster arrives by a different door. `provision` is how the kit deploys itself onto real AWS from nothing.

## What has been validated

Filled in as each cell is actually run, rather than written from what the code implies.

| Tier | Local | Real |
|------|-------|------|
| `minimal` | **Deployed end to end 2026-08-02.** Image built to `SUCCESSFUL` on m80, MicroVM reached `Running`, operator confirmed connectivity | **Deployed end to end 2026-08-06.** The kit provisioned its own VPC, EKS cluster and node group (`clusterMode=provision`), the real service built the seeded sample image to `SUCCESSFUL`, and the VM reached `Running`. The run found the idle-policy requirement described above — the class of bug the local target structurally cannot catch |
| `prod` | Builds and lints clean; every emitted field checked against the pinned CRD schemas. Not applied on its own — `prod-ha` covers the same resource set | **Deployed end to end 2026-08-06.** Connector `ACTIVE` on the real service, `MicroVMClass` applied, floor 1/1, converge assert passed inside the component run |
| `prod-ha` | **Deployed end to end 2026-08-02.** `MicroVMReplicaSet` 2/2 ready, both VMs `Running`, `MicroVMNetwork` connector `ACTIVE`, `MicroVMClass` applied. Deployed over a live `minimal` estate, so the tier change is exercised too | **Deployed to the account's edge 2026-08-06.** Cluster, planes, image and two-subnet connector all green; one replica `Running`; the second refused with `ServiceQuotaExceededException` — 2 × 4096 MiB against the fresh account's 8192 MiB ceiling, the exact wall `account-fit.sh` names. Floor of 2 awaits the quota raise (a support case: the account cap sits below the on-paper default, which the increase API cannot express) |

Everything not marked deployed is the narrower claim `test/tier-matrix.test.ts` supports: it builds all three tiers, checks that each declares the resources this page says it does, that every spec field it emits exists in the shipped CRD schema, that the workload namespace carries the label the webhook requires, and that every `imageRef`, `className` and `networkRef` resolves to something declared alongside it. It does not apply anything to a cluster.

The two deployed runs found four things a schema check could not, all in [Running the local target]({{< relref "local-target" >}}). Each was accepted at apply time and failed later.

What is proven beneath the kit, rather than by it: m80 answers 29 of 29 MicroVMs operations against fixtures recorded from live AWS, and 50 of 63 cases of KubeMicroVM's own UAT suite pass against it with every failure accounted for. Three of those failures were issues in the operator rather than the emulator, and all three are filed upstream.
