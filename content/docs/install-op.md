---
title: The install
weight: 50
---

# The install

The upstream installer is a shell script. It encodes a real ordering, IAM before operator, operator before pod identity, labelled namespace before any CR. The kit expresses that ordering as chant components — release units with declared dependencies — so the order is resolved, not remembered.

```sh
npx chant run all --components --env dev    # or: just install
npx chant run kubemicrovm-teardown          # or: just teardown
```

Both run on the local executor with no Temporal server, and against either target — the steps do not branch on where they point, the components' `enabled` conditions do. `scripts/local/local-up.sh` stands up floci, k3d and m80 and then runs the same command, so what CI proves and what an adopter on EKS runs is the same component graph reached by different routes.

## The components

| Component | Steps | Enabled |
|-----------|-------|---------|
| `cluster-plane` | `cfn-deploy` of the 2-AZ VPC and EKS cluster, then kubeconfig plus a Ready-node wait | `clusterMode=provision` |
| `aws-plane` | build and `cfn-deploy` of the bucket and roles, then the sample artifact seed | always |
| `local-substrate` | `kubectl-apply` of the m80 Deployment and Service | local target |
| `golden-image` | the optional pre-built base image | `goldenImageMode=provision` |
| `operator` | `kubectl-apply` of the pinned CRDs, `helm-upgrade` of cert-manager and the operator chart, env patches | always |
| `workload` | estate build, `kubectl-apply` of the tier's manifest, converge assert | always |

`dependsOn` orders them into waves: `cluster-plane`, then `aws-plane` and `local-substrate`, then `operator`, then `workload`. A disabled component satisfies its dependents vacuously, so the same graph serves every combination — on the real target `local-substrate` sits out, and with `clusterMode=reference-existing` so does `cluster-plane`. No wave knows which siblings ran.

Each step carries its own tool's lifecycle rather than a bespoke one. `kubectl-apply` prunes owned-only, with the CRDs pinned `delete: never` because deleting a CRD deletes every custom resource of its kind cluster-wide. `helm-upgrade` rolls back the way Helm rolls back. The env-patches step is a shell step with its reason written down — the chart drops `app.envs` keys it does not know (upstream #52), so they cannot ride the release.

## The ordering is what running it taught

The wave boundaries are not a design. Each is a place where getting it wrong produced a specific, confusing failure:

| Boundary | What happens if you cross it wrong |
|----------|-----------------------------------|
| Cluster plane before everything | Nothing downstream has a kubeconfig to point at, and on EKS the control plane reports ACTIVE before any node is Ready |
| AWS plane before operator | The operator's first reconcile passes a build role that does not exist |
| cert-manager before the chart | The operator's webhooks do not start, and the failure names the webhook |
| CRDs before the chart | A custom resource cannot apply until the chart's own CRD install has run |
| Env patches after the release | The chart drops the keys it does not know, so they cannot ride the install |
| Converge, not apply | Every schema gap this kit has hit applied cleanly and failed afterwards |

Teardown reverses it, for one reason: the operator refuses to delete a `MicroVMImage` while a VM references it. Deleting the AWS plane first leaves an operator reconciling against roles that are gone, which it reports as an error every ten seconds rather than as a teardown.

It stops where the install stopped. cert-manager stays — a cluster-wide dependency the kit did not necessarily install, and removing something another workload may rely on is not teardown. The CRDs stay if any `MicroVM` exists outside this kit's namespace. A provisioned cluster plane is the one part teardown does not reverse automatically: deleting a cluster is not a step to bury at the end of an estate teardown, so it is its own decision (`aws cloudformation delete-stack`, cluster-plane stack last, after the pod identity association is gone with the AWS plane).

## Pins live in the build

The operator chart version, the cert-manager version and the m80 image are chant build params with declared defaults in `chant.config.ts` — one place, readable before anything runs, overridable per invocation. CI checks the CRD schema pin against the same declared value it deploys from, so the chart pin cannot drift from the schemas that were generated from it.

## Converge, not apply

The `workload` component's last step is `scripts/local/assert-converged.sh`: the image at `SUCCESSFUL`, the tier's VM or replica floor accounted for, the connector `ACTIVE` where the tier declares one. Manifests that apply cleanly and are then refused by the service look identical to healthy ones until this step. A failed state that persists past the operator's own retry window fails the run early, with the operator's log attached; a fresh failure is given the grace to be retried, because the operator genuinely does retry.

## Deploy from CI — the kit ships the pipeline, three ways

`pipelines/` carries the estate's CI declared through chant's github, gitlab and forgejo lexicons and rendered to files an adopter drops in place: `github-check.yml` and `github-deploy.yml` for `.github/workflows/`, `gitlab.yml` for `.gitlab-ci.yml`, `forgejo-check.yml` and `forgejo-deploy.yml` for `.forgejo/workflows/`. One declaration idiom, three forges — the forgejo flavour is authored exactly like the github one and gets its dialect at build.

Each flavour makes the same two claims. *Check* runs on every push with no cluster and no account: typecheck, the lint pack (the webhook's refusals at build time), and the tier matrix against the pinned schemas. *Deploy* is gated — a GitHub environment, GitLab `when: manual`, Forgejo dispatch — because deploying an estate bills an account, and it is the same `chant run all --components` a human types, converge included. Credentials and the reference-existing variables are marked as yours to wire; the deploy refuses to start until they are.

The committed renders are what you copy, so `just pipelines-check` (part of `just check`) fails the build if they drift from the declarations that explain them. Regenerate with `just pipelines`. This repo's own CI stays hand-authored where it does things no adopter needs (the from-scratch e2e, the reviewer-gated real-AWS matrix in `real-e2e.yml` — which is also the reference for the full teardown-guaranteed deploy form).

Teardown remains an Op (`ops/kubemicrovm-teardown.op.ts`), three phases in reverse dependency order — estate, operator, AWS plane. It is the one flow where "run some of it" is normal: tearing down the estate but keeping the operator is an ordinary day-two move, and the phases are cut where those decisions live.
