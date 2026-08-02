/**
 * Which deploy target this build is for.
 *
 * A target is orthogonal to a tier: any tier deploys to either. The choice is
 * made by whether `AWS_ENDPOINT_URL` is set, and nothing else in the source
 * changes — the same rule loomster uses, so a reader who knows one kit knows
 * this one.
 *
 * The local target is two endpoints rather than one, because the estate spans
 * two planes and the emulators are split the same way:
 *
 *   AWS_ENDPOINT_URL          floci, for S3 and IAM and the pod identity association
 *   AWS_MICROVM_ENDPOINT      m80, for the MicroVMs API the operator itself calls
 *
 * Both emulators use account 000000000000, so a bucket and a role ARN minted by
 * floci feed a `CreateMicrovmImage` on m80 with nothing rewritten.
 */

export type Target = "local" | "real";

export interface TargetConfig {
  target: Target;
  /** floci's endpoint on the local target; undefined against real AWS. */
  awsEndpointUrl?: string;
  /** m80's endpoint on the local target; undefined against real AWS. */
  microvmEndpointUrl?: string;
}

/** The account both emulators answer as. Real AWS supplies its own. */
export const EMULATOR_ACCOUNT_ID = "000000000000";

/** m80's default listen address, matching its container's published port. */
export const DEFAULT_MICROVM_ENDPOINT = "http://localhost:4290";

export function resolveTarget(inputs: {
  awsEndpointUrl?: string;
  microvmEndpointUrl?: string;
}): TargetConfig {
  const awsEndpointUrl = emptyToUndefined(inputs.awsEndpointUrl);

  if (!awsEndpointUrl) {
    return { target: "real" };
  }

  return {
    target: "local",
    awsEndpointUrl,
    // m80 and floci are separate processes on separate ports, so the MicroVMs
    // endpoint is never derivable from floci's. Defaulted rather than required
    // so a local build works with one variable set.
    microvmEndpointUrl: emptyToUndefined(inputs.microvmEndpointUrl) ?? DEFAULT_MICROVM_ENDPOINT,
  };
}

/**
 * The account id to declare with. Against the local target both emulators
 * answer as one fixed account, so an unset `AWS_ACCOUNT_ID` is not an error
 * there the way it is against real AWS.
 */
export function resolveAccountId(config: TargetConfig, accountId?: string): string {
  const supplied = emptyToUndefined(accountId);
  if (supplied) return supplied;
  if (config.target === "local") return EMULATOR_ACCOUNT_ID;
  throw new Error(
    "accountId is required against the real target. Set AWS_ACCOUNT_ID, or set AWS_ENDPOINT_URL to build for the local target.",
  );
}

/**
 * What the local target cannot cover, stated where a caller can print it.
 *
 * The operator calls four AWS SDK clients and those are what the local target
 * intercepts. What AWS does downstream of them — assuming the build role,
 * fetching the S3 object, creating the ENIs for a connector — happens inside a
 * service implementation, with no request to redirect and no endpoint to
 * override. Local validates that the estate declares and reconciles. It does
 * not validate that AWS will accept the roles at runtime.
 */
export const LOCAL_TARGET_CAVEAT =
  "The local target validates that the estate declares and reconciles. It does not validate that AWS will accept the roles at runtime: nothing fetches your artifact and nothing runs it.";

function emptyToUndefined(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
