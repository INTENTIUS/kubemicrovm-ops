/**
 * The estate's deploy pipeline, GitHub flavour — rendered to
 * `pipelines/github-deploy.yml`. This is a starting point an adopter edits,
 * and it says so; the parts that are yours to wire are marked.
 *
 * Dispatch-only, and gated behind a `deploy` environment: deploying an estate
 * bills an account, so a human clicks it and a reviewer approves it — the
 * same shape as this repo's own real-e2e.yml, which is the reference for the
 * full teardown-guaranteed form.
 *
 * Credentials are the adopter's to wire: an OIDC role assumption (preferred —
 * see src/ci-plane for how this kit declares such a role) or environment
 * secrets. The commented step shows the OIDC shape.
 *
 * The deploy itself is the same command the docs give a human:
 * `chant run all --components` resolves the waves — cluster plane (if
 * provisioning), AWS plane, operator, workload — and the workload component's
 * last step is the converge assert, so "applied" and "deployed" cannot be
 * confused. KMV_* variables select the tier and the seams; the tiers page is
 * the reference.
 */
import { Workflow, Job, Step, Checkout, SetupNode } from "@intentius/chant-lexicon-github";

// Actions by commit SHA, not by tag — a tag is a moving pointer, and whoever
// controls it controls what runs in your CI. The tags these resolved from are
// in the comments so a bump is a one-line diff with something to compare.
const CHECKOUT = "actions/checkout@11d5960a326750d5838078e36cf38b85af677262"; // v4
const SETUP_NODE = "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020"; // v4


export const workflow = new Workflow({
  name: "estate-deploy",
  on: {
    workflow_dispatch: {},
  },
  permissions: { contents: "read" },
  // One deploy at a time, never cancelled mid-flight: two runs share an
  // account, and a cancelled run is a run whose converge nobody saw.
  concurrency: { group: "estate-deploy", "cancel-in-progress": false },
});

export const deploy = new Job({
  "runs-on": "ubuntu-latest",
  timeoutMinutes: 150,
  permissions: { contents: "read", "id-token": "write" },
  environment: "deploy",
  steps: [
    Checkout({ defaults: { step: { uses: CHECKOUT } } }).step,
    SetupNode({ nodeVersion: "22", cache: "npm", defaults: { step: { uses: SETUP_NODE } } }).step,
    new Step({ name: "Install", run: "npm ci" }),
    new Step({
      name: "Credentials — yours to wire",
      run: [
        '# Replace this step with your credential source. OIDC (preferred):',
        '#   - uses: aws-actions/configure-aws-credentials@v4',
        '#     with:',
        '#       role-to-assume: ${{ vars.DEPLOY_ROLE_ARN }}',
        '#       aws-region: us-east-1',
        '# This kit declares such a role in src/ci-plane (see just setup-real-ci).',
        'test -n "${AWS_REGION:-}" || { echo "no credentials wired — read this step" >&2; exit 1; }',
      ].join("\n"),
    }),
    new Step({
      name: "Deploy — the component waves, converge included",
      env: {
        KMV_TIER: "minimal",
        KMV_CLUSTER_MODE: "reference-existing",
        // reference-existing needs these three from your cluster's VPC:
        // KMV_CLUSTER_NAME, KMV_SUBNET_IDS, KMV_SECURITY_GROUP_IDS.
        // Or set KMV_CLUSTER_MODE=provision and the kit stands up its own.
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
