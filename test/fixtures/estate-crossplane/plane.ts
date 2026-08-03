// KMV005: an image naming a build role this project does not declare. Applies
// cleanly; the build fails when the service cannot assume the role.
import { Role } from "@intentius/chant-lexicon-aws";
import { MicroVMImage, Namespace } from "@intentius/chant-lexicon-k8s";

export const buildRole = new Role({
  RoleName: "the-role-we-actually-declare",
  AssumeRolePolicyDocument: {
    Version: "2012-10-17",
    Statement: [{ Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" }],
  },
});

export const ns = new Namespace({
  metadata: { name: "crossplane", labels: { "lambda.aws.amazon.com/manage-microvms": "true" } },
});

export const image = new MicroVMImage({
  metadata: { name: "img", namespace: "crossplane" },
  spec: {
    source: { s3Bucket: "b", s3Key: "app.zip" },
    baseImageArn: "arn:aws:lambda:us-east-1:aws:microvm-image:al2023-1",
    buildRoleArn: "arn:aws:iam::000000000000:role/a-role-nobody-declares",
    memorySizeMiB: 2048,
  },
});
