import { phase, type Component } from "@intentius/chant/components";
import { params } from "@intentius/chant/params";

const ciPlaneMode = (params.ciPlaneMode as string | undefined) ?? "omit";

/**
 * The OIDC provider and role real-e2e.yml assumes (#70). A bootstrap
 * component, not a wave: off by default, deployed once per account with
 * human credentials via `just setup-real-ci` — the CI role cannot create
 * itself. No dependents name it, and `run all` never reaches it unless
 * someone deliberately sets KMV_CI_PLANE=provision.
 *
 * The stack is `kmv-ci-plane`, deliberately outside the `kubemicrovm-ops-*`
 * prefix: real-e2e.yml's "nothing left behind" sweep fails the run on any
 * surviving `kubemicrovm-ops-*` stack, and this one is a permanent fixture
 * the sweep must never read as a leak.
 */
export const ciPlane: Component = {
  name: "ci-plane",
  enabled: ciPlaneMode === "provision",
  archetype: "infra",
  dependsOn: [],
  liveNames: ["realCiRole"],
  deploy: [
    phase("Apply", [
      {
        kind: "shell",
        cmd: "npx chant build src/ci-plane --lexicon aws -o dist/ci-plane.template.json",
        reason:
          "a synthesis step, not a mutation: chant building the template the next step deploys",
      },
      {
        kind: "cfn-deploy",
        stack: "kmv-ci-plane",
        template: "dist/ci-plane.template.json",
      },
    ]),
  ],
};
