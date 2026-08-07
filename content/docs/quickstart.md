---
title: Quick start
weight: 5
---

# Quick start

From nothing to a running MicroVM on a laptop, with no AWS account and nothing to pay for.

```sh
git clone https://github.com/INTENTIUS/kubemicrovm-ops
cd kubemicrovm-ops
./go
```

To make the estate *yours* rather than a checkout of ours, start from **[Use this template](https://github.com/INTENTIUS/kubemicrovm-ops/generate)** instead of cloning: a clean-history copy you own outright, because an estate is a thing you own, not a dependency. Everything on this page works identically either way.

**If you have Docker, that is everything.** `./go` checks the seven other tools this needs — k3d, kubectl, helm, the AWS CLI, node, npm and `just` — and offers to install whichever are missing, asking before it touches anything. It will not install Docker: that needs a daemon, and on Linux a group membership that does not take effect until you log out, so a script claiming to have installed it would hand you something that does not work.

Everything `./go` does is a documented command in the order you would run it — `just prereqs`, `npm install`, `just minimal-local-e2e`. If you would rather run them yourself, run them yourself.

That is one command doing several things, in this order.

1. Starts [floci](https://github.com/lex00/floci) on `:4566` — the AWS plane.
2. Builds and deploys the AWS-plane CloudFormation stack to it: the artifact bucket, the build role, the operator role and its three managed policies.
3. Uploads a sample artifact to the bucket — a real one, a Dockerfile and a node server on 8080, because that is the contract the real build service holds a zip to. m80 never opens it, but an estate seeded with something the real builder would refuse is not an honest rehearsal.
4. Creates the k3d cluster — one server, one agent, its shape declared in `cluster/local.ts` and built into the config k3d consumes — and installs cert-manager, which the operator's webhooks need.
5. Starts [m80](https://github.com/INTENTIUS/m80) in that cluster — the MicroVMs API the operator calls, plus the one `sts:GetCallerIdentity` its startup gate blocks on.
6. Applies KubeMicroVM's CRDs and installs the operator chart pinned to 1.0.12, pointed at m80.
7. Builds this kit's estate at the `minimal` tier and applies it.

When it finishes it prints the operator's own connectivity line, which is the thing worth reading:

```
operator: AWS connectivity confirmed: account=000000000000 arn=arn:aws:iam::000000000000:root
```

## Watch it reconcile

```sh
kubectl -n microvm-demo get microvmimages,microvms
```

That lists them and nothing more — none of KubeMicroVM's CRDs declares printer columns, so `kubectl get` shows NAME and AGE and no state at all. `just doctor` prints each kind with the status field that matters, and for one resource in full:

The image goes to `SUCCESSFUL` and the VM to `Running`:

```sh
kubectl -n microvm-demo get microvmimage -o jsonpath='{.items[0].status}' | jq
{
  "activeVersion": "1.0",
  "computeProfile": "2048 MiB / 1.0 vCPU (peak: 8192 MiB / 4.0 vCPU)",
  "imageArn": "arn:aws:lambda:us-east-1:000000000000:microvm-image:kmv-dev-a-minimal-image",
  "imageState": "CREATED",
  "latestVersionState": "SUCCESSFUL"
}
```

## When it does not do that

Two commands, and the difference between them is worth knowing.

```sh
just doctor      # is each piece up and talking to the next
just validate    # did the estate converge, as opposed to merely applying
```

`doctor` reports immediately and never waits. It walks floci, the cluster, m80, the operator and the estate in the order they depend on each other, and for whichever one is wrong it prints the command to run next. It also prints m80's version, which is the fastest way to tell a stale emulator apart from a broken one.

`validate` waits, up to ten minutes, and is the harder question. Manifests that apply cleanly and are then refused by the service look identical to healthy ones until this fails — every one of the schema gaps on [Running the local target]({{< relref "local-target" >}}) presented that way. On failure it prints every resource and the operator's own reasoning.

Both run against an estate that is already up, so neither stands anything up or tears anything down.

## Change tier

Against the stack you already have, without rebuilding it:

```sh
kubectl -n microvm-demo delete microvm --all
just apply-tier prod-ha
just validate prod-ha
```

The delete is a separate step on purpose. `kubectl apply` adds and updates but never removes, so the `minimal` tier's VM outlives the change unless you say otherwise — and a command named `apply-tier` that silently deleted every MicroVM would be worth complaining about.

From nothing, if you have no stack up or want a clean one:

```sh
just prod-ha-local-e2e
```

That deletes the k3d cluster and builds everything again, taking about as long as the first run did. It is the right command for a fresh start and the wrong one for a tier change.

Same source either way. `prod-ha` declares a `MicroVMClass` carrying the idle policy, a `MicroVMNetwork` across two subnets, and a `MicroVMReplicaSet` with a floor of two instead of the single `MicroVM`:

```
$ just doctor
        microvm           kmv-dev-a-vm-fkmqw     Running
        microvm           kmv-dev-a-vm-pg4lk     Running
        microvmnetwork    kmv-dev-a-network      ACTIVE
        microvmreplicaset kmv-dev-a-replicas     2
```

## Look at it

Optional, and the only step here that needs a second repository:

```sh
git clone https://github.com/INTENTIUS/behold ../behold
just view
```

Opens [behold](https://github.com/INTENTIUS/behold) on the project: both planes in one graph, the AWS roles and buckets next to the custom resources that reference them, coloured by drift. It looks for a checkout at `../behold`, or wherever `BEHOLD_DIR` points, and says so rather than failing obscurely if there is none.

Stand the estate up first — this reads a live cluster rather than only your source. See [Operating with behold]({{< relref "behold" >}}).

## Tear it down

```sh
just local-down
```

Deletes the k3d cluster and the floci container. Nothing was ever in AWS, so there is nothing else to clean up.

## What this did not prove

The local target intercepts the four AWS SDK clients the operator calls. What AWS does downstream of them — assuming the build role, fetching your artifact, creating the connector's ENIs — happens inside a service implementation, with no request to redirect. So a green run here says the estate declares and reconciles correctly. It does not say AWS will accept the roles at runtime, and nothing ran your code.

The Kubernetes half is not emulated at all. Real cluster, real operator, real custom resources, real admission webhook — which is why the tier changes above are checked by the same webhook that would check them on EKS.

[Tiers and targets]({{< relref "tiers" >}}) is the page to read next.
