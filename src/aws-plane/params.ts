/**
 * Parameter source for the `aws-plane` stack — the prerequisites that have to
 * exist in AWS before the operator can do anything at all.
 *
 * Everything here is a declared build-time parameter (see `chant.config.ts`'s
 * `buildParams`), so nothing in `./plane.ts` reads `process.env` and the whole
 * stack folds without executing.
 */

import { params } from "@intentius/chant/params";
import { kmvNaming, type NamingParams } from "../lib/naming";
import type { Tier } from "../lib/tiers";
import { optionalAccountId, resolveTarget } from "../lib/target";

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
  // Optional, and only ever a uniqueness suffix on the bucket name. Every ARN
  // this stack emits is composed by CloudFormation from AWS::AccountId at
  // deploy time, so nothing here needs the account to be known at build time.
  accountId: optionalAccountId(target, optional(params.accountId)),
  owner: (params.owner as string | undefined) ?? "platform",
};

/** Adoption seams. Per-resource, and independent of both tier and target. */
export type Seam = "provision" | "reference-existing" | "omit";
export type RoleSeam = "provision" | "reference-existing";

export const bucketMode: Seam = (params.bucketMode as Seam | undefined) ?? "provision";
export const bucketName = optional(params.bucketName);

export const buildRoleMode: RoleSeam = (params.buildRoleMode as RoleSeam | undefined) ?? "provision";
export const buildRoleArn = optional(params.buildRoleArn);

export const operatorRoleMode: RoleSeam = (params.operatorRoleMode as RoleSeam | undefined) ?? "provision";
export const operatorRoleArn = optional(params.operatorRoleArn);

/**
 * The pod identity association binds the operator's service account to the
 * operator role. It needs a real EKS cluster, so it is omitted by default
 * against the local target, where k3d stands in for EKS and there is no such
 * API.
 */
export type PodIdentitySeam = "provision" | "omit";
export const podIdentityMode: PodIdentitySeam =
  (params.podIdentityMode as PodIdentitySeam | undefined) ?? (target.target === "local" ? "omit" : "provision");

const clusterMode = (params.clusterMode as string | undefined) ?? "reference-existing";
/** The provisioned cluster's name is deterministic (the naming key), so under
 * clusterMode=provision the pod identity association binds to it without the
 * caller re-stating it. reference-existing still supplies its own. */
export const clusterName =
  optional(params.clusterName) ??
  (clusterMode === "provision" ? kmvNaming(namingParams).name("cluster", { service: "k8sObject" }) : undefined);

export const operatorNamespace = (params.operatorNamespace as string | undefined) ?? "kube-microvm";

/**
 * The operator's service account name, fixed by the Helm chart. The pod
 * identity association has to name it exactly.
 */
export const OPERATOR_SERVICE_ACCOUNT = "kube-microvm-operator";

/**
 * An unset build parameter arrives as `null`, not `undefined`, so `??` alone
 * never reaches a default and the value serializes as an explicit `null`.
 */
function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
