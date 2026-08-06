/**
 * The AWS plane's two easiest mistakes to make, both of which produce a
 * template that builds and lints clean and a stack that fails to create.
 */

import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const template = JSON.parse(
  execFileSync("npx", ["chant", "build", "src/aws-plane", "--lexicon", "aws"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, AWS_ENDPOINT_URL: "http://localhost:4566" },
    maxBuffer: 16 * 1024 * 1024,
  }),
) as { Resources: Record<string, { Type: string; Properties: Record<string, unknown> }> };

describe("managed policies attach by role name", () => {
  const policies = Object.entries(template.Resources).filter(
    ([, r]) => r.Type === "AWS::IAM::ManagedPolicy",
  );

  test("there are three of them, as in the upstream template", () => {
    expect(policies).toHaveLength(3);
  });

  // `Roles` takes names. An ARN produces "The role with name
  // arn:aws:iam::...:role/... cannot be found" at create time, long after
  // every build-time check has passed.
  test.each(policies.map(([id]) => id))("%s references a role by Ref, not Arn", (id) => {
    const roles = template.Resources[id].Properties.Roles as unknown[];
    expect(roles).toHaveLength(1);
    expect(roles[0]).toEqual({ Ref: "operatorRole" });
  });
});

describe("account-scoped ARNs are composed at deploy time", () => {
  test("no resource hardcodes an account id", () => {
    const serialized = JSON.stringify(template);
    // The emulator account is the one a local build would otherwise bake in.
    expect(serialized).not.toContain("000000000000");
  });

  test("the service-linked-role ARN uses the pseudo-parameters", () => {
    // `operatorConnectorPolicy`, not `networkConnectorPolicy`: the policy is a
    // member of the `OperatorRole` composite now, and a member's logical id is
    // `<instanceName><MemberName>`. Found by the id, not by scanning for the
    // statement, so a rename shows up here rather than silently matching
    // nothing.
    const connector = template.Resources.operatorConnectorPolicy.Properties.PolicyDocument as {
      Statement: Array<{ Sid?: string; Resource?: unknown }>;
    };
    const statement = connector.Statement.find((s) => s.Sid === "LambdaServiceLinkedRole");
    expect(statement?.Resource).toEqual({
      "Fn::Sub": "arn:${AWS::Partition}:iam::${AWS::AccountId}:role/aws-service-role/lambda.amazonaws.com/*",
    });
  });
});

// The reference-existing seams, wired end to end. Supplying a role ARN and
// selecting reference-existing used to silently DROP the dependent grant —
// the PassRole policy, the pod identity binding — exactly for the adopter the
// seam exists for. A dropped grant builds and lints clean and fails at
// runtime, which is this file's whole theme.
describe("reference-existing seams carry the supplied ARN into dependent grants", () => {
  const BUILD_ARN = "arn:aws:iam::123456789012:role/adopter-build";
  const OPERATOR_ARN = "arn:aws:iam::123456789012:role/adopter-operator";

  const build = (params: string[], env: Record<string, string> = {}) =>
    JSON.parse(
      execFileSync("npx", ["chant", "build", "src/aws-plane", "--lexicon", "aws", ...params.flatMap((p) => ["--param", p])], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, AWS_ENDPOINT_URL: "http://localhost:4566", ...env },
        maxBuffer: 16 * 1024 * 1024,
      }),
    ) as { Resources: Record<string, { Type: string; Properties: Record<string, unknown> }> };

  test("a referenced build role keeps the operator's PassRole grant, pointing at the supplied ARN", () => {
    const t = build(["buildRoleMode=reference-existing"], { KMV_BUILD_ROLE_ARN: BUILD_ARN });
    const pass = Object.values(t.Resources).find(
      (r) => r.Type === "AWS::IAM::ManagedPolicy" && String(r.Properties.ManagedPolicyName).includes("passrole"),
    );
    expect(pass, "the PassRole managed policy must survive the seam").toBeDefined();
    expect(JSON.stringify(pass!.Properties)).toContain(BUILD_ARN);
    // And the build role itself is genuinely not provisioned.
    const roles = Object.values(t.Resources).filter((r) => r.Type === "AWS::IAM::Role");
    expect(roles).toHaveLength(1); // the operator role only
  });

  test("a referenced operator role keeps the pod identity binding, pointing at the supplied ARN", () => {
    const t = build(["operatorRoleMode=reference-existing", "podIdentityMode=provision"], {
      KMV_OPERATOR_ROLE_ARN: OPERATOR_ARN,
      KMV_CLUSTER_NAME: "adopter-cluster",
    });
    const assoc = Object.values(t.Resources).find((r) => r.Type === "AWS::EKS::PodIdentityAssociation");
    expect(assoc, "the pod identity association must survive the seam").toBeDefined();
    expect(assoc!.Properties.RoleArn).toBe(OPERATOR_ARN);
  });

  test("reference-existing with NO ARN supplied still drops the grant rather than emitting it pointing at nothing", () => {
    const t = build(["buildRoleMode=reference-existing"]);
    const pass = Object.values(t.Resources).find(
      (r) => r.Type === "AWS::IAM::ManagedPolicy" && String(r.Properties.ManagedPolicyName).includes("passrole"),
    );
    expect(pass).toBeUndefined();
  });
});
