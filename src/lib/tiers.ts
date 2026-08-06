/**
 * The three deployment tiers, and the one place their differences live.
 *
 * Every value here comes from a field that exists in KubeMicroVM's own CRDs at
 * the pinned chart release (see `crds/` in
 * `oci://ghcr.io/codriverlabs/helm/kube-microvm-operator:1.0.11`). Nothing is
 * invented to make the table look symmetrical: where a tier has no answer for
 * a knob, the resource carrying that knob is not declared at all.
 *
 * The tier is a parameter, not a directory. No tier has its own files, and no
 * file branches on the tier except by reading this profile.
 */

export type Tier = "minimal" | "prod" | "prod-ha";

export const TIERS: readonly Tier[] = ["minimal", "prod", "prod-ha"] as const;

/**
 * The five memory sizes the MicroVMs service accepts, in MiB. These are the
 * service's runtime profiles and have nothing to do with deployment tiers —
 * the collision in the word "tier" is unfortunate and this is the only place
 * both meanings appear.
 */
export const MEMORY_SIZES_MIB = [512, 1024, 2048, 4096, 8192] as const;
export type MemorySizeMiB = (typeof MEMORY_SIZES_MIB)[number];

/** `MicroVMClass.spec` caps `maximumDurationSeconds` and `maxIdleDurationSeconds` at 8h. */
export const MAX_DURATION_SECONDS = 28800;

/** `MicroVMImage.spec` — the built artifact. Present at every tier. */
export interface ImageProfile {
  /** `memorySizeMiB`. Memory is an image property, not a class property. */
  memorySizeMiB: MemorySizeMiB;
  /** `maxVersionsToKeep` — how many built versions the operator retains. */
  maxVersionsToKeep: number;
  /** `buildTimeoutSeconds` — how long a build may run before it fails. */
  buildTimeoutSeconds: number;
  /** `autoActivate` — whether a finished build becomes the active version. */
  autoActivate: boolean;
}

/**
 * The idle policy a VM cannot be created without. `CreateMicroVm` refuses a
 * null `idlePolicy.maxIdleDurationSeconds` or `.suspendedDurationSeconds`
 * with a ValidationException — found on the real service 2026-08-06, after
 * m80 had accepted the nulls for a month. There is no service default to
 * take, so every tier declares one: the production tiers through their
 * `MicroVMClass`, `minimal` flat on the VM spec, where the CRD carries the
 * same three fields.
 */
export interface IdleProfile {
  maxIdleDurationSeconds: number;
  suspendedDurationSeconds: number;
  autoResumeEnabled: boolean;
}

/**
 * `MicroVMClass.spec` — the idle and lifetime policy a VM inherits by name.
 * Absent at `minimal`, which declares no class and carries its idle policy
 * (see `IdleProfile`) on the VM itself.
 */
export interface ClassProfile {
  maxIdleDurationSeconds: number;
  suspendedDurationSeconds: number;
  autoResumeEnabled: boolean;
  /** Omitted where a deployment does not want a hard lifetime ceiling. */
  maximumDurationSeconds?: number;
  ingressNetworkConnectors: string[];
  egressNetworkConnectors: string[];
}

/**
 * `MicroVMNetwork.spec` — the VPC egress connector. Absent at `minimal`, which
 * uses the service's managed egress and declares no connector.
 *
 * `subnetCount` is how many of the supplied subnets this tier uses, which is
 * the only thing that distinguishes single-AZ from multi-AZ once the subnets
 * themselves are an input.
 */
export interface NetworkProfile {
  /**
   * `MicroVMNetwork.spec.networkProtocol`. The CRD types this as an open
   * string, but the service accepts only `IPv4` or `DualStack` — anything else
   * fails at reconcile with "Member must satisfy enum value set: [IPv4,
   * DualStack]". Constrained here so the schema's silence costs nobody a
   * debugging session.
   */
  networkProtocol: NetworkProtocol;
  subnetCount: number;
}

/** The two values the service accepts, though the CRD schema does not say so. */
export const NETWORK_PROTOCOLS = ["IPv4", "DualStack"] as const;
export type NetworkProtocol = (typeof NETWORK_PROTOCOLS)[number];

/**
 * How the VMs themselves are declared. `minimal` declares a single `MicroVM`;
 * the production tiers declare a `MicroVMReplicaSet` whose `template` carries
 * the same spec a bare `MicroVM` would.
 */
export type WorkloadProfile =
  | { kind: "MicroVM" }
  | {
      kind: "MicroVMReplicaSet";
      replicas: number;
      minReady: number;
      maxSurge: number;
      maxUnavailable: number;
      updateStrategyType: string;
      scaleDown: { policy: string; stabilizationWindowSeconds: number };
    };

export interface TierProfile {
  tier: Tier;
  /** One line, used in generated descriptions and in the docs table. */
  intent: string;
  image: ImageProfile;
  class?: ClassProfile;
  /**
   * The VM-level idle policy for tiers that declare no class. Exactly one of
   * `class` and `vmIdle` must be present — the create call requires an idle
   * policy from somewhere, and `test/tier-matrix.test.ts` enforces the
   * either-or.
   */
  vmIdle?: IdleProfile;
  network?: NetworkProfile;
  workload: WorkloadProfile;
  /**
   * Whether the operator is told to discover service quotas at startup. Off at
   * `minimal` because it is one more IAM permission for no benefit on a
   * single-VM deployment, and because it falls back cleanly when absent.
   */
  quotaDiscovery: boolean;
}

const PROFILES: Record<Tier, TierProfile> = {
  minimal: {
    tier: "minimal",
    intent: "Evaluate the kit. One namespace, one image, one VM.",
    image: {
      memorySizeMiB: 2048,
      maxVersionsToKeep: 2,
      buildTimeoutSeconds: 600,
      autoActivate: true,
    },
    // Same numbers as the production classes, for the same reasons: an
    // evaluation VM nobody touches for fifteen minutes suspends, traffic
    // resumes it. On the VM rather than in a class because the create call
    // requires the policy and `minimal` declares no class to carry it.
    vmIdle: {
      maxIdleDurationSeconds: 900,
      suspendedDurationSeconds: 3600,
      autoResumeEnabled: true,
    },
    workload: { kind: "MicroVM" },
    quotaDiscovery: false,
  },

  prod: {
    tier: "prod",
    intent: "Adoptable single-AZ deployment with an idle policy and VPC egress.",
    image: {
      memorySizeMiB: 4096,
      maxVersionsToKeep: 5,
      buildTimeoutSeconds: 900,
      autoActivate: true,
    },
    class: {
      // 15 minutes idle before the service suspends, an hour suspended before
      // it terminates, and traffic brings a suspended VM back rather than
      // failing the request.
      maxIdleDurationSeconds: 900,
      suspendedDurationSeconds: 3600,
      autoResumeEnabled: true,
      ingressNetworkConnectors: ["ALL_INGRESS"],
      egressNetworkConnectors: ["INTERNET_EGRESS"],
    },
    network: { networkProtocol: "IPv4", subnetCount: 1 },
    workload: {
      kind: "MicroVMReplicaSet",
      replicas: 1,
      minReady: 1,
      maxSurge: 1,
      maxUnavailable: 0,
      updateStrategyType: "RollingUpdate",
      scaleDown: { policy: "OldestFirst", stabilizationWindowSeconds: 300 },
    },
    quotaDiscovery: true,
  },

  "prod-ha": {
    tier: "prod-ha",
    intent: "Adoptable multi-AZ deployment with a replica floor and a lifetime cap.",
    image: {
      memorySizeMiB: 4096,
      maxVersionsToKeep: 5,
      buildTimeoutSeconds: 900,
      autoActivate: true,
    },
    class: {
      maxIdleDurationSeconds: 900,
      suspendedDurationSeconds: 3600,
      autoResumeEnabled: true,
      // The one knob that only appears here: a hard ceiling on how long any
      // single VM may live, so a wedged instance is recycled rather than
      // held. 8h is the service maximum.
      maximumDurationSeconds: MAX_DURATION_SECONDS,
      ingressNetworkConnectors: ["ALL_INGRESS"],
      egressNetworkConnectors: ["INTERNET_EGRESS"],
    },
    network: { networkProtocol: "IPv4", subnetCount: 2 },
    workload: {
      kind: "MicroVMReplicaSet",
      replicas: 2,
      minReady: 2,
      maxSurge: 1,
      maxUnavailable: 0,
      updateStrategyType: "RollingUpdate",
      scaleDown: { policy: "OldestFirst", stabilizationWindowSeconds: 600 },
    },
    quotaDiscovery: true,
  },
};

export function tierProfile(tier: Tier): TierProfile {
  const profile = PROFILES[tier];
  if (!profile) {
    throw new Error(`Unknown tier "${tier}". Expected one of: ${TIERS.join(", ")}`);
  }
  return profile;
}

/** True when this tier declares a `MicroVMClass` the VMs reference by name. */
export function hasClass(profile: TierProfile): boolean {
  return profile.class !== undefined;
}

/** True when this tier declares a `MicroVMNetwork` connector. */
export function hasNetwork(profile: TierProfile): boolean {
  return profile.network !== undefined;
}
