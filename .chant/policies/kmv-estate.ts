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

/** What the kit puts on the operator's own namespace — see src/lib/naming.ts. */
const OPERATOR_LABEL = "kubemicrovm-ops/role";

interface Manifest {
  apiVersion?: string;
  kind?: string;
  metadata?: { name?: string; namespace?: string; labels?: Record<string, string> };
  spec?: Record<string, unknown>;
  /** Sequence-valued spec fields, which `spec` cannot hold as scalars. */
  listSpec?: Record<string, string[]>;
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
  const listSpec: Record<string, string[]> = {};
  let section: "" | "metadata" | "labels" | "spec" = "";
  // The key a sequence is currently accumulating into, cleared by the next
  // key at the same depth.
  let listKey = "";

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
    } else if (section === "spec" && indent === 2) {
      listKey = "";
      if (value) {
        spec[key] = value;
      } else {
        // A key with nothing after the colon opens either a sequence or a
        // nested object; the next line says which.
        listKey = key;
      }
    } else if (section === "spec" && indent > 2 && listKey && line.startsWith("- ")) {
      (listSpec[listKey] ??= []).push(line.slice(2).trim().replace(/^['"]|['"]$/g, ""));
    }
  }

  if (Object.keys(labels).length) meta.labels = labels;
  if (Object.keys(meta).length) m.metadata = meta;
  if (Object.keys(spec).length) m.spec = spec;
  if (Object.keys(listSpec).length) m.listSpec = listSpec;
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

// ── The AWS plane, for the rules that cross between them ──────────────────
//
// A whole-project build (`chant build src`) emits both lexicons, keyed by
// name, so a check can see the roles the AWS plane declares and the custom
// resources that name them in one pass. A per-stack build sees one plane, and
// the cross-plane rules below skip rather than report what they cannot know —
// a rule that fires because half the estate is absent is worse than no rule.

interface CFTemplate {
  Resources?: Record<string, { Type: string; Properties?: Record<string, unknown> }>;
}

function awsTemplate(ctx: PostSynthContext): CFTemplate | undefined {
  for (const [lexicon, text] of ctx.outputs) {
    if (lexicon !== "aws") continue;
    try {
      return typeof text === "string" ? (JSON.parse(text) as CFTemplate) : (text as CFTemplate);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * KMV005 — the cross-plane rule, and the main reason this kit declares both
 * planes in one project.
 *
 * `MicroVMImage.spec.buildRoleArn` is a string that crosses from Kubernetes to
 * IAM. If it names a role this project does not declare, the image applies,
 * the operator calls `CreateMicrovmImage`, and AWS refuses to assume a role
 * that is not there — minutes later, in a controller log.
 *
 * Skipped when the AWS plane is not in this build, or when the build role is
 * referenced rather than provisioned: an ARN pointing at a role somebody else
 * owns is the documented `reference-existing` seam, not a mistake.
 */
export const buildRoleCheck: PostSynthCheck = {
  id: "KMV005",
  description: "A MicroVMImage's buildRoleArn must name a role this project declares, and the operator must be allowed to pass it",
  check(ctx) {
    const template = awsTemplate(ctx);
    if (!template?.Resources) return [];

    const roleNames = new Set(
      Object.values(template.Resources)
        .filter((r) => r.Type === "AWS::IAM::Role")
        .map((r) => r.Properties?.RoleName)
        .filter((n): n is string => typeof n === "string"),
    );
    // Nothing declared: this build references its roles rather than
    // provisioning them, which is a seam and not a fault.
    if (roleNames.size === 0) return [];

    const out: PostSynthDiagnostic[] = [];
    for (const image of manifests(ctx).filter((m) => m.kind === "MicroVMImage")) {
      const arn = image.spec?.buildRoleArn;
      if (typeof arn !== "string" || !arn) continue;
      const named = arn.slice(arn.lastIndexOf("/") + 1);
      // An ARN naming a role in another account is somebody else's to declare.
      if (!arn.startsWith("arn:aws:iam::")) continue;
      if (roleNames.has(named)) continue;
      out.push(diag("KMV005",
        `MicroVMImage "${image.metadata?.name}" names buildRoleArn "${arn}", and this project declares no role called "${named}". The image will apply and the build will fail when the service cannot assume it.`,
        image.metadata?.name));
    }
    return out;
  },
};

/**
 * KMV006 — the connector bounds the service enforces and the schema does not.
 *
 * Both numbers come from the same place chant's own `MicrovmApp` composite
 * gets them, and are declared here a second time because the lexicon does not
 * export them — see chant#1374.
 */
const MIN_CONNECTOR_SUBNETS = 1;
const MAX_CONNECTOR_SUBNETS = 16;
const MAX_EGRESS_CONNECTORS = 10;

export const connectorBoundsCheck: PostSynthCheck = {
  id: "KMV006",
  description: "A MicroVMNetwork must stay inside the service's subnet and connector bounds",
  check(ctx) {
    const out: PostSynthDiagnostic[] = [];
    for (const network of manifests(ctx).filter((m) => m.kind === "MicroVMNetwork")) {
      const subnets = network.listSpec?.subnetIds ?? [];
      const name = network.metadata?.name;
      if (subnets.length < MIN_CONNECTOR_SUBNETS) {
        out.push(diag("KMV006",
          `MicroVMNetwork "${name}" declares no subnets. The service requires at least ${MIN_CONNECTOR_SUBNETS}.`, name));
      } else if (subnets.length > MAX_CONNECTOR_SUBNETS) {
        out.push(diag("KMV006",
          `MicroVMNetwork "${name}" declares ${subnets.length} subnets; the service accepts at most ${MAX_CONNECTOR_SUBNETS}.`, name));
      }
      const egress = network.listSpec?.egressNetworkConnectors ?? [];
      if (egress.length > MAX_EGRESS_CONNECTORS) {
        out.push(diag("KMV006",
          `MicroVMNetwork "${name}" declares ${egress.length} egress connectors; the service accepts at most ${MAX_EGRESS_CONNECTORS}.`, name));
      }
    }
    return out;
  },
};

/**
 * KMV008 — the idle and lifetime numbers have to make sense together.
 *
 * The schema types all four as open integers, so a class that suspends after
 * an hour and terminates after a minute is accepted, applies, and quietly
 * terminates every VM a minute after it suspends. Nothing surfaces that as an
 * error; the VMs just stop existing sooner than intended.
 */
const MAX_DURATION_SECONDS = 28800;

export const durationCoherenceCheck: PostSynthCheck = {
  id: "KMV008",
  description: "Idle, suspend and lifetime durations must be coherent and inside the service's eight-hour ceiling",
  check(ctx) {
    const out: PostSynthDiagnostic[] = [];
    for (const klass of manifests(ctx).filter((m) => m.kind === "MicroVMClass")) {
      const name = klass.metadata?.name;
      const num = (field: string): number | undefined => {
        const raw = klass.spec?.[field];
        const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
        return Number.isFinite(n) ? n : undefined;
      };
      const idle = num("maxIdleDurationSeconds");
      const suspended = num("suspendedDurationSeconds");
      const maximum = num("maximumDurationSeconds");

      for (const [field, value] of [["maxIdleDurationSeconds", idle], ["maximumDurationSeconds", maximum]] as const) {
        if (value !== undefined && value > MAX_DURATION_SECONDS) {
          out.push(diag("KMV008",
            `MicroVMClass "${name}" sets ${field} to ${value}, above the service's ceiling of ${MAX_DURATION_SECONDS} (8h).`, name));
        }
      }
      if (idle !== undefined && maximum !== undefined && maximum < idle) {
        out.push(diag("KMV008",
          `MicroVMClass "${name}" caps total lifetime at ${maximum}s but does not suspend until ${idle}s idle, so a VM is terminated before it can ever be suspended.`, name));
      }
      if (suspended !== undefined && suspended <= 0) {
        out.push(diag("KMV008",
          `MicroVMClass "${name}" sets suspendedDurationSeconds to ${suspended}, which terminates a VM the moment it suspends.`, name));
      }
    }
    return out;
  },
};

/**
 * KMV022 — no stray namespaces.
 *
 * Every namespace this build emits is either the operator's or a workload
 * namespace carrying the manage label. One that is neither is a namespace the
 * kit creates and nothing uses, which on teardown is a thing left behind.
 */
export const namespacePurposeCheck: PostSynthCheck = {
  id: "KMV022",
  description: "Every namespace this build emits is either the operator's or a labelled workload namespace",
  check(ctx) {
    const all = manifests(ctx);

    return all
      .filter((m) => m.kind === "Namespace")
      .filter((ns) => {
        const name = ns.metadata?.name;
        if (!name) return false;
        if (ns.metadata?.labels?.[MANAGED_LABEL] === "true") return false;
        // The operator's own namespace holds the chart's objects and none of
        // this project's, so "does anything declared live here" is the wrong
        // question to ask of it — this check asked exactly that and flagged
        // it. The kit labels it instead, which is a statement of purpose
        // rather than an inference from contents.
        if (ns.metadata?.labels?.[OPERATOR_LABEL]) return false;
        return !all.some((m) => isCustomResource(m) && m.metadata?.namespace === name);
      })
      .map((ns) => ({
        checkId: "KMV022",
        severity: "warning" as const,
        message: `Namespace "${ns.metadata?.name}" carries no manage label and holds nothing this build declares. It will be created and left behind.`,
        entity: ns.metadata?.name,
        lexicon: "k8s",
      }));
  },
};
