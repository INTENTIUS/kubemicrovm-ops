#!/usr/bin/env bash
# Deploys the estate to the real target: a live AWS account and a live EKS
# cluster. This costs money and creates named IAM roles. The local target runs
# the same source with the same tiers for free — use this when what you need to
# know is whether AWS accepts the roles at runtime, which is the one thing the
# local target cannot answer.
set -euo pipefail

usage() {
    sed -n '2,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//;$d'
    cat <<'USAGE'

  ./scripts/live/live-up.sh [minimal|prod|prod-ha]

Required: real credentials in the environment, KMV_CLUSTER_NAME, and — for the
production tiers — KMV_SUBNET_IDS and KMV_SECURITY_GROUP_IDS from that
cluster's VPC. AWS_ENDPOINT_URL must be unset; that is what selects this target.

Overridable: AWS_REGION, STACK_NAME, NS, CHART_VERSION, KMV_SOURCE_KEY.
USAGE
}

TIER="${1:-${KMV_TIER:-minimal}}"
case "${TIER}" in
    -h|--help) usage; exit 0 ;;
    minimal|prod|prod-ha) ;;
    *) echo "unknown tier '${TIER}' (expected minimal, prod or prod-ha)" >&2; usage >&2; exit 2 ;;
esac

# An AWS_ENDPOINT_URL left over from a local run would silently deploy this to
# an emulator and report success. Refuse rather than guess.
if [ -n "${AWS_ENDPOINT_URL:-}" ]; then
    echo "AWS_ENDPOINT_URL is set (${AWS_ENDPOINT_URL}) — that selects the local target." >&2
    echo "Unset it to deploy to real AWS, or run \`just ${TIER}-local-e2e\` instead." >&2
    exit 2
fi

: "${KMV_CLUSTER_NAME:?set KMV_CLUSTER_NAME to an existing EKS cluster}"
if [ "${TIER}" != "minimal" ]; then
    : "${KMV_SUBNET_IDS:?set KMV_SUBNET_IDS — the ${TIER} tier declares a VPC egress connector}"
    : "${KMV_SECURITY_GROUP_IDS:?set KMV_SECURITY_GROUP_IDS — the ${TIER} tier declares a VPC egress connector}"
fi

AWS_REGION="${AWS_REGION:-us-east-1}"
STACK_NAME="${STACK_NAME:-kubemicrovm-ops-aws-plane}"
NS="${NS:-kube-microvm}"
CHART_VERSION="${CHART_VERSION:-1.0.12}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

export AWS_REGION
export KMV_TIER="${TIER}"
export AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}"

echo "==> account ${AWS_ACCOUNT_ID}, region ${AWS_REGION}, cluster ${KMV_CLUSTER_NAME}, tier ${TIER}"
echo "    this creates named IAM roles and an S3 bucket, and costs money. Ctrl-C now if that is not what you meant."
sleep 5

echo "==> AWS plane"
mkdir -p "${ROOT}/dist"
(cd "${ROOT}" && npx chant build src/aws-plane --lexicon aws -o dist/aws-plane.template.json >/dev/null)
aws cloudformation deploy \
    --stack-name "${STACK_NAME}" \
    --template-file "${ROOT}/dist/aws-plane.template.json" \
    --capabilities CAPABILITY_NAMED_IAM \
    --no-cli-pager

BUCKET="$(aws cloudformation describe-stack-resources --stack-name "${STACK_NAME}" \
    --query "StackResources[?ResourceType=='AWS::S3::Bucket'].PhysicalResourceId | [0]" --output text)"
BUILD_ROLE_NAME="$(aws cloudformation describe-stack-resources --stack-name "${STACK_NAME}" \
    --query "StackResources[?LogicalResourceId=='buildRole'].PhysicalResourceId | [0]" --output text)"
OPERATOR_ROLE_NAME="$(aws cloudformation describe-stack-resources --stack-name "${STACK_NAME}" \
    --query "StackResources[?LogicalResourceId=='operatorRole'].PhysicalResourceId | [0]" --output text)"
BUILD_ROLE_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:role/${BUILD_ROLE_NAME}"
OPERATOR_ROLE_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:role/${OPERATOR_ROLE_NAME}"

echo "    bucket      ${BUCKET}"
echo "    build role  ${BUILD_ROLE_ARN}"

echo "==> cluster credentials"
aws eks update-kubeconfig --name "${KMV_CLUSTER_NAME}" --region "${AWS_REGION}" >/dev/null

echo "==> CRDs, pinned to chart ${CHART_VERSION}"
kubectl apply -f "${ROOT}/crds" >/dev/null

echo "==> KubeMicroVM operator ${CHART_VERSION}"
kubectl create namespace "${NS}" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
helm upgrade --install kube-microvm-operator \
    "oci://ghcr.io/codriverlabs/helm/kube-microvm-operator" --version "${CHART_VERSION}" \
    -n "${NS}" \
    --set "app.envs.AWS_REGION=${AWS_REGION}" \
    --wait --timeout 6m >/dev/null

echo "==> estate at tier ${TIER}"
(cd "${ROOT}" && \
    KMV_BUCKET_NAME="${BUCKET}" \
    KMV_BUILD_ROLE_ARN="${BUILD_ROLE_ARN}" \
    KMV_OPERATOR_ROLE_ARN="${OPERATOR_ROLE_ARN}" \
    npx chant build src/workload --lexicon k8s -o dist/workload.yaml >/dev/null)
kubectl apply -f "${ROOT}/dist/workload.yaml"

echo
echo "deployed at tier ${TIER}. Upload your artifact before the image can build:"
echo "  aws s3 cp <your-app>.zip s3://${BUCKET}/${KMV_SOURCE_KEY:-app/app.zip}"
echo
echo "  kubectl -n ${KMV_NAMESPACE:-microvm-demo} get microvmimages,microvms,microvmreplicasets"
