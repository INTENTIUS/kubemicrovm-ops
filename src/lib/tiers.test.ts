import { describe, expect, test } from "vitest";
import {
  MAX_DURATION_SECONDS,
  MEMORY_SIZES_MIB,
  TIERS,
  hasClass,
  hasNetwork,
  tierProfile,
  type Tier,
} from "./tiers";

describe("tier profiles", () => {
  test("every tier has a profile and the profile knows its own name", () => {
    for (const tier of TIERS) {
      expect(tierProfile(tier).tier).toBe(tier);
    }
  });

  test("an unknown tier fails loudly rather than falling back", () => {
    expect(() => tierProfile("staging" as Tier)).toThrow(/Unknown tier/);
  });

  test("memory is one of the service's five sizes at every tier", () => {
    for (const tier of TIERS) {
      expect(MEMORY_SIZES_MIB).toContain(tierProfile(tier).image.memorySizeMiB);
    }
  });

  test("minimal declares neither a class nor a connector", () => {
    const profile = tierProfile("minimal");
    expect(hasClass(profile)).toBe(false);
    expect(hasNetwork(profile)).toBe(false);
    expect(profile.workload.kind).toBe("MicroVM");
    expect(profile.quotaDiscovery).toBe(false);
  });

  test("both production tiers declare a class, a connector and a replica set", () => {
    for (const tier of ["prod", "prod-ha"] as const) {
      const profile = tierProfile(tier);
      expect(hasClass(profile)).toBe(true);
      expect(hasNetwork(profile)).toBe(true);
      expect(profile.workload.kind).toBe("MicroVMReplicaSet");
      expect(profile.quotaDiscovery).toBe(true);
    }
  });

  test("prod-ha differs from prod in exactly the ways a reader is told it does", () => {
    const prod = tierProfile("prod");
    const ha = tierProfile("prod-ha");

    // Two AZs rather than one.
    expect(ha.network?.subnetCount).toBe(2);
    expect(prod.network?.subnetCount).toBe(1);

    // A replica floor of two rather than one.
    if (ha.workload.kind !== "MicroVMReplicaSet" || prod.workload.kind !== "MicroVMReplicaSet") {
      throw new Error("both production tiers must use a replica set");
    }
    expect(ha.workload.replicas).toBe(2);
    expect(ha.workload.minReady).toBe(2);
    expect(prod.workload.replicas).toBe(1);

    // A hard lifetime cap, which prod does not set at all.
    expect(ha.class?.maximumDurationSeconds).toBe(MAX_DURATION_SECONDS);
    expect(prod.class?.maximumDurationSeconds).toBeUndefined();

    // The image is identical — the tiers differ in shape, not in artifact.
    expect(ha.image).toEqual(prod.image);
  });

  test("no tier asks for a duration beyond the service's 8h ceiling", () => {
    for (const tier of TIERS) {
      const klass = tierProfile(tier).class;
      if (!klass) continue;
      expect(klass.maxIdleDurationSeconds).toBeLessThanOrEqual(MAX_DURATION_SECONDS);
      expect(klass.maximumDurationSeconds ?? 0).toBeLessThanOrEqual(MAX_DURATION_SECONDS);
    }
  });

  test("a rolling update never drops below the floor", () => {
    for (const tier of ["prod", "prod-ha"] as const) {
      const workload = tierProfile(tier).workload;
      if (workload.kind !== "MicroVMReplicaSet") throw new Error("expected a replica set");
      expect(workload.maxUnavailable).toBe(0);
      expect(workload.minReady).toBeLessThanOrEqual(workload.replicas);
    }
  });
});
