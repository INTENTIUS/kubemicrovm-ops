/**
 * What the declared local cluster emits (the k3d lexicon port).
 *
 * The emitted SimpleConfig is what `k3d cluster create --config` consumes,
 * so the assertions pin the port's faithfulness to the flags the script
 * carried (`--agents 1`, loadbalancer left in) and the one deliberate
 * decision that is new: the kubeconfig entry is written but the ambient
 * context is never switched — local-up.sh switches explicitly, once.
 */

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";
import { describe, expect, test } from "vitest";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

interface SimpleConfig {
  apiVersion: string;
  metadata: { name: string };
  servers: number;
  agents: number;
  options?: {
    k3d?: { disableLoadbalancer?: boolean };
    kubeconfig?: { updateDefaultKubeconfig?: boolean; switchCurrentContext?: boolean };
    runtime?: { labels?: Array<{ label: string }> };
  };
}

function build(): SimpleConfig {
  const stdout = execFileSync("npx", ["chant", "build", "cluster", "--format", "yaml"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return load(stdout) as SimpleConfig;
}

describe("the declared local cluster", () => {
  const config = build();

  test("is the shape the script always created: one server, one agent, loadbalancer in", () => {
    expect(config.metadata.name).toBe("kubemicrovm-local");
    expect(config.servers).toBe(1);
    expect(config.agents).toBe(1);
    expect(config.options?.k3d?.disableLoadbalancer).toBeUndefined();
  });

  test("writes the kubeconfig entry and never repoints the ambient context", () => {
    expect(config.options?.kubeconfig?.updateDefaultKubeconfig).toBe(true);
    expect(config.options?.kubeconfig?.switchCurrentContext).toBe(false);
  });

  test("carries chant's ownership marker as node labels", () => {
    const labels = (config.options?.runtime?.labels ?? []).map((l) => l.label);
    expect(labels.some((l) => l.startsWith("app.kubernetes.io/managed-by=chant"))).toBe(true);
    expect(labels.some((l) => l.startsWith("chant.intentius.io/stack="))).toBe(true);
  });
});
