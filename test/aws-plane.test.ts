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
    const connector = template.Resources.networkConnectorPolicy.Properties.PolicyDocument as {
      Statement: Array<{ Sid?: string; Resource?: unknown }>;
    };
    const statement = connector.Statement.find((s) => s.Sid === "LambdaServiceLinkedRole");
    expect(statement?.Resource).toEqual({
      "Fn::Sub": "arn:${AWS::Partition}:iam::${AWS::AccountId}:role/aws-service-role/lambda.amazonaws.com/*",
    });
  });
});
