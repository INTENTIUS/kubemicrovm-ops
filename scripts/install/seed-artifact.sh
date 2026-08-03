#!/usr/bin/env bash
# Puts a placeholder artifact in the bucket, on the local target only.
#
# Nothing fetches it: the real MicroVMs service assumes the build role and
# fetches the object itself, inside AWS, which is the part no emulator reaches.
# It is here because an estate whose image source points at nothing is not an
# honest picture of one that points at something.
#
# On the real target this is a no-op — the artifact is the adopter's, and
# inventing one would overwrite it.
set -euo pipefail

if [ -z "${AWS_ENDPOINT_URL:-}" ]; then
    echo "==> artifact: real target, yours to upload"
    exit 0
fi

STACK_NAME="${STACK_NAME:-kubemicrovm-ops-aws-plane}"
SOURCE_KEY="${KMV_SOURCE_KEY:-app/app.zip}"
BUCKET_QUERY="StackResources[?ResourceType=='AWS::S3::Bucket'].PhysicalResourceId | [0]"
BUCKET="$(aws cloudformation describe-stack-resources --stack-name "${STACK_NAME}" \
    --query "${BUCKET_QUERY}" --output text)"

echo "==> artifact: s3://${BUCKET}/${SOURCE_KEY}"
TMP="$(mktemp -d)"
printf 'placeholder artifact for the local target\n' > "${TMP}/app.txt"
(cd "${TMP}" && zip -q -j app.zip app.txt)
aws s3 cp "${TMP}/app.zip" "s3://${BUCKET}/${SOURCE_KEY}" >/dev/null
rm -rf "${TMP}"
