#!/usr/bin/env bash
# Builds the Kubernetes-plane estate at one tier, wiring in the AWS plane's
# real outputs. The build half of what apply-estate.sh used to be — split so
# the apply can be a declared kubectl-apply step (the workload component) and
# this stays the one place the two planes are stitched together.
#
# Target-agnostic, unlike its predecessor: the role ARNs are read from IAM
# itself (`aws iam get-role`) rather than composed around a hard-coded
# emulator account, and nothing here requires AWS_ENDPOINT_URL — on the real
# target the same reads hit real AWS. Reading back what the stack actually
# created is deliberate wiring (see src/components/aws-plane.component.ts):
# the stack names the roles, and the read is what stops the two planes
# disagreeing about the names.
set -euo pipefail

TIER="${1:-${KMV_TIER:-minimal}}"
case "${TIER}" in
    minimal|prod|prod-ha) ;;
    *) echo "unknown tier '${TIER}' (expected minimal, prod or prod-ha)" >&2; exit 2 ;;
esac

STACK_NAME="${STACK_NAME:-kubemicrovm-ops-aws-plane}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export AWS_REGION="${AWS_REGION:-us-east-1}"
export KMV_TIER="${TIER}"

# The local target's emulator accepts any credentials; the real target uses
# whatever the ambient chain provides and these fallbacks never fire.
if [ -n "${AWS_ENDPOINT_URL:-}" ]; then
    export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
    export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
fi

stack_resource() {
    local query="StackResources[?LogicalResourceId=='$1'].PhysicalResourceId | [0]"
    aws cloudformation describe-stack-resources --stack-name "${STACK_NAME}" \
        --query "${query}" --output text
}

role_arn() {
    # The role's OWN ARN, from IAM — never composed around an assumed account.
    aws iam get-role --role-name "$1" --query "Role.Arn" --output text
}

# The query lives in a variable rather than inline: bash 3.2, which is what
# macOS ships, mis-parses a single-quoted JMESPath literal nested inside a
# command substitution inside a double-quoted assignment.
BUCKET_QUERY="StackResources[?ResourceType=='AWS::S3::Bucket'].PhysicalResourceId | [0]"
BUCKET="$(aws cloudformation describe-stack-resources --stack-name "${STACK_NAME}" \
    --query "${BUCKET_QUERY}" --output text)"
BUILD_ROLE_ARN="$(role_arn "$(stack_resource buildRole)")"
OPERATOR_ROLE_ARN="$(role_arn "$(stack_resource operatorRole)")"

# Cluster network inputs: fakes suffice on the local target (k3d has no VPC);
# the real target must supply its own until the cluster plane is declared.
if [ -n "${AWS_ENDPOINT_URL:-}" ]; then
    KMV_SUBNET_IDS="${KMV_SUBNET_IDS:-subnet-local-a,subnet-local-b}"
    KMV_SECURITY_GROUP_IDS="${KMV_SECURITY_GROUP_IDS:-sg-local}"
else
    : "${KMV_SUBNET_IDS:?real target needs KMV_SUBNET_IDS (the cluster subnets)}"
    : "${KMV_SECURITY_GROUP_IDS:?real target needs KMV_SECURITY_GROUP_IDS}"
fi

(cd "${ROOT}" && \
    KMV_BUCKET_NAME="${BUCKET}" \
    KMV_BUILD_ROLE_ARN="${BUILD_ROLE_ARN}" \
    KMV_OPERATOR_ROLE_ARN="${OPERATOR_ROLE_ARN}" \
    KMV_SUBNET_IDS="${KMV_SUBNET_IDS}" \
    KMV_SECURITY_GROUP_IDS="${KMV_SECURITY_GROUP_IDS}" \
    npx chant build src/workload --lexicon k8s -o "dist/workload-${TIER}.yaml" >/dev/null)
echo "built dist/workload-${TIER}.yaml (bucket ${BUCKET})"
