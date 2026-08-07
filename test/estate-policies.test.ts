/**
 * The estate-level half of the webhook-rejection test.
 *
 * `test/lint-pack.test.ts` covers the rules that read one file. These cover the
 * ones that read the whole build — whether a namespace this project declares
 * carries the manage label, and whether a reference resolves to something
 * declared alongside it. Both are questions a source rule cannot answer, and
 * both are failures that apply cleanly and go wrong afterwards.
 *
 * Driven through the real `chant build` rather than by calling the check
 * functions, because half of what is being tested is the wiring: a policy
 * listed in `chant.config.ts` that never loads would pass a unit test and
 * catch nothing.
 */

import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * A whole-project build, both lexicons, stdout and stderr together.
 *
 * No `--lexicon` filter: KMV005 is the cross-plane rule and only sees the IAM
 * roles when the aws plane is in the same build. Restricting to k8s made it
 * skip, which is the correct behaviour and a useless test.
 *
 * Diagnostics go to stderr and warnings do not fail the build, so both streams
 * are captured either way — asserting on a warning means reading a stream a
 * success case would otherwise discard.
 */
function build(path: string, extraEnv: Record<string, string> = {}): { ok: boolean; output: string } {
  const result = spawnSync("npx", ["chant", "build", path], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AWS_ENDPOINT_URL: "http://localhost:4566",
      KMV_BUCKET_NAME: "kmv-artifacts",
      // The role name the AWS plane actually declares for these defaults.
      // KMV005 compares the two, so a made-up ARN here would fail the kit's
      // own estate — which is the rule working, and a useless test.
      KMV_BUILD_ROLE_ARN: "arn:aws:iam::000000000000:role/kmv-dev-a-build-role",
      ...extraEnv,
    },
    maxBuffer: 16 * 1024 * 1024,
  });
  return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

describe("a deliberately broken estate fails the build", () => {
  const result = build("test/fixtures/estate-broken");

  test("the build refuses", () => {
    expect(result.ok).toBe(false);
  });

  test("KMV001 names the namespace and says the webhook will reject the resource", () => {
    expect(result.output).toContain("KMV001");
    expect(result.output).toMatch(/namespace "unlabelled"/);
    // The message has to explain the indirection, because the runtime error
    // it replaces names the resource and not the namespace.
    expect(result.output).toMatch(/naming the resource rather than the namespace/);
  });

  test("KMV002 names the dangling reference and what it will do", () => {
    expect(result.output).toContain("KMV002");
    expect(result.output).toMatch(/imageRef "no-such-image"/);
    expect(result.output).toMatch(/apply cleanly and never become ready/);
  });
});

describe("the cross-plane rule sees both planes at once", () => {
  const result = build("test/fixtures/estate-crossplane");

  test("KMV005 catches a build role nothing declares", () => {
    expect(result.ok).toBe(false);
    expect(result.output).toContain("KMV005");
    expect(result.output).toMatch(/a-role-nobody-declares/);
    // The message has to say what happens, because nothing else will: the
    // image applies and the failure arrives from AWS minutes later.
    expect(result.output).toMatch(/apply and the build will fail/);
  });
});

describe("the bounds the schema leaves open", () => {
  const result = build("test/fixtures/estate-bounds");

  test("KMV006 catches a connector with no subnets", () => {
    expect(result.output).toContain("KMV006");
    expect(result.output).toMatch(/requires at least 1/);
  });

  test("KMV008 catches a lifetime cap shorter than the idle threshold", () => {
    expect(result.output).toContain("KMV008");
    expect(result.output).toMatch(/terminated before it can ever be suspended/);
  });

  test("KMV008 catches a suspend window of zero", () => {
    expect(result.output).toMatch(/terminates a VM the moment it suspends/);
  });
});

describe("a namespace with no purpose", () => {
  test("KMV022 warns rather than fails, and says what is left behind", () => {
    const result = build("test/fixtures/estate-stray");
    // A warning, so the build still succeeds — an unused namespace is untidy,
    // not wrong.
    expect(result.ok).toBe(true);
    expect(result.output).toContain("KMV022");
    expect(result.output).toMatch(/left-behind/);
  });
});

describe("and the kit's own estate passes at every tier", () => {
  test.each(["minimal", "prod", "prod-ha"])("%s", (tier) => {
    const result = build("src", {
      KMV_TIER: tier,
      KMV_OPERATOR_ROLE_ARN: "arn:aws:iam::000000000000:role/operator",
      KMV_SUBNET_IDS: "subnet-a,subnet-b",
      KMV_SECURITY_GROUP_IDS: "sg-1",
    });
    expect(result.ok, result.output).toBe(true);
    expect(result.output).not.toContain("KMV0");
  });
});

describe("a secret baked into an image snapshot fails the build (KMV023)", () => {
  const result = build("test/fixtures/estate-snapshot-secret");

  test("the build refuses, naming the variable and the persistence", () => {
    expect(result.ok).toBe(false);
    expect(result.output).toContain("KMV023");
    expect(result.output).toContain('"DATABASE_PASSWORD"');
    expect(result.output).toMatch(/persists in every VM cloned from it/);
  });

  test("an unremarkable variable on the same image is not flagged", () => {
    expect(result.output).not.toContain("LOG_LEVEL");
  });
});
