/**
 * The m80 declaration — the one Kubernetes workload the kit fully owns, now
 * declared instead of heredoc'd (declarable-coverage audit). Local-target
 * only: on the real target the MicroVMs API is AWS's own, and the stack
 * declares nothing — which, per the kit's convention (see
 * golden-image.test.ts), makes the build throw rather than emit an empty
 * document nothing should apply.
 */

import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const build = (env: Record<string, string | undefined>) =>
  execFileSync("npx", ["chant", "build", "src/local-substrate", "--lexicon", "k8s"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
    maxBuffer: 16 * 1024 * 1024,
  });

describe("local-substrate declares m80 on the local target only", () => {
  test("local target: Deployment + Service, image from the declared pin, sts shim on", () => {
    const yaml = build({ AWS_ENDPOINT_URL: "http://localhost:4566" });
    expect(yaml).toContain("kind: Deployment");
    expect(yaml).toContain("kind: Service");
    expect(yaml).toContain("ghcr.io/intentius/m80:v0.4.0");
    expect(yaml).toContain("-serve-sts");
    // The failure-path harness depends on injection being on by default.
    expect(yaml).toContain("-enable-injection");
  });

  test("the image pin is the declared parameter, overridable per run", () => {
    const yaml = build({ AWS_ENDPOINT_URL: "http://localhost:4566", M80_IMAGE: "ghcr.io/intentius/m80:v9.9.9" });
    expect(yaml).toContain("m80:v9.9.9");
  });

  test("real target: nothing declared — the build throws like every all-omitted stack", () => {
    expect(() => build({ AWS_ENDPOINT_URL: undefined })).toThrow();
  });
});
