/**
 * Parameter source for the `cluster-plane` stack — the VPC and the EKS
 * cluster the estate runs on, when the kit provisions them.
 *
 * All infra comes from the tiers and targets: the cluster used to be a
 * reference-existing input with no provision path ("inputs, not seams") and
 * that position is reversed — `clusterMode=provision` declares the whole
 * plane; `reference-existing` (the default, and the local-k3d flow) supplies
 * your own.
 */

import { params } from "@intentius/chant/params";
import type { NamingParams } from "../lib/naming";
import { type Tier } from "../lib/tiers";
import { optionalAccountId, resolveTarget } from "../lib/target";

export const target = resolveTarget({
  awsEndpointUrl: params.awsEndpointUrl as string | undefined,
  microvmEndpointUrl: params.microvmEndpointUrl as string | undefined,
});

function optional(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export const tier: Tier = (params.tier as Tier | undefined) ?? "minimal";
export const clusterMode = (params.clusterMode as string | undefined) ?? "reference-existing";
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

/**
 * The node group's size per tier. The control plane is tier-invariant (EKS
 * itself requires two AZs whatever the tier — the VPC is always 2-AZ); the
 * tier shapes how much compute stands under it, the same way it shapes the
 * replica floor above it. A function rather than a keyed record because a
 * computed key is not statically evaluable (EVL003) — same shape as
 * `tierProfile`.
 */
export function nodegroupShape(t: Tier): { desiredSize: number; maxSize: number } {
  if (t === "minimal") return { desiredSize: 1, maxSize: 1 };
  if (t === "prod") return { desiredSize: 2, maxSize: 3 };
  return { desiredSize: 2, maxSize: 4 };
}

/**
 * The provisioned connector SG's egress allows, parsed from the declared
 * param. `?? "443"` mirrors the declared default, the safety-net convention.
 */
export const connectorEgressPorts: number[] = ((params.connectorEgressPorts as string | undefined) ?? "443")
  .split(",")
  .map((p) => Number(p.trim()))
  .filter((n) => Number.isInteger(n) && n > 0);
