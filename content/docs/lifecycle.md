---
title: Lifecycle
weight: 60
---

# Lifecycle

Two reconcile loops are in play and they operate at different layers. Keeping them from fighting is the core lifecycle question for this kit.

## Division of authority

The KubeMicroVM operator reconciles CRs against the AWS MicroVM service. It owns that edge completely, including its own drift detection and auto-suspend behavior. The kit never talks to the MicroVM service and never second-guesses the operator.

chant reconciles declared TypeScript against the CRs and the AWS substrate. Its edge ends at the Kubernetes API server and CloudFormation.

```
TypeScript source  ──chant──▶  CRs + CFN stacks  ──operator──▶  MicroVM service
```

Drift on the right edge is the operator's job. Drift on the left edge is the kit's job.

## Server-side apply

chant applies CRs with server-side apply as field manager `chant:<stack>`. The operator writes status and any spec fields it mutates under its own field manager. The API server keeps the ownership ledger. If a human has been `kubectl edit`ing VMs, the apply refuses with named field owners, and taking ownership is a deliberate `forceConflicts` decision. This is stock chant k8s behavior and needs nothing kit-specific.

Ownership markers follow chant convention, `app.kubernetes.io/managed-by=chant` plus the stack label. Prunes are marker-scoped. The operator's own resources, installed by Helm, are never marked and therefore never touched by a chant prune.

## The dial per environment

| Environment | Position | Mechanism |
|-------------|----------|-----------|
| dev | observe | `chant lifecycle diff --live`, or a `WatchOp` on a schedule |
| staging | reconcile | `ReconcileOp` opens PRs when CRs drift from source |
| prod | authoritative | `ApplyOp` with `delete: "gated"` behind an approval gate |

Nothing forces an environment up the dial. A team can run the kit purely as a typed authoring and lint layer and keep applying with their existing tooling, since the output is plain YAML.

## What a snapshot contains

`chant lifecycle snapshot` reads both planes. CR spec and status from the cluster, stack state from CloudFormation. Status fields such as the VM state and endpoint are observational context in the diff, not declared fields. A VM that the operator auto-suspended shows as a status difference, not spec drift, and triggers nothing.

## Reconcile direction

When staging reconciles cloud to code, the `reconcilePr` activity regenerates the affected TypeScript through `chant import`. For CRs this is ordinary k8s import. The interesting case is a VM created ad hoc through the `microvm` CLI. It appears as an unowned resource in the diff. The kit's default treats unowned CRs in managed namespaces as candidates for adoption PRs rather than deletion, since the CLI is a first-class part of the upstream workflow.
