# kubemicrovm-ops

A chant adoption kit for [KubeMicroVM](https://github.com/codriverlabs/KubeMicroVM). Typed declarations, semantic lint, and durable deployment workflows for teams running AWS Lambda MicroVMs through the KubeMicroVM operator.

One source tree, three deployment tiers, two deploy targets, and a local target that costs nothing.

The design documents are a Hugo site (`hugo server`), published at [intentius.github.io/kubemicrovm-ops](https://intentius.github.io/kubemicrovm-ops/). Start with [Tiers and targets](content/docs/tiers.md) — it explains the shape of everything else here.

## Try it without an AWS account

```bash
npm install
just minimal-local-e2e
```

That brings up a k3d cluster, [floci](https://github.com/lex00/floci) for the AWS plane, [m80](https://github.com/INTENTIUS/m80) for the MicroVMs API, the real KubeMicroVM operator pointed at them, and this kit's estate at the `minimal` tier. Then:

```bash
kubectl -n microvm-demo get microvmimages,microvms
just view                     # the whole estate in behold, both substrates
just local-down
```

Swap the tier for `prod` or `prod-ha` and the same command deploys a class, a VPC egress connector, and a replica set instead of a single VM.

### What the local target cannot cover

The operator calls four AWS SDK clients, and those are what floci and m80 intercept. What AWS does downstream of them — assuming the build role, fetching your artifact, creating the connector's ENIs — happens inside a service implementation, with no request to redirect and no endpoint to override. So the local target validates that the estate declares and reconciles correctly. It does not validate that AWS will accept the roles at runtime, and nothing runs your code.

The Kubernetes half is not emulated at all: real cluster, real operator, real custom resources, real admission webhook.

## The three axes

A **tier** is how much estate you want: `minimal`, `prod`, `prod-ha`. `KMV_TIER` selects one and no tier has its own files.

A **target** is where it deploys. `AWS_ENDPOINT_URL` set means the local target: floci for the AWS plane, m80 for the MicroVMs API, k3d instead of EKS. Unset means real AWS. Nothing else in the source changes.

An **adoption seam** is whether the kit provisions a prerequisite, references one you already have, or leaves it out. Seams are per-resource and independent of both tier and target — `bucketMode`, `buildRoleMode`, `operatorRoleMode`, `podIdentityMode`. The EKS cluster and the VPC are inputs rather than seams; the tiers page says why.

## Layout

| Path | Contents |
|------|----------|
| `src/lib/tiers.ts` | The three tiers, and the only place their differences live |
| `src/lib/target.ts` | Local or real, chosen by whether `AWS_ENDPOINT_URL` is set |
| `src/lib/naming.ts` | One naming and tagging key across both planes |
| `src/aws-plane/` | S3 bucket, build role, operator role, pod identity association |
| `src/workload/` | Namespaces and the five custom resources |
| `crds/` | KubeMicroVM's CRDs, pinned to chart 1.0.11 |
| `test/tier-matrix.test.ts` | Builds every tier and checks each field against those CRDs |
| `scripts/local/` | k3d + floci + m80 |
| `scripts/live/` | Real AWS and a real EKS cluster |
| `content/docs/` | Design documents |
| `themes/hugo-book` | Theme (git submodule) |

## The real target

```bash
export AWS_ACCOUNT_ID=… AWS_REGION=us-east-1
export KMV_CLUSTER_NAME=my-eks-cluster
export KMV_SUBNET_IDS=subnet-a,subnet-b KMV_SECURITY_GROUP_IDS=sg-…
just prod-live-e2e
```

This creates named IAM roles and an S3 bucket in a live account, and costs money. `AWS_ENDPOINT_URL` must be unset — the script refuses rather than silently deploying an emulator's worth of confidence.

## Development

```bash
just check          # typecheck, lint, and the tier matrix
just synth          # both planes for the current tier and target
```

`test/tier-matrix.test.ts` is the one worth knowing about. It builds all three tiers and checks every emitted spec field against the pinned CRD schemas, because a misspelled field in a custom resource is accepted by the API server and ignored by the controller. A typo in `className` is a VM silently running with the wrong policy, and nothing else catches it.

### Requires an unreleased chant

The typed classes for the five CRDs come from `@intentius/chant-lexicon-k8s`, which generates them from the pinned Helm chart. Until [chant#1310](https://github.com/INTENTIUS/chant/pull/1310) is released those classes carry no `metadata` property, so setting a name or a namespace needs an `as any` at every call site. This repo is written without the casts and needs the next lexicon release to typecheck.

## Related

| Project | Role |
|---------|------|
| [chant](https://github.com/INTENTIUS/chant) | Core compiler, aws and k8s lexicons, Ops |
| [KubeMicroVM](https://github.com/codriverlabs/KubeMicroVM) | The operator this kit deploys and declares against |
| [m80](https://github.com/INTENTIUS/m80) | The MicroVMs API emulator the local target runs against |
| [floci](https://github.com/lex00/floci) | The AWS emulator serving the local target's prerequisites |
| [behold](https://github.com/INTENTIUS/behold) | The live control plane `just view` opens |
