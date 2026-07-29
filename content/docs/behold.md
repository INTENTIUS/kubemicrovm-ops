---
title: Operating with behold
weight: 65
---

# Operating with behold

[behold](https://github.com/INTENTIUS/behold) is a live control plane on chant. It renders a chant project's mixed-substrate graph in a browser, colours it by drift, and triggers the project's own Ops through gated, delegated actions. It never mutates anything itself. Because the kit is an ordinary chant project, a KubeMicroVM estate gets the whole behold surface without kit-specific work. This page walks through what that looks like for someone operating KubeMicroVM day to day.

## One picture of both planes

The estate's defining problem is that it spans AWS and Kubernetes with string references across the boundary. behold serves the composed graph with those cross-lexicon edges drawn. The operator role stack, the pod identity association, the S3 build source, the labelled namespaces, and the CRs appear as one topology. The zoom dial runs components, logical, composites, resources, attributes. At the logical zoom the AWS side renders as a conventional architecture diagram, which is the view to put in front of a platform review.

The multi-estate composition matters here specifically. The operator IAM role is once-per-region while pod identity associations and workloads are per-cluster. behold's estate composition shows the shared regional stack and each cluster's stack in one graph, so "which clusters share this role" is a picture rather than a grep.

## Drift, coloured

With `--env` and read credentials, behold overlays live status on the declared topology. The states map directly onto KubeMicroVM situations.

| Colour | State | KubeMicroVM case |
|--------|-------|------------------|
| blue | declared, not deployed | A new `MicroVMImage` merged but not yet applied |
| green | managed | CRs and stacks matching source |
| foreign | live, not declared | A VM created ad hoc with the `microvm` CLI in a managed namespace |
| drifted | managed, diverged | A `kubectl edit`ed VM spec |

The status-versus-spec split from the [Lifecycle]({{< relref "lifecycle" >}}) page carries through. A VM the operator auto-suspended is a status change on a managed node, visible in the inspect pane, not drift. The graph does not turn red because the operator did its job.

Polling (`--poll`) keeps the overlay current between deploys, and the kit's `WatchOp` covers the same ground on a Temporal schedule for environments where nobody has a browser open.

## Actions are the kit's Ops

behold's write gestures only trigger Ops the project committed, running on the project's executor. The kit's Op set therefore defines exactly which buttons exist.

| behold gesture | Kit Op | Effect |
|----------------|--------|--------|
| Run | `kubemicrovm-install` | The four-phase install against a cluster |
| Sync | `ApplyOp` | Push declared source, deletes gated |
| Apply (gate signal) | the `gate-workloads` gate | Human approval for the prod workloads phase |
| Adopt (per foreign node) | `ReconcileOp` | Open a PR importing a CLI-created VM into source |

Adopt is the flow to highlight. The upstream `microvm` CLI is a first-class way to create VMs, so foreign CRs in managed namespaces are normal, not an incident. In behold that VM is a visibly foreign node with an Adopt button, and the outcome is a reviewable PR that brings it into source. This is the kit's adopt-don't-delete default made tangible.

The deployment lanes read Temporal history, so a gated prod install shows its phase progression on the timeline, including time spent waiting on the approval gate.

## Least privilege

behold holds no apply credentials. Its reads need describe and list only. For this estate that means read access to CloudFormation and the cluster API, and notably no `lambda:*Microvm*` permissions at all, since behold never talks to the MicroVM service. The operator keeps that edge to itself. A platform team can hand app teams a read-only behold against staging without extending any AWS access.

## Shareable snapshots

`behold export` freezes the estate into a static, fully navigable snapshot deployable to any static host. Two uses for this kit. Design-time, an exported snapshot of the reference estate becomes a living diagram in these docs and in the upstream conversation with codriverlabs. Operationally, an export is a point-in-time record of an environment that reviewers can pan around without credentials.

## What behold is not, here

There is no emulator path for this estate. The MicroVM service has no local emulator, so behold's turnkey local-apply demos do not translate. Preview and export work offline against source, the live overlay needs a real cluster and account.

behold is also not a data-plane tool. Getting a token, execing into a VM, and tailing image build logs stay with the `microvm` CLI. The boundary is the same one the kit draws everywhere. Estate shape, drift, and deployment belong to chant and behold. The running VM belongs to the operator and its CLI.
