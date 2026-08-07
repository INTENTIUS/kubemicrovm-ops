#!/usr/bin/env bash
# The one-time account setup for real-e2e.yml (#70), guided end to end.
#
#   just setup-real-ci          # asks before each mutation
#   just setup-real-ci --yes    # does not ask
#
# Two halves, and this script is the seam between them. The AWS half is
# declared estate — src/ci-plane, deployed here as the `ci-plane` component
# with YOUR credentials, because the CI role cannot create itself. The GitHub
# half is the `real-aws` environment (required reviewer: you) and the
# REAL_AWS_ROLE_ARN variable on it, done with `gh` so the console appears
# nowhere. Everything this script does is readable above the line that does
# it; nothing is remembered outside the stack and the repo settings.
#
# Re-runnable: the stack deploy is CloudFormation-idempotent, the environment
# PUT is an upsert, and the variable set overwrites.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "${ROOT}"

ASK="ask"
[ "${1:-}" = "--yes" ] || [ "${1:-}" = "-y" ] && ASK="--yes"

REPO="${KMV_GITHUB_REPO:-INTENTIUS/kubemicrovm-ops}"
ENVIRONMENT="${KMV_GITHUB_ENVIRONMENT:-real-aws}"

confirm() {
    [ "${ASK}" = "--yes" ] && return 0
    printf '%s [y/N] ' "$1"
    read -r answer
    [ "${answer}" = "y" ] || [ "${answer}" = "Y" ]
}

# ── Preflight: who is doing this, to what account, as whom on GitHub ──────
command -v gh >/dev/null || { echo "gh is required (https://cli.github.com)" >&2; exit 1; }
identity="$(aws sts get-caller-identity --query 'Arn' --output text)" ||
    { echo "no AWS credentials — this needs a human with IAM rights, that is the point" >&2; exit 1; }
gh_user="$(gh api user --jq .login)" ||
    { echo "gh is not authenticated (gh auth login)" >&2; exit 1; }
gh_user_id="$(gh api user --jq .id)"

echo "==> AWS as:    ${identity}"
echo "==> GitHub as: ${gh_user} (will be the required reviewer)"
echo "==> repo:      ${REPO}, environment: ${ENVIRONMENT}"

# ── The AWS half: deploy the declared CI plane ────────────────────────────
confirm "deploy the kmv-ci-plane stack (OIDC provider + kmv-real-ci role)?" || exit 1
KMV_CI_PLANE=provision npx chant run ci-plane --components --env "${KMV_ENV:-dev}"

role_arn="$(aws iam get-role --role-name kmv-real-ci --query 'Role.Arn' --output text)"
echo "==> role: ${role_arn}"

# ── The GitHub half: the environment is the gate, the variable is the key ─
confirm "create/update environment '${ENVIRONMENT}' on ${REPO} with ${gh_user} as required reviewer?" || exit 1
printf '{"reviewers":[{"type":"User","id":%s}]}' "${gh_user_id}" |
    gh api -X PUT "repos/${REPO}/environments/${ENVIRONMENT}" --input - >/dev/null
echo "==> environment ${ENVIRONMENT}: reviewer ${gh_user}"

confirm "set REAL_AWS_ROLE_ARN on that environment?" || exit 1
gh variable set REAL_AWS_ROLE_ARN --env "${ENVIRONMENT}" --repo "${REPO}" --body "${role_arn}"
echo "==> REAL_AWS_ROLE_ARN set"

echo ""
echo "done. dispatch a run with:"
echo "  gh workflow run real-e2e --repo ${REPO} -f tier=minimal"
