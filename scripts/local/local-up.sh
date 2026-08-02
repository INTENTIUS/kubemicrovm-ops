#!/usr/bin/env bash
# Brings the local target up from nothing: floci for the AWS plane, m80 for the
# MicroVMs API, a k3d cluster running the real KubeMicroVM operator, and this
# kit's estate at the tier you ask for. No AWS account, no cost.
#
# The Kubernetes half is not emulated. It is a real cluster running the real
# operator, reconciling real custom resources. Only the AWS side is stood in for.
set -euo pipefail

usage() {
    sed -n '2,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//;$d'
    cat <<'USAGE'

  ./scripts/local/local-up.sh [minimal|prod|prod-ha]

Overridable by environment variable: CLUSTER, NS, KMV_NAMESPACE, FLOCI_IMAGE,
FLOCI_PORT, M80_IMAGE, M80_PORT, CHART_VERSION, AWS_REGION,
MAX_ACCOUNT_MEMORY_MIB.

Needs docker, k3d, kubectl, helm and the AWS CLI. Uses no AWS account.
USAGE
}

TIER="${1:-${KMV_TIER:-minimal}}"
case "${TIER}" in
    -h|--help) usage; exit 0 ;;
    minimal|prod|prod-ha) ;;
    *) echo "unknown tier '${TIER}' (expected minimal, prod or prod-ha)" >&2; usage >&2; exit 2 ;;
esac

CLUSTER="${CLUSTER:-kubemicrovm-local}"
NS="${NS:-kube-microvm}"
KMV_NAMESPACE="${KMV_NAMESPACE:-microvm-demo}"
# floci/floci:latest built from lex00/floci. The fork carries fixes that have
# not reached floci-io/floci yet — CloudFormation dropping a security group's
# rules and tags chief among them — so a stock image is not interchangeable
# once a tier declares anything CloudFormation has to apply properly.
FLOCI_IMAGE="${FLOCI_IMAGE:-floci/floci:latest}"
FLOCI_PORT="${FLOCI_PORT:-4566}"
M80_IMAGE="${M80_IMAGE:-ghcr.io/intentius/m80:v0.2.0}"
M80_PORT="${M80_PORT:-4290}"
CHART_VERSION="${CHART_VERSION:-1.0.11}"
AWS_REGION="${AWS_REGION:-us-east-1}"
# m80 defaults to the account memory ceiling a fresh AWS account has: 4096 MiB.
# A prod-ha deployment at 4096 MiB per VM is two VMs and nothing left over, so
# the harness raises it the way a real account used for this would have been.
MAX_ACCOUNT_MEMORY_MIB="${MAX_ACCOUNT_MEMORY_MIB:-262144}"

STACK_NAME="${STACK_NAME:-kubemicrovm-ops-aws-plane}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

export AWS_ENDPOINT_URL="http://localhost:${FLOCI_PORT}"
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_REGION
export KMV_TIER="${TIER}"

echo "==> floci (the AWS plane) on :${FLOCI_PORT}"
docker rm -f floci-kmv >/dev/null 2>&1 || true
docker run -d --rm --name floci-kmv -p "${FLOCI_PORT}:4566" "${FLOCI_IMAGE}" >/dev/null
for _ in $(seq 1 60); do
    if curl -sf "${AWS_ENDPOINT_URL}/_localstack/health" >/dev/null 2>&1; then break; fi
    sleep 1
done
curl -sf "${AWS_ENDPOINT_URL}/_localstack/health" >/dev/null || {
    echo "floci did not come up on ${AWS_ENDPOINT_URL}" >&2; exit 1
}

echo "==> AWS plane: bucket, build role, operator role"
mkdir -p "${ROOT}/dist"
(cd "${ROOT}" && npx chant build src/aws-plane --lexicon aws -o dist/aws-plane.template.json >/dev/null)
aws cloudformation deploy \
    --stack-name "${STACK_NAME}" \
    --template-file "${ROOT}/dist/aws-plane.template.json" \
    --capabilities CAPABILITY_NAMED_IAM \
    --no-cli-pager >/dev/null

BUCKET="$(aws cloudformation describe-stack-resources --stack-name "${STACK_NAME}" \
    --query "StackResources[?ResourceType=='AWS::S3::Bucket'].PhysicalResourceId | [0]" --output text)"
BUILD_ROLE_ARN="arn:aws:iam::000000000000:role/$(aws cloudformation describe-stack-resources --stack-name "${STACK_NAME}" \
    --query "StackResources[?LogicalResourceId=='buildRole'].PhysicalResourceId | [0]" --output text)"
OPERATOR_ROLE_ARN="arn:aws:iam::000000000000:role/$(aws cloudformation describe-stack-resources --stack-name "${STACK_NAME}" \
    --query "StackResources[?LogicalResourceId=='operatorRole'].PhysicalResourceId | [0]" --output text)"
echo "    bucket      ${BUCKET}"
echo "    build role  ${BUILD_ROLE_ARN}"

# The artifact the image build would read. Nothing fetches it on this target —
# the real MicroVMs service assumes the build role and fetches the object
# itself, inside AWS — but the estate is not honest without it present.
echo "==> artifact"
TMP_ARTIFACT="$(mktemp -d)/app.zip"
printf 'placeholder artifact for the local target\n' > "${TMP_ARTIFACT%.zip}.txt"
(cd "$(dirname "${TMP_ARTIFACT}")" && zip -q -j "${TMP_ARTIFACT}" "${TMP_ARTIFACT%.zip}.txt")
aws s3 cp "${TMP_ARTIFACT}" "s3://${BUCKET}/app/app.zip" >/dev/null

echo "==> cluster ${CLUSTER}"
k3d cluster delete "${CLUSTER}" >/dev/null 2>&1 || true
k3d cluster create "${CLUSTER}" --agents 1 --wait --timeout 300s >/dev/null

echo "==> cert-manager (the operator's webhooks need it)"
helm repo add jetstack https://charts.jetstack.io >/dev/null 2>&1 || true
helm repo update >/dev/null
helm install cert-manager jetstack/cert-manager \
    --namespace cert-manager --create-namespace --set crds.enabled=true \
    --wait --timeout 6m >/dev/null

if docker image inspect "${M80_IMAGE}" >/dev/null 2>&1; then
    echo "==> importing local image ${M80_IMAGE}"
    k3d image import "${M80_IMAGE}" -c "${CLUSTER}" >/dev/null
fi

kubectl create namespace "${NS}" --dry-run=client -o yaml | kubectl apply -f - >/dev/null

echo "==> m80 (the MicroVMs API, and the sts:GetCallerIdentity the operator gates on)"
kubectl apply -f - >/dev/null <<YAML
apiVersion: apps/v1
kind: Deployment
metadata: { name: m80, namespace: ${NS} }
spec:
  replicas: 1
  selector: { matchLabels: { app: m80 } }
  template:
    metadata: { labels: { app: m80 } }
    spec:
      containers:
        - name: m80
          image: ${M80_IMAGE}
          args: ["-addr", ":${M80_PORT}", "-build-delay", "500ms", "-max-account-memory-mib", "${MAX_ACCOUNT_MEMORY_MIB}", "-serve-sts"]
          ports: [{ containerPort: ${M80_PORT} }]
          readinessProbe:
            httpGet: { path: /_m80/health, port: ${M80_PORT} }
            initialDelaySeconds: 2
---
apiVersion: v1
kind: Service
metadata: { name: m80, namespace: ${NS} }
spec:
  selector: { app: m80 }
  ports: [{ port: ${M80_PORT}, targetPort: ${M80_PORT} }]
YAML
kubectl -n "${NS}" rollout status deploy/m80 --timeout=300s

echo "==> CRDs, pinned to chart ${CHART_VERSION}"
kubectl apply -f "${ROOT}/crds" >/dev/null

echo "==> KubeMicroVM operator ${CHART_VERSION}"
helm install kube-microvm-operator \
    "oci://ghcr.io/codriverlabs/helm/kube-microvm-operator" --version "${CHART_VERSION}" \
    -n "${NS}" \
    --set "app.envs.AWS_MICROVM_ENDPOINT=http://m80.${NS}.svc.cluster.local:${M80_PORT}" \
    --set "app.envs.AWS_REGION=${AWS_REGION}" \
    --wait --timeout 6m >/dev/null

# The chart templates only the env keys it knows about, so credentials and the
# STS override have to be patched in afterwards. Both are required: the
# operator's startup gate calls sts:GetCallerIdentity with no endpoint
# override of its own, and without credentials the SDK's default chain finds
# none. Filed upstream as codriverlabs/KubeMicroVM#50 and #52.
kubectl -n "${NS}" set env deploy/kube-microvm-operator \
    AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
    AWS_EC2_METADATA_DISABLED=true \
    "AWS_ENDPOINT_URL_STS=http://m80.${NS}.svc.cluster.local:${M80_PORT}" >/dev/null
kubectl -n "${NS}" rollout status deploy/kube-microvm-operator --timeout=300s

echo "==> estate at tier ${TIER}"
bash "$(dirname "$0")/apply-estate.sh" "${TIER}" >/dev/null

echo
echo "local target up at tier ${TIER}."
health="$(kubectl -n "${NS}" logs deploy/kube-microvm-operator --tail=200 2>/dev/null || true)"
if line="$(printf '%s\n' "${health}" | grep -m1 'AWS connectivity confirmed')"; then
    echo "  operator: ${line}"
else
    echo "  the operator has not confirmed connectivity yet."
    echo "  kubectl -n ${NS} logs deploy/kube-microvm-operator"
    exit 1
fi
echo
echo "  kubectl -n ${KMV_NAMESPACE} get microvms,microvmimages,microvmreplicasets"
echo "  cd ../behold && npm run dev -- preview ../kubemicrovm-ops          # the estate across both substrates"
echo
echo "  Local validates that the estate declares and reconciles. It does not"
echo "  validate that AWS will accept the roles at runtime: nothing fetches"
echo "  your artifact and nothing runs it."
