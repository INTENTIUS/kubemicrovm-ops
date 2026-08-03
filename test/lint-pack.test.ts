/**
 * The webhook-rejection test, in the form the source can actually be checked in.
 *
 * M2's exit criterion is a set of deliberately broken sources where every
 * failure the operator or the service would reject is caught at build time
 * instead. `test/fixtures/broken/` is that set: one file per rule, each a
 * faithful copy of a mistake that was actually made and found by deploying.
 *
 * Each fixture must fail its own rule and no other, and `test/fixtures/ok.ts`
 * must pass all of them — a rule that fires on everything catches nothing.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { describe, expect, test } from "vitest";
import { baseImageArnRule, memorySizeRule, networkProtocolRule } from "../.chant/rules/kmv-spec-values";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const RULES = [memorySizeRule, baseImageArnRule, networkProtocolRule];

function lint(relPath: string) {
  const filePath = join(root, relPath);
  const source = readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.ES2022, true);
  return RULES.flatMap((rule) => rule.check({ filePath, sourceFile } as never));
}

const CASES = [
  { fixture: "test/fixtures/broken/bad-memory.ts", ruleId: "KMV003", says: /not one of the service's five sizes/ },
  { fixture: "test/fixtures/broken/missing-base-image.ts", ruleId: "KMV009", says: /no baseImageArn/ },
  { fixture: "test/fixtures/broken/bad-protocol.ts", ruleId: "KMV010", says: /IPv4 or DualStack/ },
];

describe("every broken fixture fails its own rule", () => {
  test.each(CASES)("$fixture → $ruleId", ({ fixture, ruleId, says }) => {
    const diagnostics = lint(fixture);
    expect(diagnostics.map((d) => d.ruleId)).toEqual([ruleId]);
    expect(diagnostics[0].message).toMatch(says);
    // A diagnostic with no position is one a reader cannot act on.
    expect(diagnostics[0].line).toBeGreaterThan(0);
    expect(diagnostics[0].severity).toBe("error");
  });
});

describe("and a correct source fails none of them", () => {
  test("test/fixtures/ok.ts is clean", () => {
    expect(lint("test/fixtures/ok.ts")).toEqual([]);
  });

  test("so is the kit's own source", () => {
    for (const file of ["src/workload/workload.ts", "src/aws-plane/plane.ts", "src/lib/tiers.ts"]) {
      expect(lint(file), `${file} should be clean`).toEqual([]);
    }
  });
});

describe("each rule declares itself properly", () => {
  test.each(RULES)("$id", (rule) => {
    expect(rule.id).toMatch(/^KMV\d{3}$/);
    expect(rule.severity).toBe("error");
    expect(rule.description?.length ?? 0).toBeGreaterThan(20);
  });

  test("the ids are distinct", () => {
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
  });
});
