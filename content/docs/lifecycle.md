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
| dev | observe | `chant lifecycle diff --live` — seven drift categories, nothing mutated |
| staging | reconcile | The diff names what moved; cloud back to code is a re-apply of the built manifest, code changes are a PR a human opens with the diff in hand |
| prod | authoritative | `chant run all --components` — server-side apply, prunes scoped to owned-and-undeclared, Helm steps roll back the way Helm does |

Nothing forces an environment up the dial. A team can run the kit purely as a typed authoring and lint layer and keep applying with their existing tooling, since the output is plain YAML.

## What a snapshot contains

`chant lifecycle snapshot` reads both planes. CR spec and status from the cluster, stack state from CloudFormation. Status fields such as the VM state and endpoint are observational context in the diff, not declared fields. A VM that the operator auto-suspended shows as a status difference, not spec drift, and triggers nothing.

## Foreign resources

The interesting drift case is a VM created ad hoc through the `microvm` CLI. It carries no chant ownership marker, so the diff reports it as foreign and the owned-only prune can never touch it — deletion requires a resource to be both owned and undeclared, and this one is neither. The kit's stance is adopt-don't-delete: the CLI is a first-class part of the upstream workflow, so a foreign VM in a managed namespace is normal, not an incident. Bringing it into source is a deliberate act — write the declaration, apply, and the marker changes hands — rather than something a reconciler does behind anyone's back.
