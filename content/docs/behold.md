---
title: Operating with behold
weight: 65
---

# Operating with behold

[behold](https://github.com/INTENTIUS/behold) is a live control plane on chant. It renders a chant project's mixed-substrate graph in a browser, colours it by drift, and triggers the project's own Ops through gated, delegated actions. It never mutates anything itself. Because the kit is an ordinary chant project, a KubeMicroVM estate gets the whole behold surface without kit-specific work. This page walks through what that looks like for someone operating KubeMicroVM day to day.

## One picture of both planes

The estate's defining problem is that it spans AWS and Kubernetes with string references across the boundary. behold serves the composed graph with those cross-lexicon edges drawn. The operator role stack, the pod identity association, the S3 build source, the labelled namespaces, and the CRs appear as one topology. The zoom dial runs components, logical, composites, resources, attributes. At the logical zoom the AWS side renders as a conventional architecture diagram, which is the view to put in front of a platform review.

The multi-estate composition matters here specifically. The operator IAM role is once-per-region while pod identity associations and workloads are per-cluster. behold's estate composition shows the shared regional stack and each cluster's stack in one graph, so "which clusters share this role" is a picture rather than a grep.

### The component graph

The dial's first stop is the deploy DAG, and until [#43](https://github.com/INTENTIUS/kubemicrovm-ops/issues/43) it was an empty pane — chant discovers components by convention and the kit declared none, so someone stepping through the zoom levels saw the same picture twice and reasonably concluded the tool was broken.

`src/components/` declares four, in three waves:

```
aws-plane ──▶ operator ──▶ workload
    └──────▶ golden-image
```

That is the install Op's ordering drawn as a dependency rather than as a sequence, and it is the same ordering for the same reasons — the operator's first reconcile passes a build role that has to exist, and a custom resource cannot apply before the chart's CRDs and webhook are up. `golden-image` branches off the AWS plane because the operator-less path never reaches Kubernetes at all, which is the whole of what distinguishes it.

Each component is named for the directory it owns, and that is load-bearing rather than tidy: behold correlates a resource to a component by the source file it was declared in. `operator` owns no resources and should not — the chart's objects belong to Helm, are never marked `app.kubernetes.io/managed-by=chant`, and are therefore never touched by a chant prune. It is in the graph for the edge, not the inventory.

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

```sh
just prod-ha-local-e2e     # the estate worth exporting
just export                # freeze it into dist/behold-export
just preview-export        # look at it before anyone else does
just publish               # → https://kubemicrovm-ops.<account>.workers.dev
```

`prod-ha` rather than `minimal` because it is the only tier that declares a class, a connector and a replica floor, so it is the only one whose picture is the whole estate.

The capture is every lens behold can render — each env and tier, each zoom level, radial on and off — taken through the same handlers the live server runs, so a snapshot is the live view rather than a rendering of it. Pan, zoom, the dial and the inspect pane all work against a bundle of JSON with nothing running behind it.

What does not survive is the half that needs a server: no polling, no Op triggers, no adopt. Those are write gestures against a live cluster and a static bundle has neither.

The tier picker still switches all three tiers, and the two you did not deploy render as declared-not-deployed. That is worth leaving in rather than exporting one tier — the same estate at three sizes, with the live overlay saying which one is actually standing, is a better argument than any of the three alone.

### Cloudflare

`behold export` writes an assets-only `wrangler.jsonc` into the bundle, so there is nothing to configure and no server code to deploy — Workers Static Assets serves it as files. `just publish` is `wrangler deploy` in that directory. Auth is `npx wrangler login`, or `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment. `WORKER_NAME` renames it.

Exporting the local target is the thing that makes this safe to publish. The bundle carries physical resource names and the emulator's account id, and against floci and m80 those are `000000000000` and names already in this public repo. An export of a real account is a different document and should be treated as one.

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
