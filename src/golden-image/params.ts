/**
 * Parameter source for the `golden-image` stack — the operator-less path.
 *
 * `MicrovmApp` is chant's aws-lexicon composite for the same service, driven
 * through CloudFormation with no cluster involved. It builds an image and the
 * IAM roles the service assumes, and stops there: no replica pools, no classes,
 * no idle policy, no token delivery. Those are operator features and are what
 * the rest of this kit is for.
 *
 * The two compose, and this stack is where. `MicrovmApp` owns the slow-moving
 * golden image, built once in CI through plain CloudFormation. The kit's custom
 * resources drive fast-moving VMs from the cluster. See
 * `content/docs/microvm-app.md`.
 *
 * Off by default. A kit deployment that declares its own `MicroVMImage` needs
 * none of this, and turning it on for symmetry would build a second image
 * nobody references.
 */

import { params } from "@intentius/chant/params";
import type { NamingParams } from "../lib/naming";
import type { Tier } from "../lib/tiers";
import { optionalAccountId, resolveTarget } from "../lib/target";

export const target = resolveTarget({
  awsEndpointUrl: params.awsEndpointUrl as string | undefined,
  microvmEndpointUrl: params.microvmEndpointUrl as string | undefined,
});

export const namingParams: NamingParams = {
  project: (params.project as string | undefined) ?? "kmv",
  env: (params.env as string | undefined) ?? "dev",
  instance: (params.instance as string | undefined) ?? "a",
  tier: (params.tier as Tier | undefined) ?? "minimal",
  region: optional(params.region) ?? "us-east-1",
  accountId: optionalAccountId(target, optional(params.accountId)),
  owner: (params.owner as string | undefined) ?? "platform",
};

/** `provision` builds a golden image through CloudFormation; `omit` is the default. */
export type GoldenImageSeam = "provision" | "omit";
export const goldenImageMode: GoldenImageSeam =
  (params.goldenImageMode as GoldenImageSeam | undefined) ?? "omit";

export const bucketName = optional(params.bucketName);
export const sourceKey = (params.sourceKey as string | undefined) ?? "app/app.zip";

/**
 * `MicrovmApp` takes the AWS-managed base image as an alias (`al2023-1`) rather
 * than the full ARN the CRD path wants, and pins a version separately.
 */
export const goldenBaseImage = optional(params.goldenBaseImage) ?? "al2023-1";
export const goldenBaseImageVersion = optional(params.goldenBaseImageVersion) ?? "0";

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
