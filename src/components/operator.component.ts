import { phase, type Component } from "@intentius/chant/components";
import { helmUpgrade } from "@intentius/chant-lexicon-helm/components";
import { kubectlApply } from "@intentius/chant-lexicon-k8s/components";
import { params } from "@intentius/chant/params";
import { resolveTarget } from "../lib/target";

/**
 * cert-manager, the pinned CRDs, the operator's Helm release, and the two env
 * patches the chart cannot carry — as declared capability steps rather than
 * one shell script. Each install is now a deploy unit `components status
 * --live` observes by its own name: the two Helm releases through the helm
 * lexicon's release status, the CRD apply through its stack marker.
 *
 * The component still owns no declared resources, and there is still no
 * `src/operator/` directory: the chart's objects belong to Helm at a pinned
 * version, are never marked `managed-by=chant`, and a chant prune never
 * touches them. What changed is only WHO runs the install — the pins come
 * from the declared parameters (one place) instead of script variables
 * (three places), and the steps rollback the way their tools do (Helm
 * natively; the CRD apply never deletes).
 */

const target = resolveTarget({
  awsEndpointUrl: params.awsEndpointUrl as string | undefined,
  microvmEndpointUrl: params.microvmEndpointUrl as string | undefined,
});

const region = (params.region as string | undefined) ?? "us-east-1";
const operatorNamespace = (params.operatorNamespace as string | undefined) ?? "kube-microvm";
const chartVersion = (params.operatorChartVersion as string | undefined) ?? "1.0.12";
const certManagerVersion = (params.certManagerVersion as string | undefined) ?? "v1.21.1";

// The operator's endpoint override, local target only — on real AWS the
// MicroVMs API is the service's own and the chart's default stands. Bound to
// a const before the spread (EVL004).
const endpointOverride: Record<string, string> =
  target.target === "local"
    ? { "app.envs.AWS_MICROVM_ENDPOINT": target.microvmEndpointUrl ?? "http://localhost:4290" }
    : {};
const operatorSet: Record<string, string> = {
  "app.envs.AWS_REGION": region,
  ...endpointOverride,
};

export const operator: Component = {
  name: "operator",
  archetype: "infra",
  // The operator's first reconcile passes a build role to the MicroVMs
  // service. If the AWS plane has not been applied, that role does not exist
  // and the failure arrives in a controller log rather than at install time.
  dependsOn: ["aws-plane", "local-substrate"],
  deploy: [
    phase("Install", [
      // Before the chart, so a custom resource applies whether or not the
      // chart's own CRD install has run. Never deletes: CRDs are shared
      // cluster state, and removing one removes every CR of that kind —
      // teardown owns that decision explicitly.
      kubectlApply({
        manifest: "crds",
        stack: "kmv-crds",
        delete: "never",
        noRollback:
          "rolling back a CRD apply would delete shared cluster state and every custom resource of those kinds with it; the pinned files are the restore path",
      }),
      // The operator's webhooks will not start without cert-manager. Upstream
      // expects the cluster to have it already — EKS often does, k3d never
      // does. Idempotent: `upgrade --install` converges an existing release.
      helmUpgrade({
        release: "cert-manager",
        chart: "cert-manager",
        repo: "https://charts.jetstack.io",
        namespace: "cert-manager",
        createNamespace: true,
        set: { "crds.enabled": "true" },
        version: certManagerVersion,
        wait: true,
        timeout: "6m",
      }),
      helmUpgrade({
        release: "kube-microvm-operator",
        chart: "oci://ghcr.io/codriverlabs/helm/kube-microvm-operator",
        version: chartVersion,
        namespace: operatorNamespace,
        createNamespace: true,
        set: operatorSet,
        wait: true,
        timeout: "6m",
      }),
      {
        kind: "shell",
        cmd: "bash scripts/install/operator-env-patches.sh",
        reason:
          "two upstream workarounds with issue numbers (KubeMicroVM#50, #52) — kubectl set env after the release, because the chart drops env keys it does not template; deleted when upstream lands them",
      },
    ]),
  ],
};
