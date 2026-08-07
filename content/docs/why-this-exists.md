---
title: Why this exists
weight: 10
---

# Why this exists

## What KubeMicroVM is

[KubeMicroVM](https://github.com/codriverlabs/KubeMicroVM) is a Kubernetes operator and CLI for AWS Lambda MicroVMs, built with Quarkus, JOSDK, and GraalVM. It defines five CRDs under `lambda.aws.amazon.com/v1alpha1` and reconciles them against the MicroVM service. It adds workload orchestration, replica pools, VPC egress networking, admission control, quota guardrails, and sidecar token delivery on top of the raw service API. As of this writing the latest stable release is v1.0.11.

## The gap

KubeMicroVM has no infrastructure-as-code story. The install path is a shell script that wraps a Helm chart, a single CloudFormation template for the operator IAM role, and an `aws eks create-pod-identity-association` call. Everything after install is hand-written YAML applied with kubectl or driven through the `microvm` CLI.

That leaves three concrete problems for a team adopting it.

The estate spans two planes. IAM roles, pod identity, S3 build sources, and network subnets live on the AWS side. Namespaces, CRs, and pod annotations live on the Kubernetes side. Nothing ties them together. The `buildRoleArn` in a `MicroVMImage` must match a role that actually exists and is passable. No tool checks this before deploy.

Validation happens at admission time. The operator's webhook rejects a CR in an unlabelled namespace, a bad memory tier, or an unresolvable image reference. Those failures surface one resource at a time, after apply, against a live cluster.

The install is ordered and cross-plane. IAM stack before operator, operator before pod identity, labelled namespace before any CR. The shell script encodes this order once, for install only. Day-two changes re-derive it by hand.

## What the kit is

kubemicrovm-ops is an adoption kit built on [chant](https://intentius.io/chant/), a compiler that turns typed TypeScript declarations into the native artifacts each platform already speaks. It declares the full estate across both planes, adds a lint pack that moves the webhook's checks and the service limits to build time, and deploys as components in dependency waves — cluster plane, AWS plane, operator, workload — the same command on a laptop and on real AWS.

The output is standard. CloudFormation JSON for the AWS plane, plain Kubernetes YAML for the CRs. A team that stops using the kit keeps working artifacts. This matches chant's walk-away principle. Nothing kit-specific survives into the output.

## Who it is for

Teams already running or evaluating KubeMicroVM who want their MicroVM estate reviewed, diffed, and deployed like the rest of their infrastructure. The kit assumes an existing EKS cluster by default and can reference existing IAM rather than owning it — every prerequisite is a per-resource seam of provision, reference-existing, or omit, so adoption starts wherever your estate already is.

## What it is not

It is not a replacement for the operator. The operator remains the reconcile loop between CRs and the MicroVM service. The kit sits above it, declaring what the operator consumes. It is also not an ACK alternative or a new lexicon. KubeMicroVM's CRDs enter through the k8s lexicon's on-demand CRD generation, the same path as any other CRD.
