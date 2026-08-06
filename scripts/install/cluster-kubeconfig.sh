#!/usr/bin/env bash
# Points kubectl at the cluster the cluster-plane wave just provisioned —
# `aws eks update-kubeconfig` works on both targets (floci's k3s-backed EKS
# answers it, per the cc-aws-canonical estate). The name is the deterministic
# naming key the declaration used.
set -euo pipefail
PROJECT="${KMV_PROJECT:-kmv}"
ENV="${KMV_ENV:-dev}"
INSTANCE="${KMV_INSTANCE:-a}"
CLUSTER="${KMV_CLUSTER_NAME:-${PROJECT}-${ENV}-${INSTANCE}-cluster}"
echo "==> kubeconfig: ${CLUSTER}"
aws eks update-kubeconfig --name "${CLUSTER}" >/dev/null
# EKS control planes report ACTIVE before every node is Ready; the operator
# install (next wave) schedules real pods, so wait for one Ready node.
kubectl wait --for=condition=Ready node --all --timeout=600s >/dev/null
echo "==> cluster reachable, nodes Ready"
