#!/usr/bin/env bash
# Deletes the AWS-plane stack. The bucket is emptied first: CloudFormation
# refuses to delete a bucket with objects in it, and the failure arrives as a
# stack rollback rather than as a message about the bucket.
set -euo pipefail

STACK_NAME="${STACK_NAME:-kubemicrovm-ops-aws-plane}"
BUCKET_QUERY="StackResources[?ResourceType=='AWS::S3::Bucket'].PhysicalResourceId | [0]"

if ! aws cloudformation describe-stacks --stack-name "${STACK_NAME}" >/dev/null 2>&1; then
    echo "==> ${STACK_NAME} is already gone"
    exit 0
fi

BUCKET="$(aws cloudformation describe-stack-resources --stack-name "${STACK_NAME}" \
    --query "${BUCKET_QUERY}" --output text 2>/dev/null || true)"
if [ -n "${BUCKET}" ] && [ "${BUCKET}" != "None" ]; then
    echo "==> emptying s3://${BUCKET}"
    aws s3 rm "s3://${BUCKET}" --recursive >/dev/null 2>&1 || true
fi

echo "==> stack ${STACK_NAME}"
aws cloudformation delete-stack --stack-name "${STACK_NAME}"
aws cloudformation wait stack-delete-complete --stack-name "${STACK_NAME}" 2>/dev/null || true
