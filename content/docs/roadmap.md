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

## M3 — Install Op

The four-phase install Op, local executor first. Runs against a real EKS cluster end to end. Gated prod variant on Temporal. Teardown Op.

## M4 — Lifecycle

Snapshot and diff over both planes. `WatchOp` for dev, `ReconcileOp` for staging including the adopt-unowned-CR default, gated `ApplyOp` for prod. Exercised against live drift, a `kubectl edit`ed VM and a CLI-created VM.

## M5 — Kit packaging

Whatever the adoption surface turns out to be, likely a template repo plus this docs site moved to its permanent home. Decide whether the lint pack graduates into a shared location. Upstream conversation with codriverlabs about linking the kit from their docs.

## Open questions

Whether the full-provision tier is worth building at all, or the kit stays reference-existing only. Leaning reference-existing only until someone asks.

Whether pod identity association lives in CFN (preferred, idempotent) or as a shell step in the Op. Needs a check that `AWS::EKS::PodIdentityAssociation` covers the operator's requirements.

Where generated CRD types live long-term. In-repo per the current design, or published as a package if a second consumer appears.

How the kit tracks KubeMicroVM releases. Manual pinned bumps first. The chant self-upgrade cron pattern if the cadence justifies it.

Whether to add the MicroVM control-plane surface to Floci. No emulator implements the API today. Floci plus k3d would give the kit a local end-to-end loop and unlock behold's local apply demo. Real work, and it lives in Floci rather than here, so it needs its own decision.
