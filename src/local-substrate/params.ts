/**
 * Parameter source for the `local-substrate` stack — the emulator the local
 * target runs INSIDE the cluster (m80, the MicroVMs API + the
 * sts:GetCallerIdentity shim the operator gates on).
 *
 * Local-target-only by construction: `m80()` in ./m80.ts declares nothing on
 * the real target, where the MicroVMs API is AWS's own. floci is not here —
 * it runs as a host container the cluster does not own, and declaring it
 * would claim ownership the kit does not have.
 */

import { params } from "@intentius/chant/params";
import { resolveTarget } from "../lib/target";

export const target = resolveTarget({
  awsEndpointUrl: params.awsEndpointUrl as string | undefined,
  microvmEndpointUrl: params.microvmEndpointUrl as string | undefined,
});

function optional(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export const operatorNamespace = optional(params.operatorNamespace) ?? "kube-microvm";
export const m80Image = optional(params.m80Image) ?? "ghcr.io/intentius/m80:v0.4.1";
export const m80Port = Number(optional(params.m80Port) ?? "4290");
export const m80MaxAccountMemoryMib = optional(params.m80MaxAccountMemoryMib) ?? "262144";
export const m80EnableInjection = (optional(params.m80EnableInjection) ?? "true") === "true";
