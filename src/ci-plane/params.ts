/**
 * Parameter source for the `ci-plane` stack — the OIDC provider and the role
 * `.github/workflows/real-e2e.yml` assumes (#70).
 *
 * Everything here is a declared build-time parameter (see `chant.config.ts`'s
 * `buildParams`), so nothing in `./role.ts` reads `process.env` and the whole
 * stack folds without executing.
 */

import { params } from "@intentius/chant/params";

/** Deploy the CI plane at all. Off by default — see chant.config.ts. */
export const ciPlaneMode = (params.ciPlaneMode as string | undefined) ?? "omit";

/**
 * Whether this stack declares the GitHub OIDC provider or points at one the
 * account already has. The provider is account-global (one per issuer URL),
 * so a second integration anywhere in the account means `reference-existing`.
 */
export const oidcProviderMode = (params.oidcProviderMode as string | undefined) ?? "provision";

/** The repo whose workflows may assume the role — half of the sub claim. */
export const githubRepo = (params.githubRepo as string | undefined) ?? "INTENTIUS/kubemicrovm-ops";

/** The GitHub environment carrying the reviewer gate — the other half. */
export const githubEnvironment = (params.githubEnvironment as string | undefined) ?? "real-aws";
