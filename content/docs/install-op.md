---
title: Install Op
weight: 50
---

# Install Op

The upstream installer is a shell script. It encodes a real ordering, IAM before operator, operator before pod identity, labelled namespace before any CR. The kit expresses that ordering as a chant Op so it is durable, observable, and reusable for day-two changes rather than install only.

```sh
chant run kubemicrovm-install     # or: just install
chant run kubemicrovm-teardown    # or: just teardown
```

Both run on the local executor with no Temporal server, and against either target — the phases do not branch on where they point. `scripts/local/local-up.sh` brings up floci, k3d and m80 and then runs the install Op, so what CI proves and what an adopter on EKS runs are the same four phases reached by different routes.

## The ordering is what running it taught

The four phases below are not a design. Each boundary is a place where getting it wrong produced a specific, confusing failure:

| Boundary | What happens if you cross it wrong |
|----------|-----------------------------------|
| AWS plane before operator | The operator's first reconcile passes a build role that does not exist |
| cert-manager before the chart | The operator's webhooks do not start, and the failure names the webhook |
| CRDs before the chart | A custom resource cannot apply until the chart's own CRD install has run |
| Env patches after the release | The chart drops the keys it does not know, so they cannot ride the install |
| Converge, not apply | Every schema gap this kit has hit applied cleanly and failed afterwards |

Teardown reverses it, for one reason: the operator refuses to delete a `MicroVMImage` while a VM references it. Deleting the AWS plane first leaves an operator reconciling against roles that are gone, which it reports as an error every ten seconds rather than as a teardown.

It stops where the install stopped. cert-manager stays — a cluster-wide dependency the kit did not necessarily install, and removing something another workload may rely on is not teardown. The CRDs stay if any `MicroVM` exists outside this kit's namespace, because deleting a CRD deletes every custom resource of that kind cluster-wide.

## Phases, as designed

```typescript
import { Op, phase, shell, helmInstall, kubectlApply, waitForStack } from "@intentius/chant-lexicon-temporal";

export default Op({
  name: "kubemicrovm-install",
  overview: "Stand up the KubeMicroVM operator and estate on an existing EKS cluster",
  phases: [
    phase("IAM", [
      shell("aws cloudformation deploy --stack-name kube-microvm-operator --template-file dist/aws/operator-iam.json --capabilities CAPABILITY_NAMED_IAM", { profile: "longInfra" }),
    ]),
    phase("Operator", [
      helmInstall("kube-microvm-operator", "oci://ghcr.io/codriverlabs/helm/kube-microvm-operator", { profile: "longInfra" }),
      shell("aws eks create-pod-identity-association ..."),
    ]),
    phase("Namespaces", [
      kubectlApply("dist/k8s/namespaces.yaml"),
    ]),
    phase("Workloads", [
      kubectlApply("dist/k8s/microvm.yaml"),
      shell("kubectl wait --for=jsonpath={.status.state}=Running microvm --all -n workloads --timeout=600s", { profile: "k8sWait" }),
    ]),
  ],
});
```

The snippet is directional, not final. Exact step builders and the pod identity idempotency story get settled in implementation. The four-phase shape is the design.

## Design points

The IAM phase deploys the typed port of the upstream CFN template. It is once-per-region. Re-runs are no-ops through CloudFormation's own idempotency. The pod identity association is per-cluster and needs an idempotent wrapper since the AWS CLI call is create-only. Either a describe-then-create shell step or declaring `AWS::EKS::PodIdentityAssociation` in the IAM phase and letting CloudFormation own it. The declared form is preferred and is the default in the estate design.

The operator install pins the chart version. The pin lives in one place in the project config and KMV021 checks it against the CRD schema pin.

Workload readiness waits on the operator's status fields. Timeout profiles come from the temporal lexicon's standard set.

## Prod shape

A production environment adds a gate before the Workloads phase and compensation.

```typescript
phase("Approve", [gate("gate-workloads", "24h")]),
```

Destructive day-two changes go through `ApplyOp` with `delete: "gated"` rather than this install Op. See [Lifecycle]({{< relref "lifecycle" >}}).

## Local first

Everything above runs one-shot on the local executor with `chant run kubemicrovm-install`, no Temporal server. The durable form on Temporal is for gated production installs and scheduled lifecycle work. This matches chant's local-versus-temporal split.
