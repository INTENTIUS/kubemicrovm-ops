/**
 * The estate's deploy pipeline, Forgejo flavour — rendered to
 * `pipelines/forgejo-deploy.yml`. The GitHub flavour's twin (same
 * declaration idiom, dialect applied at build), with one honest difference:
 * Forgejo has no reviewer-gated environments, so the gate here is
 * dispatch-only plus whoever holds the dispatch button. If your Forgejo
 * fronts a protected branch, protect the workflow file the same way.
 *
 * Credentials are yours to wire — static secrets on the runner, or whatever
 * your Forgejo's secret store provides. The marked step refuses to proceed
 * until something is wired, which beats half-deploying with none.
 */
import { Workflow, Job, Step, Checkout, SetupNode } from "@intentius/chant-lexicon-forgejo";

export const workflow = new Workflow({
  name: "estate-deploy",
  on: {
    workflow_dispatch: {},
  },
});

export const deploy = new Job({
  "runs-on": "ubuntu-latest",
  timeoutMinutes: 150,
  steps: [
    Checkout({}).step,
    SetupNode({ nodeVersion: "22", cache: "npm" }).step,
    new Step({ name: "Install", run: "npm ci" }),
    new Step({
      name: "Credentials — yours to wire",
      run: [
        "# Wire AWS credentials for the runner (secrets, or a credentials file",
        "# the runner host provides). The deploy refuses to start without them.",
        'test -n "${AWS_REGION:-}" || { echo "no credentials wired — read this step" >&2; exit 1; }',
      ].join("\n"),
    }),
    new Step({
      name: "Deploy — the component waves, converge included",
      env: {
        KMV_TIER: "minimal",
        KMV_CLUSTER_MODE: "reference-existing",
      },
      run: "npx chant run all --components --env dev",
    }),
    new Step({
      name: "What the operator saw",
      if: "always()",
      run: "kubectl -n kube-microvm logs deploy/kube-microvm-operator --tail=100 || true",
    }),
  ],
});
