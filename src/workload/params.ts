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
import { resolveAccountId, resolveTarget } from "../lib/target";

export const target = resolveTarget({
  awsEndpointUrl: params.awsEndpointUrl as string | undefined,
  microvmEndpointUrl: params.microvmEndpointUrl as string | undefined,
});

export const tier: Tier = (params.tier as Tier | undefined) ?? "minimal";

/** Every tier difference in the Kubernetes plane comes from here. */
export const profile = tierProfile(tier);

export const namingParams: NamingParams = {
  project: (params.project as string | undefined) ?? "kmv",
  env: (params.env as string | undefined) ?? "dev",
  instance: (params.instance as string | undefined) ?? "a",
  tier,
  region: (params.region as string | undefined) ?? "us-east-1",
  accountId: resolveAccountId(target, params.accountId as string | undefined),
  owner: (params.owner as string | undefined) ?? "platform",
};

export const workloadNamespace = (params.workloadNamespace as string | undefined) ?? "microvm-demo";
export const operatorNamespace = (params.operatorNamespace as string | undefined) ?? "kube-microvm-system";

/** Where the image is built from. The bucket is the AWS plane's output. */
export const bucketName = params.bucketName as string | undefined;
export const sourceKey = (params.sourceKey as string | undefined) ?? "app/app.zip";

/** `MicroVMImage.spec.buildRoleArn` — the role the build service assumes. */
export const buildRoleArn = params.buildRoleArn as string | undefined;

/** `MicroVMNetwork.spec.operatorRoleArn` — the role the connector runs as. */
export const operatorRoleArn = params.operatorRoleArn as string | undefined;

/** Optional; the service picks a default base image when unset. */
export const baseImageArn = params.baseImageArn as string | undefined;

/**
 * Comma-separated, from the existing VPC. The production tiers take as many as
 * their profile's `subnetCount` — one for `prod`, two for `prod-ha`, which is
 * the whole of what makes a deployment multi-AZ once the subnets are an input.
 */
export const subnetIds = splitList(params.subnetIds as string | undefined);
export const securityGroupIds = splitList(params.securityGroupIds as string | undefined);

function splitList(raw?: string): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
