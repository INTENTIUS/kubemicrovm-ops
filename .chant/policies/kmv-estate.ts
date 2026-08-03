/**
 * KMV001, KMV002, KMV004, KMV020, KMV022 — the rules that are about the estate
 * rather than about a file.
 *
 * These are `PostSynthCheck`s under `lint.policies`, not `LintRule`s under
 * `.chant/rules/`, and the difference is the whole reason they can exist.
 * A `LintRule` sees one source file: it cannot know whether the namespace a
 * custom resource names is one this project declares, because that is two
 * files. A `PostSynthCheck` sees every serialized output at once, which is the
 * layer these questions live at.
 *
 * The operator's admission webhook is the authority for all of them. It runs
 * at apply time and names the *resource* rather than the namespace, so its
 * rejection points a long way from the cause. These arrive at build time, all
 * at once, before anything is applied.
 */

import type { PostSynthCheck, PostSynthContext, PostSynthDiagnostic } from "@intentius/chant/lint/post-synth";

/** The label the webhook requires on any namespace holding MicroVM resources. */
const MANAGED_LABEL = "lambda.aws.amazon.com/manage-microvms";

const CRD_GROUP = "lambda.aws.amazon.com/";

interface Manifest {
  apiVersion?: string;
  kind?: string;
  metadata?: { name?: string; namespace?: string; labels?: Record<string, string> };
  spec?: Record<string, unknown>;
}

/**
 * Every Kubernetes document this build emitted.
 *
 * `outputs` is keyed by lexicon and holds serialized text, so the k8s ones are
 * a multi-document YAML string. Parsed structurally rather than with a YAML
 * library: these are chant's own emissions, not arbitrary input, and the shapes
 * a check needs — apiVersion, kind, metadata, and one level of spec — are flat.
 */
function manifests(ctx: PostSynthContext): Manifest[] {
  const out: Manifest[] = [];
  for (const [lexicon, text] of ctx.outputs) {
    if (lexicon !== "k8s" || typeof text !== "string") continue;
    for (const doc of text.split(/^---$/m)) {
      const parsed = parseDoc(doc);
      if (parsed.kind) out.push(parsed);
    }
  }
  return out;
}

/** Minimal reader for the flat, chant-emitted subset these checks need. */
function parseDoc(doc: string): Manifest {
  const m: Manifest = {};
  const meta: NonNullable<Manifest["metadata"]> = {};
  const labels: Record<string, string> = {};
  const spec: Record<string, unknown> = {};
  let section: "" | "metadata" | "labels" | "spec" = "";

  for (const raw of doc.split("\n")) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    const [key, ...rest] = line.split(":");
    const value = rest.join(":").trim().replace(/^['"]|['"]$/g, "");

    if (indent === 0) {
      section = key === "metadata" ? "metadata" : key === "spec" ? "spec" : "";
      if (key === "apiVersion") m.apiVersion = value;
      if (key === "kind") m.kind = value;
      continue;
    }
    if (section === "metadata" && indent === 2) {
      if (key === "labels") { section = "labels"; continue; }
      if (key === "name") meta.name = value;
      if (key === "namespace") meta.namespace = value;
    } else if (section === "labels" && indent >= 4) {
      labels[key.trim()] = value;
    } else if (section === "labels" && indent === 2) {
      if (key === "name") meta.name = value;
      if (key === "namespace") meta.namespace = value;
    } else if (section === "spec" && indent === 2 && value) {
      spec[key] = value;
    }
  }

  if (Object.keys(labels).length) meta.labels = labels;
  if (Object.keys(meta).length) m.metadata = meta;
  if (Object.keys(spec).length) m.spec = spec;
  return m;
}

const isCustomResource = (m: Manifest): boolean => (m.apiVersion ?? "").startsWith(CRD_GROUP);

function diag(id: string, message: string, entity?: string): PostSynthDiagnostic {
  return { checkId: id, severity: "error", message, entity, lexicon: "k8s" };
}

/**
 * KMV001 — every MicroVM custom resource sits in a namespace this build
 * declares with the manage label.
 *
 * The webhook rejects one that does not, and the rejection names the custom
 * resource: "admission webhook denied the request" against a `MicroVM`, when
 * what is wrong is a `Namespace` in a different file.
 */
export const managedNamespaceCheck: PostSynthCheck = {
  id: "KMV001",
  description: "MicroVM custom resources must live in a namespace labelled for the operator to manage",
  check(ctx) {
    const all = manifests(ctx);
    const labelled = new Set(
      all
        .filter((m) => m.kind === "Namespace" && m.metadata?.labels?.[MANAGED_LABEL] === "true")
        .map((m) => m.metadata?.name)
        .filter((n): n is string => Boolean(n)),
    );

    const out: PostSynthDiagnostic[] = [];
    for (const cr of all.filter(isCustomResource)) {
      const ns = cr.metadata?.namespace;
      if (!ns) {
        out.push(diag("KMV001", `${cr.kind} "${cr.metadata?.name}" has no namespace — the operator only manages labelled namespaces, and the default one is not labelled by this project.`, cr.metadata?.name));
        continue;
      }
      if (labelled.has(ns)) continue;
      out.push(diag("KMV001",
        `${cr.kind} "${cr.metadata?.name}" is in namespace "${ns}", which this project does not declare with ${MANAGED_LABEL}=true. The admission webhook will reject the resource, naming the resource rather than the namespace.`,
        cr.metadata?.name));
    }
    return out;
  },
};

/**
 * KMV002 and KMV004 — a reference resolves to something declared.
 *
 * `imageRef`, `className` and `networkRef` are plain strings in the CRD, so a
 * typo is a resource that reconciles against nothing. The operator does not
 * treat a dangling reference as an error at apply time; it simply never
 * becomes ready.
 */
export const referenceCheck: PostSynthCheck = {
  id: "KMV002",
  description: "imageRef, className and networkRef must resolve to a resource declared in the same namespace",
  check(ctx) {
    const all = manifests(ctx);
    const declared = (kind: string): Set<string> =>
      new Set(all.filter((m) => m.kind === kind).map((m) => `${m.metadata?.namespace}/${m.metadata?.name}`));

    const images = declared("MicroVMImage");
    const classes = declared("MicroVMClass");
    const networks = declared("MicroVMNetwork");

    const out: PostSynthDiagnostic[] = [];
    for (const cr of all.filter((m) => m.kind === "MicroVM" || m.kind === "MicroVMReplicaSet")) {
      const ns = cr.metadata?.namespace;
      const name = cr.metadata?.name;
      // A replica set carries the same fields nested under `template`, which
      // the flat reader does not descend into. Checked at the source layer by
      // test/tier-matrix.test.ts until this reader grows a nesting rule.
      if (cr.kind !== "MicroVM") continue;
      const check = (field: string, set: Set<string>, kind: string): void => {
        const ref = cr.spec?.[field];
        if (typeof ref !== "string" || !ref) return;
        if (set.has(`${ns}/${ref}`)) return;
        out.push(diag("KMV002",
          `${cr.kind} "${name}" references ${field} "${ref}", which is not a ${kind} declared in namespace "${ns}". The resource will apply cleanly and never become ready.`,
          name));
      };
      check("imageRef", images, "MicroVMImage");
      check("className", classes, "MicroVMClass");
      check("networkRef", networks, "MicroVMNetwork");
    }
    return out;
  },
};

/**
 * KMV020 — an image nothing references.
 *
 * A warning rather than an error: building an image no VM uses is wasteful and
 * occasionally deliberate, for instance while a tier is being promoted.
 */
export const orphanImageCheck: PostSynthCheck = {
  id: "KMV020",
  description: "Every MicroVMImage should be referenced by a VM or a replica set",
  check(ctx) {
    const all = manifests(ctx);
    const referenced = new Set(
      all
        .filter((m) => m.kind === "MicroVM")
        .map((m) => m.spec?.imageRef)
        .filter((r): r is string => typeof r === "string"),
    );
    // A replica set's imageRef lives under `template`, which the flat reader
    // does not reach — so a project whose only consumer is a replica set would
    // see a false positive. Both production tiers are that shape, so this
    // check is scoped to builds that declare a bare MicroVM at all.
    if (!all.some((m) => m.kind === "MicroVM")) return [];

    return all
      .filter((m) => m.kind === "MicroVMImage" && m.metadata?.name && !referenced.has(m.metadata.name))
      .map((m) => ({
        checkId: "KMV020",
        severity: "warning" as const,
        message: `MicroVMImage "${m.metadata?.name}" is not referenced by any MicroVM in this build. It will be built and never run.`,
        entity: m.metadata?.name,
        lexicon: "k8s",
      }));
  },
};
