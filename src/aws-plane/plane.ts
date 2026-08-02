/**
 * The AWS plane: everything that has to exist in AWS before the operator can
 * reconcile a single custom resource.
 *
 * Three of these come from KubeMicroVM's own `setup-test-env.sh`, which creates
 * them by hand with the CLI: the artifact bucket, the build role, and the
 * build role's inline policy. The fourth, the operator role and its three
 * managed policies, is a typed port of `iam/kube-microvm-operator-role.yaml`
 * from the same repo, pinned to v1.0.11. The action list below is theirs
 * verbatim — an operator that cannot call one of these fails at reconcile
 * time, so this is a place to copy rather than to improve.
 *
 * The operator role is deployed once per region and shared across clusters,
 * each of which creates its own pod identity association pointing at it. That
 * shape is preserved here: the role is a singleton, the association is not.
 */

import { Bucket, ManagedPolicy, Ref, Role, PodIdentityAssociation, S3BucketPolicy } from "@intentius/chant-lexicon-aws";
import { kmvNaming } from "../lib/naming";
import {
  bucketMode,
  bucketName,
  buildRoleMode,
  clusterName,
  namingParams,
  operatorNamespace,
  operatorRoleMode,
  OPERATOR_SERVICE_ACCOUNT,
  podIdentityMode,
} from "./params";

const naming = kmvNaming(namingParams);
const tags = Object.entries(naming.tags()).map(([Key, Value]) => ({ Key, Value }));

// Every derived value a constructor property reads is bound to a const first,
// so the property expression itself is a plain identifier and the whole stack
// stays statically evaluable.
const artifactBucketName = bucketName ?? naming.name("artifacts", { service: "s3Bucket" });
const buildRoleName = naming.name("build-role", { service: "iamRole" });
const operatorRoleName = naming.name("operator", { service: "iamRole" });
const microvmPolicyName = naming.name("operator-microvm", { service: "iamRole" });
const passRolePolicyName = naming.name("operator-passrole", { service: "iamRole" });
const connectorPolicyName = naming.name("operator-connector", { service: "iamRole" });
const publicAccessBlock = {
  BlockPublicAcls: true,
  IgnorePublicAcls: true,
  BlockPublicPolicy: true,
  RestrictPublicBuckets: true,
};
const serviceLinkedRoleArn = `arn:aws:iam::${namingParams.accountId}:role/aws-service-role/lambda.amazonaws.com/*`;

/**
 * The artifact bucket the image build reads from. Public access is blocked
 * outright, matching what `setup-test-env.sh` does immediately after creating
 * it — the artifact is application code and there is no reason for it to be
 * reachable.
 */
export const artifactBucket =
  bucketMode === "provision"
    ? new Bucket({
        BucketName: artifactBucketName,
        PublicAccessBlockConfiguration: publicAccessBlock,
        Tags: tags,
      })
    : undefined;

/**
 * Deny anything reaching the bucket without TLS. `setup-test-env.sh` blocks
 * public access but stops there; the artifact is application code and the
 * build service reads it over HTTPS, so there is no caller this excludes.
 */
export const artifactBucketPolicy = artifactBucket
  ? new S3BucketPolicy({
      Bucket: Ref(artifactBucket) as unknown as string,
      PolicyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "DenyInsecureTransport",
            Effect: "Deny",
            Principal: "*",
            Action: "s3:*",
            Resource: [artifactBucket.Arn, `${artifactBucket.Arn}/*`],
            Condition: { Bool: { "aws:SecureTransport": "false" } },
          },
        ],
      },
    })
  : undefined;

/** The bucket name every downstream reference resolves to, whatever the seam. */
export const resolvedBucketName = bucketMode === "provision" ? artifactBucketName : bucketName;

/**
 * The build role. The MicroVMs service assumes this to fetch the artifact and
 * to write build logs — it is passed to `CreateMicrovmImage` and used entirely
 * inside AWS, which is why nothing local can exercise it.
 *
 * Scoped to the one bucket rather than `s3:GetObject` on `*`, and to the
 * service's own log group prefix.
 */
export const buildRole =
  buildRoleMode === "provision"
    ? new Role({
        RoleName: buildRoleName,
        Description: "Lambda MicroVM image build role — S3 read on the artifact bucket, CloudWatch write.",
        AssumeRolePolicyDocument: {
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Principal: { Service: "lambda.amazonaws.com" },
              Action: ["sts:AssumeRole", "sts:TagSession"],
            },
          ],
        },
        Policies: [
          {
            PolicyName: "KubeMicroVMBuildPolicy",
            PolicyDocument: {
              Version: "2012-10-17",
              Statement: [
                {
                  Effect: "Allow",
                  Action: ["s3:GetObject"],
                  Resource: `arn:aws:s3:::${resolvedBucketName}/*`,
                },
                {
                  Effect: "Allow",
                  Action: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
                  Resource: `arn:aws:logs:${namingParams.region}:${namingParams.accountId}:log-group:/aws/lambda/microvms/*`,
                },
              ],
            },
          },
        ],
        Tags: tags,
      })
    : undefined;

/**
 * The operator role. Assumed two ways: by EKS pod identity, so the operator
 * pod can call the MicroVMs API, and by Lambda itself, so the service can use
 * it as the network connector's operator role.
 */
export const operatorRole =
  operatorRoleMode === "provision"
    ? new Role({
        RoleName: operatorRoleName,
        Description: "KubeMicroVM operator role — shared across clusters in this region.",
        MaxSessionDuration: 3600,
        AssumeRolePolicyDocument: {
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
        },
        Tags: tags,
      })
    : undefined;

/**
 * Every MicroVMs action the operator calls, from the upstream template.
 *
 * `Resource: "*"` is theirs and is deliberate: the service evaluates different
 * actions against different resource ARNs — `GetMicrovm` against the image ARN,
 * the create actions against `*` — so a narrower resource silently denies.
 * Region isolation comes from deploying the role per region, not from the ARN.
 */
export const microvmPolicy =
  operatorRoleMode === "provision" && operatorRole
    ? new ManagedPolicy({
        ManagedPolicyName: microvmPolicyName,
        Description: "Least-privilege policy for the KubeMicroVM operator",
        Roles: [operatorRole.Arn],
        PolicyDocument: {
          Version: "2012-10-17",
          Statement: [
            {
              Sid: "LambdaMicroVMAllActions",
              Effect: "Allow",
              Action: [
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
              ],
              Resource: "*",
            },
            {
              // The health check the operator runs before it reports ready.
              // This one call is why an operator pointed at an endpoint with
              // no STS never starts — see codriverlabs/KubeMicroVM#50.
              Sid: "Identity",
              Effect: "Allow",
              Action: ["sts:GetCallerIdentity"],
              Resource: "*",
            },
          ],
        },
      })
    : undefined;

/** Lets the operator hand the build role to the image build service. */
export const passBuildRolePolicy =
  operatorRoleMode === "provision" && operatorRole && buildRole
    ? new ManagedPolicy({
        ManagedPolicyName: passRolePolicyName,
        Description: "Allows the operator to pass the build role to the MicroVM image service",
        Roles: [operatorRole.Arn],
        PolicyDocument: {
          Version: "2012-10-17",
          Statement: [
            {
              Sid: "PassBuildRole",
              Effect: "Allow",
              Action: "iam:PassRole",
              Resource: buildRole.Arn,
            },
          ],
        },
      })
    : undefined;

/**
 * EC2 and IAM permissions for network connector management. The ENIs are
 * created by EC2 on the service's behalf, which is the part of the estate no
 * emulator reaches.
 */
export const networkConnectorPolicy =
  operatorRoleMode === "provision" && operatorRole
    ? new ManagedPolicy({
        ManagedPolicyName: connectorPolicyName,
        Description: "EC2 and IAM permissions for Lambda network connector ENI management",
        Roles: [operatorRole.Arn],
        PolicyDocument: {
          Version: "2012-10-17",
          Statement: [
            {
              Sid: "EC2NetworkInterfaces",
              Effect: "Allow",
              Action: [
                "ec2:DescribeSecurityGroups",
                "ec2:DescribeSubnets",
                "ec2:DescribeVpcs",
                "ec2:CreateNetworkInterface",
                "ec2:DescribeNetworkInterfaces",
                "ec2:DeleteNetworkInterface",
              ],
              Resource: "*",
            },
            {
              Sid: "PassSelfForNetworkConnector",
              Effect: "Allow",
              Action: "iam:PassRole",
              Resource: operatorRole.Arn,
            },
            {
              Sid: "LambdaServiceLinkedRole",
              Effect: "Allow",
              Action: "iam:CreateServiceLinkedRole",
              Resource: serviceLinkedRoleArn,
            },
          ],
        },
      })
    : undefined;

/**
 * Binds the operator's service account to the operator role, per cluster.
 *
 * Declared here rather than run as `aws eks create-pod-identity-association`
 * in a script, so it is idempotent and shows up in a diff. Omitted against the
 * local target, where the cluster is k3d and the EKS API does not exist.
 */
export const podIdentity =
  podIdentityMode === "provision" && operatorRole && clusterName
    ? new PodIdentityAssociation({
        ClusterName: clusterName,
        Namespace: operatorNamespace,
        ServiceAccount: OPERATOR_SERVICE_ACCOUNT,
        RoleArn: operatorRole.Arn,
        Tags: tags,
      })
    : undefined;
