import { describe, expect, test } from "vitest";
import {
  DEFAULT_MICROVM_ENDPOINT,
  EMULATOR_ACCOUNT_ID,
  optionalAccountId,
  resolveAccountId,
  resolveTarget,
} from "./target";

describe("target resolution", () => {
  test("an unset AWS_ENDPOINT_URL means real AWS", () => {
    expect(resolveTarget({}).target).toBe("real");
    expect(resolveTarget({ awsEndpointUrl: "" }).target).toBe("real");
    expect(resolveTarget({ awsEndpointUrl: "   " }).target).toBe("real");
  });

  test("a set AWS_ENDPOINT_URL means the local target", () => {
    const config = resolveTarget({ awsEndpointUrl: "http://localhost:4566" });
    expect(config.target).toBe("local");
    expect(config.awsEndpointUrl).toBe("http://localhost:4566");
  });

  test("the MicroVMs endpoint is defaulted, not derived from floci's", () => {
    const config = resolveTarget({ awsEndpointUrl: "http://localhost:4566" });
    expect(config.microvmEndpointUrl).toBe(DEFAULT_MICROVM_ENDPOINT);
    expect(config.microvmEndpointUrl).not.toBe(config.awsEndpointUrl);
  });

  test("an explicit MicroVMs endpoint wins", () => {
    const config = resolveTarget({
      awsEndpointUrl: "http://localhost:4566",
      microvmEndpointUrl: "http://m80:4290",
    });
    expect(config.microvmEndpointUrl).toBe("http://m80:4290");
  });

  test("the real target carries no endpoints at all", () => {
    const config = resolveTarget({ microvmEndpointUrl: "http://m80:4290" });
    expect(config.target).toBe("real");
    expect(config.awsEndpointUrl).toBeUndefined();
    // Set without AWS_ENDPOINT_URL, the MicroVMs endpoint is ignored rather
    // than half-selecting a target.
    expect(config.microvmEndpointUrl).toBeUndefined();
  });
});

describe("account id resolution", () => {
  test("the local target falls back to the account both emulators answer as", () => {
    const local = resolveTarget({ awsEndpointUrl: "http://localhost:4566" });
    expect(resolveAccountId(local, undefined)).toBe(EMULATOR_ACCOUNT_ID);
  });

  test("an explicit account id wins even on the local target", () => {
    const local = resolveTarget({ awsEndpointUrl: "http://localhost:4566" });
    expect(resolveAccountId(local, "111122223333")).toBe("111122223333");
  });

  test("the real target refuses to invent an account id", () => {
    const real = resolveTarget({});
    expect(() => resolveAccountId(real, undefined)).toThrow(/accountId is required/);
  });

  test("a stack that never emits an account id gets undefined instead of a throw", () => {
    const real = resolveTarget({});
    expect(optionalAccountId(real, undefined)).toBeUndefined();
    const local = resolveTarget({ awsEndpointUrl: "http://localhost:4566" });
    expect(optionalAccountId(local, undefined)).toBe(EMULATOR_ACCOUNT_ID);
  });
});
