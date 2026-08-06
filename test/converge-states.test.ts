/**
 * What `assert-converged.sh` calls converged, and what it refuses to.
 *
 * The kit has now reported a healthy estate as broken three times — #44 (doctor
 * verified one cluster and reported on another), #51 (the connectivity check
 * read a startup line that scrolled away), #52 (the replica floor could not
 * tell a suspended VM from one that never started). Each was found by someone
 * looking at a working estate and being told it was not.
 *
 * The failure mode is specific: every one of them was a check whose *passing*
 * case is exercised constantly and whose *degraded* case is exercised by
 * nobody, because producing it means waiting. This drives the degraded cases
 * directly, through a stubbed kubectl, so they are exercised on every run.
 *
 * Deliberately not a live-cluster test. Reproducing a suspended estate for real
 * means idling fifteen minutes and hoping nothing reads it — and a read
 * auto-resumes the VMs, which is exactly why #52 shipped.
 */

import { execFileSync } from "node:child_process";
import { chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, test } from "vitest";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const stubDir = join(root, "test", "fixtures");
const script = join(root, "scripts", "local", "assert-converged.sh");

/** Run the convergence check against one canned estate state. */
function converge(
  readyReplicas: number,
  vmStates: string[],
  stub: { image?: string; connector?: string } = {},
): { ok: boolean; out: string } {
  try {
    const out = execFileSync("bash", [script, "prod-ha"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        KSTUB: `${readyReplicas}:${vmStates.join(",")}`,
        KSTUB_IMAGE: stub.image ?? "",
        KSTUB_CONNECTOR: stub.connector ?? "",
        // The stub shadows the real binary. `scripts/lib-kube.sh` wraps kubectl
        // in a function that calls `command kubectl`, which resolves on PATH.
        PATH: `${stubDir}:${process.env.PATH}`,
        // Unset, so kmv_require_context does not look for a real context — the
        // stub answers `config get-contexts` anyway, but this keeps the test
        // independent of whatever cluster the machine is pointed at.
        KMV_KUBE_CONTEXT: "",
        // Short, because three of these cases are supposed to time out and the
        // 600s default would make the suite unrunnable.
        TIMEOUT: "3",
      },
    });
    return { ok: true, out };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

beforeAll(() => {
  // git preserves the exec bit, but a fresh checkout on a filesystem that does
  // not is a confusing "command not found" rather than a test failure.
  chmodSync(join(stubDir, "kubectl"), 0o755);
});

describe("a floor the operator filled", () => {
  test("passes when every replica is ready", () => {
    const { ok, out } = converge(2, ["Running", "Running"]);
    expect(ok).toBe(true);
    expect(out).toContain("the replica floor (2): ok");
  });
});

describe("a floor the operator suspended, which is still converged (#52)", () => {
  test("passes when the idle policy took both VMs, and says so", () => {
    const { ok, out } = converge(0, ["Suspended", "Suspended"]);
    expect(ok).toBe(true);
    expect(out).toContain("2 suspended by the idle policy");
    // The number that made this look broken is worth naming rather than hiding.
    expect(out).toContain("readyReplicas is 0");
  });

  test("passes on a mix, since traffic resumes a suspended VM", () => {
    const { ok, out } = converge(1, ["Running", "Suspended"]);
    expect(ok).toBe(true);
    expect(out).toContain("1 running, 1 suspended");
  });
});

describe("and what suspension must not be allowed to excuse", () => {
  test("a VM still Pending is not a converged estate", () => {
    const { ok, out } = converge(1, ["Running", "Pending"]);
    expect(ok).toBe(false);
    expect(out).toContain("never filled");
  });

  test("a VM that failed is not a converged estate", () => {
    expect(converge(1, ["Running", "Failed"]).ok).toBe(false);
  });

  test("an estate with no VMs at all is not a converged estate", () => {
    expect(converge(0, []).ok).toBe(false);
  });

  test("fewer VMs than the floor is not a converged estate, however healthy they are", () => {
    expect(converge(1, ["Running"]).ok).toBe(false);
  });
});

describe("terminal states exit now, not at the timeout", () => {
  // The real-target timeout is an hour, sized to outlast a genuine image
  // build. The first real run spent that hour waiting on a CREATE_FAILED the
  // service had reported in minute two. A state the operator will never move
  // off is a verdict, and a verdict should not be billed by the clock.
  test("an image build that failed says so, instead of timing out", () => {
    const { ok, out } = converge(2, ["Running", "Running"], { image: "CREATE_FAILED" });
    expect(ok).toBe(false);
    expect(out).toContain("terminal state");
    expect(out).toContain("CREATE_FAILED");
    expect(out).not.toContain("never reached");
  });

  test("a connector that failed says so, instead of timing out", () => {
    const { ok, out } = converge(2, ["Running", "Running"], { connector: "FAILED" });
    expect(ok).toBe(false);
    expect(out).toContain("terminal state");
    expect(out).not.toContain("never reached");
  });

  test("a Failed VM fails the floor immediately, not after the wait", () => {
    const { ok, out } = converge(1, ["Running", "Failed"]);
    expect(ok).toBe(false);
    expect(out).toContain("terminal state Failed");
    expect(out).not.toContain("never filled");
  });
});
