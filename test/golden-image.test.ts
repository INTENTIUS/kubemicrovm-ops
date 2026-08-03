/**
 * The operator-less path, as a seam.
 *
 * `MicrovmApp` is the aws lexicon's own composite for the same service. This
 * checks that the kit reaches it (it was not exported from the lexicon root
 * barrel until chant#1219, and this repo was blocked on that), that it is off
 * unless asked for, and that a golden image built here is the same size as one
 * the CRD path would declare at the same tier.
 */

import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { tierProfile } from "../src/lib/tiers";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function build(params: string[] = []): { Resources?: Record<string, { Type: string; Properties: Record<string, unknown> }> } {
  const stdout = execFileSync(
    "npx",
    ["chant", "build", "src/golden-image", "--lexicon", "aws", ...params],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        AWS_ENDPOINT_URL: "http://localhost:4566",
        KMV_BUCKET_NAME: "kmv-artifacts",
      },
      maxBuffer: 16 * 1024 * 1024,
      // A build that emits nothing exits non-zero, which is the assertion in
      // the "off by default" case rather than a failure.
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  return JSON.parse(stdout);
}

describe("the golden-image seam", () => {
  test("is off unless asked for", () => {
    // chant refuses a build that discovered source and produced no resources,
    // which is exactly what an omitted seam should do.
    expect(() => build()).toThrow();
  });

  test("emits the image and the two roles the service assumes", () => {
    const resources = build(["--param", "goldenImageMode=provision"]).Resources ?? {};
    const types = Object.values(resources).map((r) => r.Type).sort();
    expect(types).toEqual([
      "AWS::IAM::Role",
      "AWS::IAM::Role",
      "AWS::Lambda::MicrovmImage",
    ]);
  });

  test("takes its memory from the same tier profile the CRD path reads", () => {
    for (const tier of ["minimal", "prod"] as const) {
      const resources = build(["--param", "goldenImageMode=provision", "--param", `tier=${tier}`]).Resources ?? {};
      const image = Object.values(resources).find((r) => r.Type === "AWS::Lambda::MicrovmImage");
      // CloudFormation spells it `Resources: [{ MinimumMemoryInMiB }]`, where
      // the CRD path spells the same number `spec.memorySizeMiB`. Same value,
      // two names, which is exactly the sort of thing declaring both planes in
      // one project is meant to keep honest.
      const resourceProps = image?.Properties.Resources as Array<{ MinimumMemoryInMiB?: number }> | undefined;
      expect(resourceProps?.[0]?.MinimumMemoryInMiB).toBe(tierProfile(tier).image.memorySizeMiB);
    }
  });

  test("scopes the build role to the exact artifact object, not the bucket", () => {
    const resources = build(["--param", "goldenImageMode=provision"]).Resources ?? {};
    const serialized = JSON.stringify(resources);
    expect(serialized).toContain("arn:aws:s3:::kmv-artifacts/app/app.zip");
    expect(serialized).not.toContain("arn:aws:s3:::kmv-artifacts/*");
  });
});
