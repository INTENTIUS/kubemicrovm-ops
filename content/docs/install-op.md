---
title: Install Op
weight: 50
---

# Install Op

The upstream installer is a shell script. It encodes a real ordering, IAM before operator, operator before pod identity, labelled namespace before any CR. The kit expresses that ordering as a chant Op so it is durable, observable, and reusable for day-two changes rather than install only.

## Phases

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
