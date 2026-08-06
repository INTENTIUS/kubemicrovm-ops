#!/usr/bin/env bash
# Puts a buildable sample artifact in the bucket.
#
# The zip honours the service's artifact contract — a Dockerfile at the root
# and an app listening on 8080 (the MicroVMs getting-started page) — because
# only the real service ever opens it. m80 collapses the build to a stub, so
# the local target would accept a text file; the real service actually builds
# the image, and a placeholder there turns into CREATE_FAILED forty minutes
# in. Seeding something the builder cannot build is worse than seeding
# nothing.
#
# On the real target the artifact is the adopter's, and inventing one would
# overwrite it — so this seeds there only when asked, with KMV_SEED_ARTIFACT=1
# (which is how the kit's own validation runs get a known-good image source).
# The local target always seeds: an estate whose image source points at
# nothing is not an honest picture of one that points at something.
set -euo pipefail

if [ -z "${AWS_ENDPOINT_URL:-}" ] && [ "${KMV_SEED_ARTIFACT:-}" != "1" ]; then
    echo "==> artifact: real target, yours to upload (or set KMV_SEED_ARTIFACT=1 for the sample)"
    exit 0
fi

STACK_NAME="${STACK_NAME:-kubemicrovm-ops-aws-plane}"
SOURCE_KEY="${KMV_SOURCE_KEY:-app/app.zip}"
BUCKET_QUERY="StackResources[?ResourceType=='AWS::S3::Bucket'].PhysicalResourceId | [0]"
BUCKET="$(aws cloudformation describe-stack-resources --stack-name "${STACK_NAME}" \
    --query "${BUCKET_QUERY}" --output text)"

echo "==> artifact: s3://${BUCKET}/${SOURCE_KEY}"
TMP="$(mktemp -d)"

cat > "${TMP}/Dockerfile" <<'EOF'
FROM node:24-alpine
WORKDIR /app
COPY app.js .
EXPOSE 8080
CMD ["node", "app.js"]
EOF

cat > "${TMP}/app.js" <<'EOF'
const http = require("node:http");

http
    .createServer((req, res) => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("hello from kube-microvm\n");
    })
    .listen(8080);
EOF

(cd "${TMP}" && zip -q -j app.zip Dockerfile app.js)
aws s3 cp "${TMP}/app.zip" "s3://${BUCKET}/${SOURCE_KEY}" >/dev/null
rm -rf "${TMP}"
