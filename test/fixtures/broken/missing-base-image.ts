// KMV009: no baseImageArn. Applies cleanly, fails every reconcile.
export const imageSpec = {
  source: { s3Bucket: "b", s3Key: "app.zip" },
  buildRoleArn: "arn:aws:iam::000000000000:role/build",
  memorySizeMiB: 2048,
  maxVersionsToKeep: 2,
  buildTimeoutSeconds: 600,
};
