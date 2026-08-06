/**
 * The cluster plane (clusterMode=provision): the whole VPC+EKS estate from
 * the aws lexicon's composites, tier-shaping only the node group. Off by
 * default — reference-existing keeps the plane an input, and the build
 * throws like every all-omitted stack.
 */

import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const build = (tier: string) =>
  JSON.parse(
    execFileSync(
      "npx",
      ["chant", "build", "src/cluster-plane", "--lexicon", "aws", "--param", "clusterMode=provision"],
      { cwd: root, encoding: "utf8", env: { ...process.env, KMV_TIER: tier }, maxBuffer: 16 * 1024 * 1024 },
    ),
  ) as { Resources: Record<string, { Type: string; Properties: Record<string, unknown> }> };

describe("cluster plane", () => {
  test("provision declares the whole plane: 2-AZ VPC, cluster, node group, both roles", () => {
    const t = build("prod-ha");
    const count = (type: string) => Object.values(t.Resources).filter((r) => r.Type === type).length;
    expect(count("AWS::EKS::Cluster")).toBe(1);
    expect(count("AWS::EKS::Nodegroup")).toBe(1);
    expect(count("AWS::IAM::Role")).toBe(2);
    expect(count("AWS::EC2::Subnet")).toBe(4); // public+private × 2 AZs
    expect(count("AWS::EC2::NatGateway")).toBe(1);
  });

  test("the tier shapes the node group: minimal 1, prod-ha 2 with headroom", () => {
    const ng = (tier: string) =>
      (Object.values(build(tier).Resources).find((r) => r.Type === "AWS::EKS::Nodegroup")!
        .Properties.ScalingConfig as { DesiredSize: number; MaxSize: number });
    expect(ng("minimal")).toMatchObject({ DesiredSize: 1, MaxSize: 1 });
    expect(ng("prod-ha")).toMatchObject({ DesiredSize: 2, MaxSize: 4 });
  });

  test("the nodes land in the private subnets", () => {
    const t = build("prod");
    const ng = Object.values(t.Resources).find((r) => r.Type === "AWS::EKS::Nodegroup")!;
    const subnets = JSON.stringify(ng.Properties.Subnets);
    expect(subnets).toContain("PrivateSubnet1");
    expect(subnets).toContain("PrivateSubnet2");
    expect(subnets).not.toContain("PublicSubnet");
  });

  test("reference-existing (the default): nothing declared, the build throws", () => {
    expect(() =>
      execFileSync("npx", ["chant", "build", "src/cluster-plane", "--lexicon", "aws"], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      }),
    ).toThrow();
  });
});
