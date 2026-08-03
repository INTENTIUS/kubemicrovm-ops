/**
 * What each tier actually emits, asserted against a real `chant build`.
 *
 * The unit tests in `src/lib/tiers.test.ts` check the profile table. This
 * checks that the table reaches the manifests, and — more usefully — that every
 * field name in `src/workload/workload.ts` is one KubeMicroVM's CRDs actually
 * define. A typo in a custom-resource spec is accepted by the API server and
 * ignored by the controller, so a misspelled `className` is a VM that silently
 * runs with the wrong policy. Nothing but a check against the schema catches it.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { load, loadAll } from "js-yaml";
import { beforeAll, describe, expect, test } from "vitest";
import { TIERS, type Tier } from "../src/lib/tiers";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const crdDir = join(root, "crds");

interface Manifest {
  apiVersion: string;
  kind: string;
  metadata: { name: string; namespace?: string; labels?: Record<string, string> };
  spec?: Record<string, unknown>;
}

function build(tier: Tier): Manifest[] {
  const stdout = execFileSync(
    "npx",
    ["chant", "build", "src/workload", "--lexicon", "k8s"],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        KMV_TIER: tier,
        AWS_ENDPOINT_URL: "http://localhost:4566",
        KMV_BUCKET_NAME: "kmv-artifacts",
        KMV_BUILD_ROLE_ARN: "arn:aws:iam::000000000000:role/build",
        KMV_OPERATOR_ROLE_ARN: "arn:aws:iam::000000000000:role/operator",
        KMV_SUBNET_IDS: "subnet-a,subnet-b,subnet-c",
        KMV_SECURITY_GROUP_IDS: "sg-1",
      },
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return (loadAll(stdout) as Manifest[]).filter(Boolean);
}

/** The spec property names each CRD declares, read from the pinned chart. */
function crdSpecProperties(file: string): Set<string> {
  const doc = load(readFileSync(join(crdDir, file), "utf8")) as {
    spec: { versions: Array<{ schema?: { openAPIV3Schema?: { properties?: { spec?: { properties?: Record<string, unknown> } } } } }> };
  };
  const schema = doc.spec.versions[0]?.schema?.openAPIV3Schema?.properties?.spec?.properties ?? {};
  return new Set(Object.keys(schema));
}

const CRD_FILES: Record<string, string> = {
  MicroVM: "microvms.lambda.aws.amazon.com-v1.yml",
  MicroVMImage: "microvmimages.lambda.aws.amazon.com-v1.yml",
  MicroVMClass: "microvmclasses.lambda.aws.amazon.com-v1.yml",
  MicroVMNetwork: "microvmnetworks.lambda.aws.amazon.com-v1.yml",
  MicroVMReplicaSet: "microvmreplicasets.lambda.aws.amazon.com-v1.yml",
};

const built: Partial<Record<Tier, Manifest[]>> = {};

beforeAll(() => {
  for (const tier of TIERS) built[tier] = build(tier);
});

function kinds(tier: Tier): string[] {
  return (built[tier] ?? []).map((m) => m.kind);
}

function ofKind(tier: Tier, kind: string): Manifest | undefined {
  return (built[tier] ?? []).find((m) => m.kind === kind);
}

describe("what each tier declares", () => {
  test("minimal is a namespace pair, an image and one VM", () => {
    expect(kinds("minimal").sort()).toEqual(["MicroVM", "MicroVMImage", "Namespace", "Namespace"].sort());
  });

  test("prod adds a class, a connector, and a replica set instead of the VM", () => {
    const declared = kinds("prod");
    expect(declared).toContain("MicroVMClass");
    expect(declared).toContain("MicroVMNetwork");
    expect(declared).toContain("MicroVMReplicaSet");
    expect(declared).not.toContain("MicroVM");
  });

  test("prod-ha declares the same kinds as prod", () => {
    expect(kinds("prod-ha").sort()).toEqual(kinds("prod").sort());
  });
});

describe("the workload namespace carries the label the webhook requires", () => {
  test.each(TIERS)("%s", (tier) => {
    const namespaces = (built[tier] ?? []).filter((m) => m.kind === "Namespace");
    const labelled = namespaces.filter(
      (ns) => ns.metadata.labels?.["lambda.aws.amazon.com/manage-microvms"] === "true",
    );
    expect(labelled).toHaveLength(1);

    // Every custom resource lands in that namespace and no other.
    const customResources = (built[tier] ?? []).filter((m) => m.apiVersion.startsWith("lambda.aws.amazon.com/"));
    expect(customResources.length).toBeGreaterThan(0);
    for (const cr of customResources) {
      expect(cr.metadata.namespace).toBe(labelled[0].metadata.name);
    }
  });
});

describe("every emitted spec field exists in the CRD schema", () => {
  test.each(TIERS)("%s", (tier) => {
    for (const manifest of built[tier] ?? []) {
      const file = CRD_FILES[manifest.kind];
      if (!file) continue;
      const allowed = crdSpecProperties(file);
      for (const field of Object.keys(manifest.spec ?? {})) {
        expect(allowed, `${manifest.kind}.spec.${field} is not in the CRD schema`).toContain(field);
      }
    }
  });

  test("a replica set's template is checked against the MicroVM spec, not its own", () => {
    const rs = ofKind("prod-ha", "MicroVMReplicaSet");
    const template = rs?.spec?.template as Record<string, unknown> | undefined;
    expect(template).toBeDefined();
    const allowed = crdSpecProperties(CRD_FILES.MicroVM);
    for (const field of Object.keys(template ?? {})) {
      expect(allowed, `template.${field} is not a MicroVM spec field`).toContain(field);
    }
  });
});

describe("cross-resource references resolve to something declared", () => {
  test.each(TIERS)("%s", (tier) => {
    const manifests = built[tier] ?? [];
    const names = new Set(manifests.map((m) => m.kind + "/" + m.metadata.name));

    const vmSpec = (ofKind(tier, "MicroVM")?.spec ??
      (ofKind(tier, "MicroVMReplicaSet")?.spec?.template as Record<string, unknown>)) as Record<string, unknown>;

    expect(names.has(`MicroVMImage/${vmSpec.imageRef}`)).toBe(true);
    if (vmSpec.className) expect(names.has(`MicroVMClass/${vmSpec.className}`)).toBe(true);
    if (vmSpec.networkRef) expect(names.has(`MicroVMNetwork/${vmSpec.networkRef}`)).toBe(true);
  });
});

describe("the multi-AZ tier is multi-AZ", () => {
  test("prod takes one subnet and prod-ha takes two, from the same input", () => {
    const prod = ofKind("prod", "MicroVMNetwork")?.spec?.subnetIds as string[];
    const ha = ofKind("prod-ha", "MicroVMNetwork")?.spec?.subnetIds as string[];
    expect(prod).toHaveLength(1);
    expect(ha).toHaveLength(2);
  });
});
