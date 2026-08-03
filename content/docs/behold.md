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

## Looking at it locally

```sh
./go            # stand the estate up
just view       # open it in behold
```

This page used to say there was no emulator path for this estate, because when it was written no local emulator implemented the MicroVM API. [m80](https://github.com/INTENTIUS/m80) is that emulator, released and running in this repo's CI on every push, so the local loop it described as hypothetical is the one `./go` runs.

`just view` uses `behold serve --env`, not `behold preview`. The difference matters here: preview stops after Docker and Floci — the substrates its Loom demo needs — and never detects k3d, so a KubeMicroVM estate previewed shows the AWS plane and none of the Kubernetes one. `serve --env` turns on the live overlay, which reads through `chant lifecycle diff --live` against the cluster `chant.config.ts` binds.

That makes this the mixed-substrate case behold's own pitch describes and its two turnkey demos each show half of: the custom resources and the operator on k3d, the images, VMs and connectors on the AWS side, in one graph.

**Drift you can cause on purpose.** The two planes can genuinely disagree, because the operator reconciles one against the other — and `just break-it` makes them disagree on demand, through m80's failure-injection levers. Against a real account you cannot ask a subnet to run out of addresses; here it is a POST. That is what makes the drift colouring demonstrable rather than something to wait for.

Needs a behold checkout beside this one — behold is not published to npm, so there is no `npx` path. `BEHOLD_DIR` points at one elsewhere.

## What behold is not, here

behold is not a data-plane tool. Getting a token, execing into a VM, and tailing image build logs stay with the `microvm` CLI. The boundary is the same one the kit draws everywhere. Estate shape, drift, and deployment belong to chant and behold. The running VM belongs to the operator and its CLI.
