/**
 * Naming and tagging for a KubeMicroVM deployment.
 *
 * One function derives both the physical names and the tags, from the same
 * params, so nothing in a composite hardcodes a name, an ARN, or a region.
 *
 * Key: `{project}-{env}-{instance}-{resource}`. The `instance` segment is what
 * keeps two deployments collision-free in one account or one cluster.
 *
 * Two constraint families apply, and they are not the same:
 *
 *   AWS   S3 bucket names are globally unique and capped at 63 characters;
 *         IAM role names are capped at 64.
 *   k8s   object names are DNS-1123 labels — lowercase alphanumeric and
 *         hyphens, 63 characters, starting and ending alphanumeric.
 *
 * The sanitiser below satisfies both, so one helper covers both planes.
 */

import { createHash } from "node:crypto";
import type { Tier } from "./tiers";

export interface NamingParams {
  project: string;
  env: string;
  instance: string;
  tier: Tier;
  region: string;
  /** Known against real AWS; the emulator account against the local target. */
  accountId?: string;
  owner: string;
}

/** Name constraints this helper knows how to satisfy. */
export type ServiceKind = "default" | "s3Bucket" | "iamRole" | "k8sObject";

interface Limit {
  maxLength: number;
  /** Append an account/region-derived suffix, for names unique beyond this account. */
  globallyUnique?: boolean;
}

const LIMITS: Record<ServiceKind, Limit> = {
  default: { maxLength: 63 },
  s3Bucket: { maxLength: 63, globallyUnique: true },
  iamRole: { maxLength: 64 },
  k8sObject: { maxLength: 63 },
};

const HASH_LEN = 6;

export interface Naming {
  name(resource: string, opts?: { service?: ServiceKind }): string;
  /** AWS resource tags, and the same set as k8s labels via `labels()`. */
  tags(extra?: Record<string, string>): Record<string, string>;
  /** k8s labels. Same values as `tags()`, keyed the way Kubernetes expects. */
  labels(extra?: Record<string, string>): Record<string, string>;
}

export function kmvNaming(params: NamingParams): Naming {
  const base = [params.project, params.env, params.instance].map(sanitize).filter(Boolean).join("-");

  return {
    name(resource, opts) {
      const limit = LIMITS[opts?.service ?? "default"];
      let value = sanitize(`${base}-${resource}`);
      if (limit.globallyUnique) value = `${value}-${uniqueSuffix(params)}`;
      return truncateWithHash(value, limit.maxLength);
    },

    tags(extra) {
      return {
        project: params.project,
        env: params.env,
        instance: params.instance,
        tier: params.tier,
        owner: params.owner,
        ...extra,
      };
    },

    labels(extra) {
      return {
        "app.kubernetes.io/name": sanitize(params.project),
        "app.kubernetes.io/instance": sanitize(`${params.env}-${params.instance}`),
        "app.kubernetes.io/managed-by": "chant",
        "kubemicrovm-ops/tier": params.tier,
        ...extra,
      };
    },
  };
}

/**
 * Free-function form, for the one place a name is needed outside a composite:
 * an `outputs.ts` re-deriving a name that was set as an input prop, where there
 * is no attribute to read it back from. A method call on a bound object is
 * structurally unfoldable — chant resolves a call whose callee is a plain
 * imported identifier, and `naming.name(...)` is a property access.
 */
export function kmvName(params: NamingParams, resource: string, opts?: { service?: ServiceKind }): string {
  return kmvNaming(params).name(resource, opts);
}

/** The label the admission webhook requires on any namespace holding MicroVMs. */
export const MANAGED_NAMESPACE_LABEL = "lambda.aws.amazon.com/manage-microvms";

/**
 * Marks the operator's own namespace as this kit's, so a check can tell it
 * apart from a namespace nothing uses.
 *
 * It holds the chart's objects and none of this project's, so "does anything
 * declared live here" is the wrong question to ask of it — KMV022 asked
 * exactly that and flagged it. A namespace the kit creates on purpose says so.
 */
export const OPERATOR_NAMESPACE_LABEL = "kubemicrovm-ops/role";

/** Lowercase, collapse anything outside `[a-z0-9-]` to a hyphen, trim hyphens. */
function sanitize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function shortHash(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, HASH_LEN);
}

function uniqueSuffix(params: NamingParams): string {
  return shortHash(`${params.accountId ?? "no-account"}:${params.region}`);
}

/**
 * Truncate to `maxLength`, replacing the overflow tail with a hash of the full
 * string, so two names sharing a long prefix stay distinct after truncation.
 */
function truncateWithHash(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const hash = shortHash(value);
  const keep = Math.max(maxLength - hash.length - 1, 1);
  return `${value.slice(0, keep)}-${hash}`.slice(0, maxLength);
}
