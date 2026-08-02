---
title: Quick start
weight: 5
---

# Quick start

From nothing to a running MicroVM on a laptop, with no AWS account and nothing to pay for. Needs Docker, k3d, kubectl, helm, the AWS CLI and `just`.

```sh
git clone https://github.com/INTENTIUS/kubemicrovm-ops
cd kubemicrovm-ops
npm install
just minimal-local-e2e
```

That is one command doing several things, in this order.

1. Starts [floci](https://github.com/lex00/floci) on `:4566` — the AWS plane.
2. Builds and deploys the AWS-plane CloudFormation stack to it: the artifact bucket, the build role, the operator role and its three managed policies.
3. Uploads a placeholder artifact to the bucket.
4. Creates a single-node k3d cluster and installs cert-manager, which the operator's webhooks need.
5. Starts [m80](https://github.com/INTENTIUS/m80) in that cluster — the MicroVMs API the operator calls, plus the one `sts:GetCallerIdentity` its startup gate blocks on.
6. Applies KubeMicroVM's CRDs and installs the operator chart pinned to 1.0.11, pointed at m80.
7. Builds this kit's estate at the `minimal` tier and applies it.

When it finishes it prints the operator's own connectivity line, which is the thing worth reading:

```
operator: AWS connectivity confirmed: account=000000000000 arn=arn:aws:iam::000000000000:root
```

## Watch it reconcile

```sh
kubectl -n microvm-demo get microvmimages,microvms
```

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

## Change tier

```sh
just prod-ha-local-e2e
```

Same source, same command shape. `prod-ha` declares a `MicroVMClass` carrying the idle policy, a `MicroVMNetwork` across two subnets, and a `MicroVMReplicaSet` with a floor of two instead of the single `MicroVM`:

```
NAME                                     STATE
microvm.../kmv-dev-a-vm-fkmqw            Running
microvm.../kmv-dev-a-vm-pg4lk            Running

microvmclass.../kmv-dev-a-class     Adoptable multi-AZ deployment...   900   true
microvmnetwork.../kmv-dev-a-network                                    ACTIVE
```

## Look at it

```sh
just view
```

Opens [behold](https://github.com/INTENTIUS/behold) on the project: both planes in one graph, the AWS roles and buckets next to the custom resources they are referenced by. See [Operating with behold]({{< relref "behold" >}}).

## Tear it down

```sh
just local-down
```

Deletes the k3d cluster and the floci container. Nothing was ever in AWS, so there is nothing else to clean up.

## What this did not prove

The local target intercepts the four AWS SDK clients the operator calls. What AWS does downstream of them — assuming the build role, fetching your artifact, creating the connector's ENIs — happens inside a service implementation, with no request to redirect. So a green run here says the estate declares and reconciles correctly. It does not say AWS will accept the roles at runtime, and nothing ran your code.

The Kubernetes half is not emulated at all. Real cluster, real operator, real custom resources, real admission webhook — which is why the tier changes above are checked by the same webhook that would check them on EKS.

[Tiers and targets]({{< relref "tiers" >}}) is the page to read next.
