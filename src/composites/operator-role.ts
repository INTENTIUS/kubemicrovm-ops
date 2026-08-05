/**
 * The operator's IAM role and the three managed policies attached to it.
 *
 * This is a composite because upstream it is one file. KubeMicroVM ships
 * `iam/kube-microvm-operator-role.yaml`, and the role and its policies are a
 * single unit there — you do not get to have some of them and still have an
 * operator that reconciles. `src/aws-plane/plane.ts` already said as much in
 * prose ("a place to copy rather than to improve"); this makes the grouping a
 * thing the graph can see.
 *
 * The action list is theirs verbatim. An operator that cannot call one of these
 * fails at reconcile time, so this is a place to copy rather than to improve.
 *
 * ## On the name
 *
 * `OperatorRole`, for what it groups — not `AwsPlane`, for the component that
 * deploys it.
 *
 * behold joins a composite to a component by case-converting the composite's
 * kind (`LoomBackend` -> `loom-backend`) and uses that to draw the component
 * DAG's dependency edges between collapsed composite nodes. Naming this
 * `AwsPlane` would make that join fire. It would also mean a viewer's inference
 * had chosen this repo's vocabulary, and would stop being true the moment the
 * `aws-plane` component is split.
 *
 * What is forgone is a few inferred edges at one zoom level. What is not
 * forgone is the collapse itself: `chant graph --detail 1` groups composite
 * instances by membership, not by name, so this reads as one node either way.
 * The missing link is filed as chant#1492.
 */

import { Composite } from "@intentius/chant";
import { AWS, ManagedPolicy, Ref, Role, Sub } from "@intentius/chant-lexicon-aws";

export interface OperatorRoleProps {
  roleName: string;
  microvmPolicyName: string;
  passRolePolicyName: string;
  connectorPolicyName: string;
  /**
   * The build role this operator is allowed to hand to the image build
   * service. Omitted when the build role is referenced rather than provisioned,
   * which drops the PassRole policy rather than emitting one pointing at
   * nothing.
   */
  buildRoleArn?: string;
  tags: Array<{ Key: string; Value: string }>;
}

/**
 * Every MicroVMs action the operator calls, from the upstream template.
 *
 * `Resource: "*"` is theirs and is deliberate: the service evaluates different
 * actions against different resource ARNs — `GetMicrovm` against the image ARN,
 * the create actions against `*` — so a narrower resource silently denies.
 * Region isolation comes from deploying the role per region, not from the ARN.
 */
const MICROVM_ACTIONS = [
  "lambda:RunMicrovm",
  "lambda:GetMicrovm",
  "lambda:ListMicrovms",
  "lambda:SuspendMicrovm",
  "lambda:ResumeMicrovm",
  "lambda:TerminateMicrovm",
  "lambda:CreateMicrovmAuthToken",
  "lambda:CreateMicrovmShellAuthToken",
  "lambda:CreateMicrovmImage",
  "lambda:GetMicrovmImage",
  "lambda:UpdateMicrovmImage",
  "lambda:DeleteMicrovmImage",
  "lambda:ListMicrovmImages",
  "lambda:GetMicrovmImageVersion",
  "lambda:ListMicrovmImageVersions",
  "lambda:UpdateMicrovmImageVersion",
  "lambda:DeleteMicrovmImageVersion",
  "lambda:GetMicrovmImageBuild",
  "lambda:ListMicrovmImageBuilds",
  "lambda:ListManagedMicrovmImages",
  "lambda:ListManagedMicrovmImageVersions",
  "lambda:CreateNetworkConnector",
  "lambda:GetNetworkConnector",
  "lambda:UpdateNetworkConnector",
  "lambda:DeleteNetworkConnector",
  "lambda:ListNetworkConnectors",
  "lambda:PassNetworkConnector",
  "lambda:TagResource",
  "lambda:UntagResource",
  "lambda:ListTags",
];

const EC2_CONNECTOR_ACTIONS = [
  "ec2:DescribeSecurityGroups",
  "ec2:DescribeSubnets",
  "ec2:DescribeVpcs",
  "ec2:CreateNetworkInterface",
  "ec2:DescribeNetworkInterfaces",
  "ec2:DeleteNetworkInterface",
];

/**
 * Assumed two ways: by EKS pod identity, so the operator pod can call the
 * MicroVMs API, and by Lambda itself, so the service can use it as the network
 * connector's operator role.
 */
const ASSUME_ROLE_POLICY = {
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Principal: { Service: "pods.eks.amazonaws.com" },
      Action: ["sts:AssumeRole", "sts:TagSession"],
    },
    {
      Effect: "Allow",
      Principal: { Service: "lambda.amazonaws.com" },
      Action: "sts:AssumeRole",
    },
  ],
};

/** Lets the operator hand the build role to the image build service. */
function buildPassRolePolicy(name: string, roles: string[], buildRoleArn: string) {
  return new ManagedPolicy({
    ManagedPolicyName: name,
    Description: "Allows the operator to pass the build role to the MicroVM image service",
    Roles: roles,
    PolicyDocument: {
      Version: "2012-10-17",
      Statement: [
        { Sid: "PassBuildRole", Effect: "Allow", Action: "iam:PassRole", Resource: buildRoleArn },
      ],
    },
  });
}

export const OperatorRole = Composite((props: OperatorRoleProps) => {
  const role = new Role({
    RoleName: props.roleName,
    Description: "KubeMicroVM operator role — shared across clusters in this region.",
    MaxSessionDuration: 3600,
    AssumeRolePolicyDocument: ASSUME_ROLE_POLICY,
    Tags: props.tags,
  });

  // `Roles` takes role NAMES, not ARNs — which is what `Ref` on an
  // AWS::IAM::Role returns, and what the upstream template passes as
  // `!Ref OperatorRole`. Passing `.Arn` produces a stack that fails to create
  // with "The role with name arn:aws:iam::...:role/... cannot be found".
  const roleRefs = [Ref(role) as unknown as string];
  const roleArn = role.Arn;
  const serviceLinkedRoleArn = Sub`arn:${AWS.Partition}:iam::${AWS.AccountId}:role/aws-service-role/lambda.amazonaws.com/*`;

  const microvmPolicy = new ManagedPolicy({
    ManagedPolicyName: props.microvmPolicyName,
    Description: "Least-privilege policy for the KubeMicroVM operator",
    Roles: roleRefs,
    PolicyDocument: {
      Version: "2012-10-17",
      Statement: [
        { Sid: "LambdaMicroVMAllActions", Effect: "Allow", Action: MICROVM_ACTIONS, Resource: "*" },
        {
          // The health check the operator runs before it reports ready. This
          // one call is why an operator pointed at an endpoint with no STS
          // never starts — see codriverlabs/KubeMicroVM#50.
          Sid: "Identity",
          Effect: "Allow",
          Action: ["sts:GetCallerIdentity"],
          Resource: "*",
        },
      ],
    },
  });

  /**
   * EC2 and IAM permissions for network connector management. The ENIs are
   * created by EC2 on the service's behalf, which is the part of the estate no
   * emulator reaches.
   */
  const connectorPolicy = new ManagedPolicy({
    ManagedPolicyName: props.connectorPolicyName,
    Description: "EC2 and IAM permissions for Lambda network connector ENI management",
    Roles: roleRefs,
    PolicyDocument: {
      Version: "2012-10-17",
      Statement: [
        { Sid: "EC2NetworkInterfaces", Effect: "Allow", Action: EC2_CONNECTOR_ACTIONS, Resource: "*" },
        { Sid: "PassSelfForNetworkConnector", Effect: "Allow", Action: "iam:PassRole", Resource: roleArn },
        {
          Sid: "LambdaServiceLinkedRole",
          Effect: "Allow",
          Action: "iam:CreateServiceLinkedRole",
          Resource: serviceLinkedRoleArn,
        },
      ],
    },
  });

  // A ternary, never an `if` around the constructor — EVL002 wants a resource
  // reachable without control flow, and the spread below is what EVL004
  // exempts.
  const passRolePolicy = props.buildRoleArn
    ? buildPassRolePolicy(props.passRolePolicyName, roleRefs, props.buildRoleArn)
    : undefined;

  // Instantiated as `operator`, so `role` comes out as the logical id
  // `operatorRole` — the id this stack has always used for it, and the one
  // that matters most to preserve: the role carries a fixed `RoleName`, so
  // CloudFormation replacing it would try to create a second role by a name
  // already in use and fail the update.
  //
  // The three policies cannot be preserved. Their old ids (`microvmPolicy`,
  // `passBuildRolePolicy`, `networkConnectorPolicy`) share no common prefix, and
  // a member id is always `<instanceName><MemberName>` with no override, so no
  // single instance name reproduces all three. They become
  // `operatorMicrovmPolicy`, `operatorPassRolePolicy` and
  // `operatorConnectorPolicy`, which CloudFormation treats as replacements.
  // Deploying this over an existing stack means deleting it first. The kit's
  // own local target recreates the stack on every run, and the real target has
  // never been deployed (see the validation table in docs/tiers.md), so nothing
  // known is affected — but it is a thing to say rather than to discover.
  return { role, microvmPolicy, connectorPolicy, ...(passRolePolicy ? { passRolePolicy } : {}) };
}, "OperatorRole");
