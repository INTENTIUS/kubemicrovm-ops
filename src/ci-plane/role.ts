/**
 * The CI plane: the GitHub OIDC provider and the role `real-e2e.yml` assumes
 * (#70).
 *
 * #69 put the workflow's credentials deliberately outside the workflow file —
 * but "outside the file" must not mean "in somebody's console history". The
 * role is estate: declared here, deployed once per account with human
 * credentials (the CI role cannot create itself, which is what makes this a
 * bootstrap stack rather than a wave in `run all`), and readable before
 * anything runs, which is where a trust policy earns review.
 *
 * ## The trust is the gate's other half
 *
 * GitHub's side of the gate is the `real-aws` environment (required
 * reviewers). This side pins the sub claim to that same environment:
 * `repo:<repo>:environment:<env>`. A fork, another repo, or a workflow
 * running outside the environment presents a different sub and the
 * AssumeRoleWithWebIdentity is refused before any reviewer is involved.
 *
 * ## What the permissions are scoped by
 *
 * The names the kit itself creates: `kubemicrovm-ops-*` stacks, `kmv-*` and
 * `kubemicrovm-*` roles and policies (the second prefix covers
 * CloudFormation-generated names, which begin with the stack name), `kmv-*`
 * buckets, `kmv-*` EKS clusters. `iam:PassRole` is further conditioned on
 * the services the kit actually hands roles to. EC2 is the one broad grant:
 * VPC plumbing has no name to scope to before it exists, and the resources
 * it creates are reached only through the scoped CloudFormation stacks.
 * Renaming `KMV_PROJECT` moves the estate outside these prefixes — this
 * stack's params would need the same rename.
 */

import { AWS, OIDCProvider, Role, Sub } from "@intentius/chant-lexicon-aws";
import { ciPlaneMode, githubEnvironment, githubRepo, oidcProviderMode } from "./params";

// The issuer appears as a literal wherever it is part of a property KEY —
// a computed key (`[`${issuer}:aud`]`) is not foldable, and this stack folds.
const GITHUB_ISSUER = "token.actions.githubusercontent.com";

// Bound to consts so every constructor property is a plain identifier and the
// stack stays statically evaluable — same discipline as the other planes.
const declared = ciPlaneMode === "provision";
const providesOidc = declared && oidcProviderMode === "provision";
const subClaim = `repo:${githubRepo}:environment:${githubEnvironment}`;

/**
 * The provider, when this account does not already have one. Thumbprints are
 * the two GitHub CAs; AWS has trusted the issuer's CA directly since 2023 and
 * ignores them for this URL, but the property predates that and stating the
 * known values beats an empty list that reads like an oversight.
 */
export const oidcProvider = providesOidc
  ? new OIDCProvider({
      Url: `https://${GITHUB_ISSUER}`,
      ClientIdList: ["sts.amazonaws.com"],
      ThumbprintList: [
        "6938fd4d98bab03faadb97b34396831e3780aea1",
        "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
      ],
    })
  : undefined;

// Deploy-time composition, not build-time: the account is a property of
// wherever the stack lands. The provider's ARN shape is deterministic
// (issuer URL is the whole identity), so BOTH seam positions compose the
// same Sub — deliberately not `oidcProvider.Arn`: an attr-ref inside a
// nested policy document serializes to nothing and the role lands with an
// empty Principal (found by this stack's first real deploy; the implicit
// create-order the ref would have carried is restored by DependsOn below).
const providerArn = Sub`arn:${AWS.Partition}:iam::${AWS.AccountId}:oidc-provider/${GITHUB_ISSUER}`;
const roleAttributes = providesOidc ? { DependsOn: ["oidcProvider"] } : undefined;

const stackArns = [
  Sub`arn:${AWS.Partition}:cloudformation:${AWS.Region}:${AWS.AccountId}:stack/kubemicrovm-ops-*/*`,
];
const roleArns = [
  Sub`arn:${AWS.Partition}:iam::${AWS.AccountId}:role/kmv-*`,
  Sub`arn:${AWS.Partition}:iam::${AWS.AccountId}:role/kubemicrovm-*`,
];
const policyArns = [
  Sub`arn:${AWS.Partition}:iam::${AWS.AccountId}:policy/kmv-*`,
  Sub`arn:${AWS.Partition}:iam::${AWS.AccountId}:policy/kubemicrovm-*`,
];
const bucketArns = ["arn:aws:s3:::kmv-*", "arn:aws:s3:::kmv-*/*"];
const eksArns = [
  Sub`arn:${AWS.Partition}:eks:${AWS.Region}:${AWS.AccountId}:cluster/kmv-*`,
  Sub`arn:${AWS.Partition}:eks:${AWS.Region}:${AWS.AccountId}:nodegroup/kmv-*/*/*`,
  Sub`arn:${AWS.Partition}:eks:${AWS.Region}:${AWS.AccountId}:addon/kmv-*/*/*`,
  Sub`arn:${AWS.Partition}:eks:${AWS.Region}:${AWS.AccountId}:podidentityassociation/kmv-*/*`,
  Sub`arn:${AWS.Partition}:eks:${AWS.Region}:${AWS.AccountId}:access-entry/kmv-*/*/*/*/*`,
];

/** The role the workflow assumes. Name is fixed: a once-per-account fixture. */
export const realCiRole = declared
  ? new Role({
      RoleName: "kmv-real-ci",
      Description:
        "Assumed by kubemicrovm-ops real-e2e.yml via GitHub OIDC, scoped to the real-aws environment.",
      MaxSessionDuration: 3 * 60 * 60, // the workflow's 150-minute ceiling, with margin
      AssumeRolePolicyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { Federated: providerArn },
            Action: "sts:AssumeRoleWithWebIdentity",
            Condition: {
              StringEquals: {
                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                "token.actions.githubusercontent.com:sub": subClaim,
              },
            },
          },
        ],
      },
      Policies: [
        {
          PolicyName: "KmvRealCiDeploy",
          PolicyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Sid: "StacksTheKitOwns",
                Effect: "Allow",
                Action: ["cloudformation:*"],
                Resource: stackArns,
              },
              {
                // ListStacks takes no resource — the sweep's "nothing left
                // behind" read needs it account-wide.
                Sid: "StackListing",
                Effect: "Allow",
                Action: ["cloudformation:ListStacks", "cloudformation:DescribeStacks"],
                Resource: "*",
              },
              {
                Sid: "RolesTheKitCreates",
                Effect: "Allow",
                Action: [
                  "iam:CreateRole",
                  "iam:DeleteRole",
                  "iam:GetRole",
                  "iam:TagRole",
                  "iam:UntagRole",
                  "iam:UpdateAssumeRolePolicy",
                  "iam:PutRolePolicy",
                  "iam:DeleteRolePolicy",
                  "iam:GetRolePolicy",
                  "iam:ListRolePolicies",
                  "iam:AttachRolePolicy",
                  "iam:DetachRolePolicy",
                  "iam:ListAttachedRolePolicies",
                ],
                Resource: roleArns,
              },
              {
                Sid: "PoliciesTheKitCreates",
                Effect: "Allow",
                Action: [
                  "iam:CreatePolicy",
                  "iam:DeletePolicy",
                  "iam:GetPolicy",
                  "iam:TagPolicy",
                  "iam:ListPolicyVersions",
                  "iam:CreatePolicyVersion",
                  "iam:DeletePolicyVersion",
                ],
                Resource: policyArns,
              },
              {
                // Only to the services the kit actually hands roles to: EKS
                // (cluster/nodegroup roles), pod identity, and the MicroVMs
                // service's build role.
                Sid: "PassOnlyWhereTheKitPasses",
                Effect: "Allow",
                Action: ["iam:PassRole"],
                Resource: roleArns,
                Condition: {
                  StringEquals: {
                    "iam:PassedToService": [
                      "eks.amazonaws.com",
                      "ec2.amazonaws.com",
                      "pods.eks.amazonaws.com",
                      "lambda.amazonaws.com",
                    ],
                  },
                },
              },
              {
                Sid: "ArtifactBuckets",
                Effect: "Allow",
                Action: ["s3:*"],
                Resource: bucketArns,
              },
              {
                Sid: "ClustersTheKitNames",
                Effect: "Allow",
                Action: ["eks:*"],
                Resource: eksArns,
              },
              {
                // CreateCluster acts before its ARN exists; TagResource rides
                // creation. Both are useless without the scoped grants above.
                Sid: "ClusterCreation",
                Effect: "Allow",
                Action: ["eks:CreateCluster", "eks:TagResource"],
                Resource: "*",
              },
              {
                // The one broad grant. VPC plumbing (VPC, subnets, IGW, NAT,
                // EIPs, route tables, security groups) has no name to scope
                // to before it exists; the resources are only reachable
                // through the stack-scoped CloudFormation grants above.
                Sid: "VpcPlumbing",
                Effect: "Allow",
                Action: ["ec2:*"],
                Resource: "*",
              },
            ],
          },
        },
      ],
      Tags: [
        { Key: "kmv:purpose", Value: "real-e2e-ci" },
        { Key: "kmv:managed-by", Value: "kubemicrovm-ops/ci-plane" },
      ],
    }, roleAttributes)
  : undefined;
