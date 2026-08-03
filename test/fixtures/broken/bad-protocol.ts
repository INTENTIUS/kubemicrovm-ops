// KMV010: a protocol that reads plausibly and is not one of the two.
export const networkSpec = {
  connectorName: "egress",
  networkProtocol: "TCP",
  operatorRoleArn: "arn:aws:iam::000000000000:role/operator",
  subnetIds: ["subnet-a"],
  securityGroupIds: ["sg-1"],
};
