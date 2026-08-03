// Every rule's happy path, so the fixtures prove the rules are not simply
// firing on anything that looks like a spec.
export const imageSpec = {
  source: { s3Bucket: "b", s3Key: "app.zip" },
  baseImageArn: "arn:aws:lambda:us-east-1:aws:microvm-image:al2023-1",
  buildRoleArn: "arn:aws:iam::000000000000:role/build",
  memorySizeMiB: 2048,
  maxVersionsToKeep: 2,
  buildTimeoutSeconds: 600,
};

export const networkSpec = {
  connectorName: "egress",
  networkProtocol: "IPv4",
  operatorRoleArn: "arn:aws:iam::000000000000:role/operator",
  subnetIds: ["subnet-a"],
  securityGroupIds: ["sg-1"],
};
