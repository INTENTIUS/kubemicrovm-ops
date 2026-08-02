/**
 * Parameter source for the `aws-plane` stack — the prerequisites that have to
 * exist in AWS before the operator can do anything at all.
 *
 * Everything here is a declared build-time parameter (see `chant.config.ts`'s
 * `buildParams`), so nothing in `./plane.ts` reads `process.env` and the whole
 * stack folds without executing.
 */

import { params } from "@intentius/chant/params";
import type { NamingParams } from "../lib/naming";
import type { Tier } from "../lib/tiers";
import { resolveAccountId, resolveTarget } from "../lib/target";

/** Where this build deploys: `local` (floci + m80) or `real`. */
export const target = resolveTarget({
  awsEndpointUrl: params.awsEndpointUrl as string | undefined,
  microvmEndpointUrl: params.microvmEndpointUrl as string | undefined,
});

// `?? <default>` mirrors the declared default in chant.config.ts — a safety net
// for anything importing this module outside chant's build pipeline, such as a
// unit test, where setBuildParams never ran.
export const namingParams: NamingParams = {
  project: (params.project as string | undefined) ?? "kmv",
  env: (params.env as string | undefined) ?? "dev",
  instance: (params.instance as string | undefined) ?? "a",
  tier: (params.tier as Tier | undefined) ?? "minimal",
  region: (params.region as string | undefined) ?? "us-east-1",
  accountId: resolveAccountId(target, params.accountId as string | undefined),
  owner: (params.owner as string | undefined) ?? "platform",
};

/** Adoption seams. Per-resource, and independent of both tier and target. */
export type Seam = "provision" | "reference-existing" | "omit";
export type RoleSeam = "provision" | "reference-existing";

export const bucketMode: Seam = (params.bucketMode as Seam | undefined) ?? "provision";
export const bucketName = params.bucketName as string | undefined;

export const buildRoleMode: RoleSeam = (params.buildRoleMode as RoleSeam | undefined) ?? "provision";
export const buildRoleArn = params.buildRoleArn as string | undefined;

export const operatorRoleMode: RoleSeam = (params.operatorRoleMode as RoleSeam | undefined) ?? "provision";
export const operatorRoleArn = params.operatorRoleArn as string | undefined;

/**
 * The pod identity association binds the operator's service account to the
 * operator role. It needs a real EKS cluster, so it is omitted by default
 * against the local target, where k3d stands in for EKS and there is no such
 * API.
 */
export type PodIdentitySeam = "provision" | "omit";
export const podIdentityMode: PodIdentitySeam =
  (params.podIdentityMode as PodIdentitySeam | undefined) ?? (target.target === "local" ? "omit" : "provision");

export const clusterName = params.clusterName as string | undefined;

export const operatorNamespace = (params.operatorNamespace as string | undefined) ?? "kube-microvm-system";

/**
 * The operator's service account name, fixed by the Helm chart. The pod
 * identity association has to name it exactly.
 */
export const OPERATOR_SERVICE_ACCOUNT = "kube-microvm-operator";
