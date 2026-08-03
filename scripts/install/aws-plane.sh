#!/usr/bin/env bash
# Builds and deploys the AWS plane. Idempotent through CloudFormation's own
# change-set handling, so a re-run against an unchanged template is a no-op.
#
# Split out of local-up.sh so the install Op owns the ordering and this owns
# the invocation. Works against either target: floci when AWS_ENDPOINT_URL is
# set, real CloudFormation when it is not.
set -euo pipefail

STACK_NAME="${STACK_NAME:-kubemicrovm-ops-aws-plane}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

mkdir -p "${ROOT}/dist"
(cd "${ROOT}" && npx chant build src/aws-plane --lexicon aws -o dist/aws-plane.template.json >/dev/null)

echo "==> AWS plane: ${STACK_NAME}"
aws cloudformation deploy \
    --stack-name "${STACK_NAME}" \
    --template-file "${ROOT}/dist/aws-plane.template.json" \
    --capabilities CAPABILITY_NAMED_IAM \
    --no-cli-pager
