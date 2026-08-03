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

import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function build(path: string, extraEnv: Record<string, string> = {}): { ok: boolean; output: string } {
  try {
    const stdout = execFileSync("npx", ["chant", "build", path, "--lexicon", "k8s"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        AWS_ENDPOINT_URL: "http://localhost:4566",
        KMV_BUCKET_NAME: "kmv-artifacts",
        KMV_BUILD_ROLE_ARN: "arn:aws:iam::000000000000:role/build",
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
    });
    return { ok: true, output: stdout };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
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

describe("and the kit's own estate passes at every tier", () => {
  test.each(["minimal", "prod", "prod-ha"])("%s", (tier) => {
    const result = build("src/workload", {
      KMV_TIER: tier,
      KMV_OPERATOR_ROLE_ARN: "arn:aws:iam::000000000000:role/operator",
      KMV_SUBNET_IDS: "subnet-a,subnet-b",
      KMV_SECURITY_GROUP_IDS: "sg-1",
    });
    expect(result.ok, result.output).toBe(true);
    expect(result.output).not.toContain("KMV0");
  });
});
