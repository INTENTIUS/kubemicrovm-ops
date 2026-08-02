/**
 * Parameter source for the `workload` stack — the Kubernetes plane.
 *
 * The operator's own install (its Helm release, webhooks and cert-manager
 * Certificate) is not declared here. It is a chart the kit installs at a pinned
 * version, not a set of resources the kit owns, and re-declaring its innards
 * would fight the chart on every upgrade. What the kit declares is the
 * namespace it goes in, the namespace the workload goes in, and the five custom
 * resources.
 */

import { params } from "@intentius/chant/params";
import type { NamingParams } from "../lib/naming";
import { type Tier, tierProfile } from "../lib/tiers";
import { optionalAccountId, resolveTarget } from "../lib/target";

export const target = resolveTarget({
  awsEndpointUrl: params.awsEndpointUrl as string | undefined,
  microvmEndpointUrl: params.microvmEndpointUrl as string | undefined,
});

export const tier: Tier = (params.tier as Tier | undefined) ?? "minimal";

/** Every tier difference in the Kubernetes plane comes from here. */
export const profile = tierProfile(tier);

export const region = optional(params.region) ?? "us-east-1";

export const namingParams: NamingParams = {
  project: (params.project as string | undefined) ?? "kmv",
  env: (params.env as string | undefined) ?? "dev",
  instance: (params.instance as string | undefined) ?? "a",
  tier,
  region,
  accountId: optionalAccountId(target, optional(params.accountId)),
  owner: (params.owner as string | undefined) ?? "platform",
};

export const workloadNamespace = (params.workloadNamespace as string | undefined) ?? "microvm-demo";
export const operatorNamespace = (params.operatorNamespace as string | undefined) ?? "kube-microvm";

/** Where the image is built from. The bucket is the AWS plane's output. */
export const bucketName = optional(params.bucketName);
export const sourceKey = (params.sourceKey as string | undefined) ?? "app/app.zip";

/** `MicroVMImage.spec.buildRoleArn` — the role the build service assumes. */
export const buildRoleArn = optional(params.buildRoleArn);

/** `MicroVMNetwork.spec.operatorRoleArn` — the role the connector runs as. */
export const operatorRoleArn = optional(params.operatorRoleArn);

/**
 * `MicroVMImage.spec.baseImageArn`. Not optional in practice: the CRD schema
 * does not mark it required, but the service rejects a create without it —
 * `Value null at 'baseImageArn' failed to satisfy constraint: Member must not
 * be null`. Omitting it fails at reconcile, long after a clean apply.
 *
 * The default is the AWS-managed base image their own `setup-test-env.sh`
 * prints, with the region substituted.
 */
export const baseImageArn =
  optional(params.baseImageArn) ?? `arn:aws:lambda:${region}:aws:microvm-image:al2023-1`;

/**
 * Comma-separated, from the existing VPC. The production tiers take as many as
 * their profile's `subnetCount` — one for `prod`, two for `prod-ha`, which is
 * the whole of what makes a deployment multi-AZ once the subnets are an input.
 */
export const subnetIds = splitList(optional(params.subnetIds));
export const securityGroupIds = splitList(optional(params.securityGroupIds));

/**
 * An unset build parameter arrives as `null`, not `undefined`, so `??` alone
 * does not reach a default and the value serializes as an explicit `null`.
 * That is how `baseImageArn: null` first reached the cluster and was rejected
 * by the service rather than by the schema.
 */
function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function splitList(raw?: string): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
