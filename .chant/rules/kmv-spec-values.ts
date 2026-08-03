/**
 * KMV003, KMV009, KMV010 — the three values KubeMicroVM's CRD schemas permit
 * and its service refuses.
 *
 * Each of these was found by deploying the kit against a local target. Every
 * one is accepted by the API server, ignored by the schema, and rejected at
 * reconcile — so the failure arrives minutes later, attached to a controller
 * log rather than to the line that caused it.
 *
 * These rules match on the **shape of a spec object literal** rather than on
 * the constructor it is passed to, because the kit builds its specs as named
 * consts and hands the identifier to `new MicroVMImage({ spec })` — a rule
 * keyed on the constructor would see an identifier and nothing else. The
 * distinguishing property of each spec (`s3Bucket` for an image, `connectorName`
 * for a connector) is what identifies it. That is looser than a type check and
 * it is what a source-level rule can actually see; the emitted-output version
 * of the same checks lives in `test/tier-matrix.test.ts`.
 */

import * as ts from "typescript";
import type { LintRule, LintContext, LintDiagnostic } from "@intentius/chant";

/** The five runtime profiles the MicroVMs service accepts, in MiB. */
const MEMORY_SIZES_MIB = new Set([512, 1024, 2048, 4096, 8192]);

/** The two values `MicroVMNetwork.spec.networkProtocol` accepts. */
const NETWORK_PROTOCOLS = new Set(["IPv4", "DualStack"]);

/**
 * What identifies a `MicroVMImage.spec`. Both are required, and deliberately:
 * `maxVersionsToKeep` and `buildTimeoutSeconds` alone also describe a tier
 * profile in `src/lib/tiers.ts`, which is not a spec and correctly carries no
 * base image — the first cut of this rule fired on all three of them.
 */
const IMAGE_SPEC_MARKERS = ["buildRoleArn", "source"];

/** Present on a `MicroVMNetwork.spec` and on nothing else. */
const NETWORK_SPEC_MARKER = "connectorName";

function keyOf(prop: ts.ObjectLiteralElementLike): string | undefined {
  if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) return undefined;
  const name = ts.isShorthandPropertyAssignment(prop) ? prop.name : prop.name;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return undefined;
}

function keysOf(node: ts.ObjectLiteralExpression): Set<string> {
  const keys = new Set<string>();
  for (const prop of node.properties) {
    const key = keyOf(prop);
    if (key) keys.add(key);
    // A spread carries keys this rule cannot see. `hasSpread` below is what
    // stops a "missing key" rule firing on a half of a spec.
  }
  return keys;
}

function hasSpread(node: ts.ObjectLiteralExpression): boolean {
  return node.properties.some((p) => ts.isSpreadAssignment(p));
}

function valueOf(node: ts.ObjectLiteralExpression, key: string): ts.Expression | undefined {
  for (const prop of node.properties) {
    if (ts.isPropertyAssignment(prop) && keyOf(prop) === key) return prop.initializer;
  }
  return undefined;
}

function at(context: LintContext, node: ts.Node): { line: number; column: number } {
  const { line, character } = context.sourceFile.getLineAndCharacterOfPosition(node.getStart(context.sourceFile));
  return { line: line + 1, column: character + 1 };
}

function isImageSpec(keys: Set<string>): boolean {
  return IMAGE_SPEC_MARKERS.every((marker) => keys.has(marker));
}

function walk(node: ts.Node, visit: (o: ts.ObjectLiteralExpression) => void): void {
  if (ts.isObjectLiteralExpression(node)) visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

/**
 * KMV003 — memory is one of the service's five sizes.
 *
 * `MicroVMImage.spec.memorySizeMiB` is typed as an open integer by the CRD.
 * The service accepts five values. The same constant is declared in chant's
 * own `MicrovmApp` composite, which is where it should eventually come from.
 */
export const memorySizeRule: LintRule = {
  id: "KMV003",
  severity: "error",
  category: "correctness",
  description: "MicroVM image memory must be one of the service's five sizes",
  check(context: LintContext): LintDiagnostic[] {
    const diagnostics: LintDiagnostic[] = [];
    walk(context.sourceFile, (obj) => {
      const value = valueOf(obj, "memorySizeMiB");
      if (!value || !ts.isNumericLiteral(value)) return;
      const size = Number(value.text);
      if (MEMORY_SIZES_MIB.has(size)) return;
      diagnostics.push({
        file: context.filePath,
        ...at(context, value),
        ruleId: "KMV003",
        severity: "error",
        message: `memorySizeMiB ${size} is not one of the service's five sizes (${[...MEMORY_SIZES_MIB].join(", ")}). The CRD types this as an open integer; the service does not.`,
      });
    });
    return diagnostics;
  },
};

/**
 * KMV009 — an image spec sets `baseImageArn`.
 *
 * The CRD marks nothing required, so an image without it applies cleanly and
 * then fails every reconcile with `Value null at 'baseImageArn' failed to
 * satisfy constraint: Member must not be null`.
 */
export const baseImageArnRule: LintRule = {
  id: "KMV009",
  severity: "error",
  category: "correctness",
  description: "A MicroVMImage spec must set baseImageArn, which the service requires and the schema does not",
  check(context: LintContext): LintDiagnostic[] {
    const diagnostics: LintDiagnostic[] = [];
    walk(context.sourceFile, (obj) => {
      const keys = keysOf(obj);
      if (!isImageSpec(keys)) return;
      if (keys.has("baseImageArn")) return;
      // A spread may be carrying it in from elsewhere; this rule cannot see
      // through one, and a false positive on a correct spec is worse than a
      // miss on an odd one.
      if (hasSpread(obj)) return;
      diagnostics.push({
        file: context.filePath,
        ...at(context, obj),
        ruleId: "KMV009",
        severity: "error",
        message:
          "MicroVMImage spec has no baseImageArn. The CRD marks nothing required, so this applies cleanly and then fails every reconcile with \"Value null at 'baseImageArn' failed to satisfy constraint: Member must not be null\".",
      });
    });
    return diagnostics;
  },
};

/**
 * KMV010 — a connector's protocol is one the service accepts.
 *
 * The CRD types `networkProtocol` as an open string. The service accepts
 * `IPv4` or `DualStack`. Anything else leaves the connector `PENDING` forever
 * and every VM referencing it `Pending`.
 */
export const networkProtocolRule: LintRule = {
  id: "KMV010",
  severity: "error",
  category: "correctness",
  description: "MicroVMNetwork.spec.networkProtocol must be IPv4 or DualStack",
  check(context: LintContext): LintDiagnostic[] {
    const diagnostics: LintDiagnostic[] = [];
    walk(context.sourceFile, (obj) => {
      if (!keysOf(obj).has(NETWORK_SPEC_MARKER)) return;
      const value = valueOf(obj, "networkProtocol");
      if (!value) return;
      const literal = ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value) ? value.text : undefined;
      if (literal === undefined || NETWORK_PROTOCOLS.has(literal)) return;
      diagnostics.push({
        file: context.filePath,
        ...at(context, value),
        ruleId: "KMV010",
        severity: "error",
        message: `networkProtocol "${literal}" is not accepted — the service takes IPv4 or DualStack. The CRD types this as an open string, so a wrong value leaves the connector PENDING and every VM behind it Pending.`,
      });
    });
    return diagnostics;
  },
};
