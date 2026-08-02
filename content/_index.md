---
title: kubemicrovm-ops
type: docs
---

# kubemicrovm-ops

A [chant](https://intentius.io/chant/) adoption kit for [KubeMicroVM](https://github.com/codriverlabs/KubeMicroVM).

KubeMicroVM brings AWS Lambda MicroVMs into the Kubernetes resource model. It ships an operator, five CRDs, a CLI, and admission webhooks. What it does not ship is an infrastructure-as-code path. Installation is a shell script wrapping a Helm chart, one CloudFormation template for IAM, and an `aws eks` call. The resources themselves are hand-written YAML.

This kit closes that gap. It gives KubeMicroVM consumers typed declarations for the whole estate, semantic lint that catches admission-time failures at build time, and a durable install workflow.

The kit is built and runs. [Quick start]({{< relref "/docs/quickstart" >}}) takes a laptop from nothing to a running MicroVM in one command, with no AWS account and nothing to pay for.

## The shape of the kit

| Layer | What the kit provides |
|-------|----------------------|
| Types | Generated constructors for the five KubeMicroVM CRDs, plus the AWS substrate via the chant aws lexicon |
| Lint | Cross-resource rules that mirror the operator's webhook and the MicroVM service limits |
| Deploy | A phased Op covering IAM stack, operator install, pod identity, namespaces, and workloads |
| Lifecycle | Observe, reconcile, or apply per environment, coexisting with the operator's own reconcile loop |
