/**
 * The estate's check pipeline, GitHub flavour — declared, like everything
 * else in this kit, and rendered to `pipelines/github-check.yml` for an
 * adopter to drop into `.github/workflows/`.
 *
 * What it runs is `just check` spelled out for a runner that has nothing
 * installed: typecheck, chant lint (the KMV pack — the webhook's refusals at
 * build time), and the test suite whose tier matrix checks every emitted
 * field against the pinned CRD schemas. No cluster, no AWS account, no
 * Docker: this is the gate cheap enough to run on every push, and it catches
 * the class of mistake the API server accepts and the controller ignores.
 */
import { Workflow, Job, Step, Checkout, SetupNode } from "@intentius/chant-lexicon-github";

// Actions by commit SHA, not by tag — a tag is a moving pointer, and whoever
// controls it controls what runs in your CI. The tags these resolved from are
// in the comments so a bump is a one-line diff with something to compare.
const CHECKOUT = "actions/checkout@11d5960a326750d5838078e36cf38b85af677262"; // v4
const SETUP_NODE = "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020"; // v4


export const workflow = new Workflow({
  name: "estate-check",
  on: {
    push: { branches: ["main"] },
    pull_request: {},
  },
  permissions: { contents: "read" },
});

export const check = new Job({
  "runs-on": "ubuntu-latest",
  timeoutMinutes: 15,
  steps: [
    Checkout({ defaults: { step: { uses: CHECKOUT } } }).step,
    SetupNode({ nodeVersion: "22", cache: "npm", defaults: { step: { uses: SETUP_NODE } } }).step,
    new Step({ name: "Install", run: "npm ci" }),
    new Step({ name: "Typecheck", run: "npx tsc --noEmit" }),
    new Step({ name: "Lint — the webhook's checks at build time", run: "npx chant lint ." }),
    new Step({ name: "Tests — the tier matrix against the pinned CRD schemas", run: "npx vitest run" }),
  ],
});
