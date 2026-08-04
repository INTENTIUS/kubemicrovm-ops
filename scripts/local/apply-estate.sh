#!/usr/bin/env bash
# Builds this kit's estate at one tier and applies it to the cluster already
# up. Split out of local-up.sh so a tier change is one command rather than a
# whole rebuild — which is also the path that exercises what the operator's
# webhook does when a tier moves an immutable field.
#
#   ./scripts/local/apply-estate.sh prod-ha
#
# Reads the AWS-plane outputs off the CloudFormation stack on floci, so it
# needs AWS_ENDPOINT_URL pointed there.
set -euo pipefail
. "$(dirname "$0")/../lib-kube.sh"
# Local-target scripts know their own cluster. The install scripts under
# scripts/install/ deliberately do not default this: they are shared with the
# live target, where a k3d context would be the wrong cluster entirely.
KMV_KUBE_CONTEXT="${KMV_KUBE_CONTEXT:-k3d-${CLUSTER:-kubemicrovm-local}}"

TIER="${1:-${KMV_TIER:-minimal}}"
case "${TIER}" in
    minimal|prod|prod-ha) ;;
    *) echo "unknown tier '${TIER}' (expected minimal, prod or prod-ha)" >&2; exit 2 ;;
esac

# No apostrophe in that message: bash 3.2, which macOS ships, mis-parses one
# inside a ${var:?...} expansion and reports a syntax error pages away.
: "${AWS_ENDPOINT_URL:?set AWS_ENDPOINT_URL to floci — the AWS plane stack outputs are read from there}"
STACK_NAME="${STACK_NAME:-kubemicrovm-ops-aws-plane}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_REGION="${AWS_REGION:-us-east-1}"
export KMV_TIER="${TIER}"

stack_resource() {
    local query="StackResources[?LogicalResourceId=='$1'].PhysicalResourceId | [0]"
    aws cloudformation describe-stack-resources --stack-name "${STACK_NAME}" \
        --query "${query}" --output text
}

# The query lives in a variable rather than inline: bash 3.2, which is what
# macOS ships, mis-parses a single-quoted JMESPath literal nested inside a
# command substitution inside a double-quoted assignment.
BUCKET_QUERY="StackResources[?ResourceType=='AWS::S3::Bucket'].PhysicalResourceId | [0]"
BUCKET="$(aws cloudformation describe-stack-resources --stack-name "${STACK_NAME}" \
    --query "${BUCKET_QUERY}" --output text)"
BUILD_ROLE_ARN="arn:aws:iam::000000000000:role/$(stack_resource buildRole)"
OPERATOR_ROLE_ARN="arn:aws:iam::000000000000:role/$(stack_resource operatorRole)"

(cd "${ROOT}" && \
    KMV_BUCKET_NAME="${BUCKET}" \
    KMV_BUILD_ROLE_ARN="${BUILD_ROLE_ARN}" \
    KMV_OPERATOR_ROLE_ARN="${OPERATOR_ROLE_ARN}" \
    KMV_SUBNET_IDS="${KMV_SUBNET_IDS:-subnet-local-a,subnet-local-b}" \
    KMV_SECURITY_GROUP_IDS="${KMV_SECURITY_GROUP_IDS:-sg-local}" \
    npx chant build src/workload --lexicon k8s -o "dist/workload-${TIER}.yaml" >/dev/null)

kubectl apply -f "${ROOT}/dist/workload-${TIER}.yaml"
