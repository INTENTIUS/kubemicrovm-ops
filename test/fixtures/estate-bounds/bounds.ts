// KMV006 and KMV008: a connector with no subnets, and a class that terminates
// a VM before it can ever suspend. Both are accepted by the CRD schema.
import { MicroVMClass, MicroVMNetwork, Namespace } from "@intentius/chant-lexicon-k8s";

export const ns = new Namespace({
  metadata: { name: "bounds", labels: { "lambda.aws.amazon.com/manage-microvms": "true" } },
});

export const network = new MicroVMNetwork({
  metadata: { name: "no-subnets", namespace: "bounds" },
  spec: {
    connectorName: "no-subnets",
    networkProtocol: "IPv4",
    operatorRoleArn: "arn:aws:iam::000000000000:role/op",
    subnetIds: [],
    securityGroupIds: ["sg-1"],
  },
});

export const vmClass = new MicroVMClass({
  metadata: { name: "incoherent", namespace: "bounds" },
  spec: {
    maxIdleDurationSeconds: 3600,
    maximumDurationSeconds: 60,
    suspendedDurationSeconds: 0,
  },
});
