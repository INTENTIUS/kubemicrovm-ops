/**
 * The AWS plane: everything that has to exist in AWS before the operator can
 * reconcile a single custom resource.
 *
 * Three of these come from KubeMicroVM's own `setup-test-env.sh`, which creates
 * them by hand with the CLI: the artifact bucket, the build role, and the
 * build role's inline policy. The fourth, the operator role and its three
 * managed policies, is a typed port of `iam/kube-microvm-operator-role.yaml`
 * from the same repo, pinned to v1.0.11.
 *
 * The operator role is deployed once per region and shared across clusters,
 * each of which creates its own pod identity association pointing at it. That
 * shape is preserved here: the role is a singleton, the association is not.
 *
 * ## What is a composite here and what is not
 *
 * Two groups earn one: `ArtifactBucket` (a bucket and the policy that is never
 * declared without it) and `OperatorRole` (a role and the three policies
 * upstream ships as a single template). The build role and the pod identity
 * association are one resource each and stay plain — wrapping a lone resource
 * in a composite buys a longer import and nothing else.
 *
 * Four nodes at the composites zoom instead of eight, each one nameable. See
 * `../composites/operator-role.ts` for why they are named for what they group
 * rather than for the component that deploys them.
 */

import { AWS, PodIdentityAssociation, Role, Sub } from "@intentius/chant-lexicon-aws";
import { ArtifactBucket } from "../composites/artifact-bucket";
import { OperatorRole } from "../composites/operator-role";
import { kmvNaming } from "../lib/naming";
import {
  bucketMode,
  bucketName,
  buildRoleArn,
  buildRoleMode,
  clusterName,
  namingParams,
  operatorNamespace,
  operatorRoleArn,
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
// Composed by CloudFormation at deploy time rather than baked in at build
// time. The account and partition are properties of wherever the stack lands,
// not of the machine that ran the build — and requiring them at build time
// made the project unbuildable, and so unviewable, without credentials.
const buildLogGroupArn = Sub`arn:${AWS.Partition}:logs:${AWS.Region}:${AWS.AccountId}:log-group:/aws/lambda/microvms/*`;
const artifactObjectArn = `arn:aws:s3:::${artifactBucketName}/*`;

/**
 * The artifact bucket and its TLS-deny policy, or neither.
 *
 * Exported as `artifact`, not `artifactBucket`, and that is load-bearing: a
 * composite member's logical id is `<instanceName><MemberName>`, so `artifact`
 * plus members `bucket`/`bucketPolicy` reproduces the `artifactBucket` and
 * `artifactBucketPolicy` ids this stack emitted before the refactor. See the
 * note in `../composites/artifact-bucket.ts` for why that matters to a stack
 * that already exists.
 */
export const artifact =
  bucketMode === "provision" ? ArtifactBucket({ bucketName: artifactBucketName, tags }) : undefined;


/**
 * The build role. The MicroVMs service assumes this to fetch the artifact and
 * to write build logs — it is passed to `CreateMicrovmImage` and used entirely
 * inside AWS, which is why nothing local can exercise it.
 *
 * Scoped to the one bucket rather than `s3:GetObject` on `*`, and to the
 * service's own log group prefix. One resource, so no composite.
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
                  Resource: artifactObjectArn,
                },
                {
                  Effect: "Allow",
                  Action: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
                  Resource: buildLogGroupArn,
                },
              ],
            },
          },
        ],
        Tags: tags,
      })
    : undefined;

// The ARN the PassRole grant names, whatever the seam: the provisioned role's
// own, else the referenced one the caller supplied. Only genuinely absent when
// the seam is reference-existing AND no ARN was given — KMV005's territory —
// in which case the grant is dropped rather than emitted pointing at nothing.
// (Dropping it on ANY reference-existing was the old behavior: an adopter who
// supplied a build role silently lost the operator's permission to pass it.)
const passableBuildRoleArn = buildRole ? buildRole.Arn : buildRoleArn;

/**
 * The operator role and its three managed policies, as the one unit they are.
 *
 * Exported as `operator` so the role's member id stays `operatorRole` — see
 * `../composites/operator-role.ts` on which ids this preserves and which it
 * cannot.
 */
export const operator =
  operatorRoleMode === "provision"
    ? OperatorRole({
        roleName: operatorRoleName,
        microvmPolicyName,
        passRolePolicyName,
        connectorPolicyName,
        buildRoleArn: passableBuildRoleArn,
        tags,
      })
    : undefined;

// The ARN the association binds, whatever the seam: the provisioned role's
// own, else the referenced one the caller supplied. An adopter bringing their
// operator role still needs the pod identity binding — the old `undefined`
// here silently dropped it exactly when `reference-existing` was in play.
const operatorRoleArnForBinding = operator ? operator.role.Arn : operatorRoleArn;

/**
 * Binds the operator's service account to the operator role, per cluster.
 *
 * Declared here rather than run as `aws eks create-pod-identity-association`
 * in a script, so it is idempotent and shows up in a diff. Omitted against the
 * local target, where the cluster is k3d and the EKS API does not exist. One
 * resource, so no composite.
 */
export const podIdentity =
  podIdentityMode === "provision" && operatorRoleArnForBinding && clusterName
    ? new PodIdentityAssociation({
        ClusterName: clusterName,
        Namespace: operatorNamespace,
        ServiceAccount: OPERATOR_SERVICE_ACCOUNT,
        RoleArn: operatorRoleArnForBinding,
        Tags: tags,
      })
    : undefined;
