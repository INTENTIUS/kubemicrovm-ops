---
title: Roadmap
weight: 80
---

# Roadmap

Milestones are sequenced so each one ships something usable on its own. Isolated tasks get filed as issues with acceptance criteria once a milestone starts.

## M0 — Design

This site. The pages here are the deliverable. Exit criterion is a settled answer to the open questions below.

## M1 — Typed CRDs

Extract CRD YAML from the KubeMicroVM Helm chart at the pinned release. Generate typed constructors through the k8s lexicon's CRD path. Verify the spec shapes the docs left ambiguous, class references and replica set fields. Ship a minimal example, one image, one VM, one labelled namespace, that builds to YAML matching the upstream quick start.

## M2 — Estate and lint

Typed port of the operator IAM template. Pod identity association as a declared resource. The reference-existing estate with parameters for cluster and VPC. Lint pack KMV001 through KMV008 plus post-synth checks. Exit criterion is the webhook-rejection test, a set of deliberately broken sources where every admission-time failure the upstream UAT suite exercises is caught at build time instead.

## M3 — The executed deploy

Shipped as components rather than the four-phase Op this milestone was drafted around: the deploy is `chant run all --components`, with the ordering as declared dependencies and each step carrying its tool's own lifecycle. See [The install]({{< relref "install-op" >}}). Runs end to end against both targets — the local one gates every commit, and the cluster plane behind `clusterMode=provision` lets the kit stand up its own EKS cluster on real AWS. Teardown Op shipped.

## M4 — Lifecycle

Snapshot and diff over both planes, exercised against live drift, a `kubectl edit`ed VM and a CLI-created VM. The dial per environment is on [Lifecycle]({{< relref "lifecycle" >}}) — observe through `lifecycle diff --live`, authoritative through the component run with owned-only prunes. (Earlier drafts named `WatchOp`/`ReconcileOp`/`ApplyOp` here. chant's temporal lexicon does ship all three — fountain-ops runs an `ApplyOp` today — but this kit's lifecycle settled on the component run and the diff instead: fewer moving parts for the same dial, and nothing here needs a durable executor.)

## M5 — Kit packaging

Whatever the adoption surface turns out to be, likely a template repo plus this docs site moved to its permanent home. Decide whether the lint pack graduates into a shared location. Upstream conversation with codriverlabs about linking the kit from their docs.

## Open questions

Whether pod identity association lives in CFN (preferred, idempotent) or as a shell step in the Op. Needs a check that `AWS::EKS::PodIdentityAssociation` covers the operator's requirements.

Whether M1's CRD typing also targets the official ACK controller's CRDs (`lambdamicrovms.services.k8s.aws`). Same codegen path, a second consumer, and the hedge described in [The space]({{< relref "space" >}}). Costs little once the KubeMicroVM generation works.

Where generated CRD types live long-term. In-repo per the current design, or published as a package if a second consumer appears.

How the kit tracks KubeMicroVM releases. Manual pinned bumps first. The chant self-upgrade cron pattern if the cadence justifies it.

## Resolved

Tiers and the deploy target are settled, on [Tiers and targets]({{< relref "tiers" >}}). Three named tiers rather than two shapes, a target axis orthogonal to them and selected by whether `AWS_ENDPOINT_URL` is set, and adoption seams as a third per-resource axis. That last one absorbs the old full-provision question: provisioning is built for the AWS-plane prerequisites the operator needs, since the local target validates them for free. The EKS cluster and VPC, deferred at first, followed once the real-AWS validation runs needed the kit to provision its own footing — `clusterMode=provision` on [Tiers and targets]({{< relref "tiers" >}}).

The emulator question is settled. No emulator implements the MicroVM API anywhere, verified 2026-07-29 across moto, LocalStack, fakecloud, ministack, floci upstream and forks, and every public repo touching the API. The decision is both homes with different jobs, sequenced. A standalone emulator in the mudflaps mold comes first, owned cadence, small container the KubeMicroVM community can run next to k3d, full fidelity. A floci service module follows when the CloudFormation path matters, since `AWS::Lambda::MicrovmImage` emulation can only live where the CFN engine lives, scoped to what CFN provisioning needs. One language-agnostic conformance suite is built before either implementation and runs against both plus real AWS. The design lives in its own repo, [m80](https://github.com/INTENTIUS/m80). The kit's local end-to-end loop in M3 and M4 takes a dependency on its M3.
