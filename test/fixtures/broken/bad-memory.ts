// KMV003: a memory size the CRD's open integer permits and the service refuses.
export const imageSpec = {
  source: { s3Bucket: "b", s3Key: "app.zip" },
  baseImageArn: "arn:aws:lambda:us-east-1:aws:microvm-image:al2023-1",
  buildRoleArn: "arn:aws:iam::000000000000:role/build",
  memorySizeMiB: 3072,
  maxVersionsToKeep: 2,
  buildTimeoutSeconds: 600,
};
