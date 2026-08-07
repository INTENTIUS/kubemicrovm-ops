/**
 * What the CI plane declares (#70), checked at the template level.
 *
 * The role real-e2e.yml assumes is the one piece of estate whose mistakes are
 * security mistakes: a loose sub claim admits other repos' workflows, a
 * star-resource IAM grant makes "scoped to what the kit creates" a comment
 * rather than a fact. Both are cheap to pin against the built template and
 * expensive to discover any other way.
 */

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, test } from "vitest";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

interface CfnTemplate {
  Resources: Record<string, { Type: string; Properties: Record<string, any> }>;
}

function build(env: Record<string, string>): CfnTemplate {
  const stdout = execFileSync("npx", ["chant", "build", "src/ci-plane", "--lexicon", "aws"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, KMV_CI_PLANE: "provision", ...env },
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout) as CfnTemplate;
}

let provisioned: CfnTemplate;
let referenced: CfnTemplate;

beforeAll(() => {
  provisioned = build({});
  referenced = build({ KMV_OIDC_PROVIDER_MODE: "reference-existing" });
});

function role(t: CfnTemplate) {
  const r = Object.values(t.Resources).find((x) => x.Type === "AWS::IAM::Role");
  expect(r).toBeDefined();
  return r!;
}

describe("the trust policy is the gate's other half", () => {
  test("the sub claim pins repo AND environment — nothing else can assume", () => {
    const cond = role(provisioned).Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals;
    expect(cond["token.actions.githubusercontent.com:sub"]).toBe(
      "repo:INTENTIUS/kubemicrovm-ops:environment:real-aws",
    );
    expect(cond["token.actions.githubusercontent.com:aud"]).toBe("sts.amazonaws.com");
  });

  test("repo and environment are params, so a fork points the claim at itself", () => {
    const t = build({ KMV_GITHUB_REPO: "someone/fork", KMV_GITHUB_ENVIRONMENT: "their-gate" });
    const cond = role(t).Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals;
    expect(cond["token.actions.githubusercontent.com:sub"]).toBe("repo:someone/fork:environment:their-gate");
  });
});

describe("the provider seam", () => {
  test("provision declares the account-global provider alongside the role", () => {
    const kinds = Object.values(provisioned.Resources).map((r) => r.Type).sort();
    expect(kinds).toEqual(["AWS::IAM::OIDCProvider", "AWS::IAM::Role"]);
  });

  test("reference-existing drops the provider and composes its deterministic ARN", () => {
    const kinds = Object.values(referenced.Resources).map((r) => r.Type);
    expect(kinds).toEqual(["AWS::IAM::Role"]);
    const principal = role(referenced).Properties.AssumeRolePolicyDocument.Statement[0].Principal.Federated;
    expect(JSON.stringify(principal)).toContain("oidc-provider/token.actions.githubusercontent.com");
  });
});

describe("scoped means scoped", () => {
  // The three grants that legitimately carry `Resource: "*"`, each for a
  // reason the source states: ListStacks takes no resource, CreateCluster
  // acts before its ARN exists, and VPC plumbing has nothing to scope to.
  const STAR_ALLOWED = new Set(["StackListing", "ClusterCreation", "VpcPlumbing"]);

  test("no IAM, S3 or CloudFormation grant is account-wide", () => {
    const statements = role(provisioned).Properties.Policies[0].PolicyDocument.Statement;
    for (const s of statements) {
      if (STAR_ALLOWED.has(s.Sid)) continue;
      const resources = Array.isArray(s.Resource) ? s.Resource : [s.Resource];
      expect(resources.some((r: unknown) => r === "*"), `statement ${s.Sid}`).toBe(false);
    }
  });

  test("PassRole is conditioned on the services the kit hands roles to", () => {
    const statements = role(provisioned).Properties.Policies[0].PolicyDocument.Statement;
    const pass = statements.find((s: any) => s.Sid === "PassOnlyWhereTheKitPasses");
    expect(pass.Condition.StringEquals["iam:PassedToService"]).toContain("eks.amazonaws.com");
    expect(pass.Resource).not.toBe("*");
  });
});
