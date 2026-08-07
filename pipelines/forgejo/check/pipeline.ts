/**
 * The estate's check pipeline, Forgejo flavour — rendered to
 * `pipelines/forgejo-check.yml` for `.forgejo/workflows/`.
 *
 * Authored exactly as the GitHub flavour (the forgejo lexicon re-exports the
 * same entities); the Forgejo dialect — runner labels, the actions root — is
 * applied at build. One declaration idiom, three forges: that is the point
 * of shipping these from the same kit.
 */
import { Workflow, Job, Step, Checkout, SetupNode } from "@intentius/chant-lexicon-forgejo";

export const workflow = new Workflow({
  name: "estate-check",
  on: {
    push: { branches: ["main"] },
    pull_request: {},
  },
});

export const check = new Job({
  "runs-on": "ubuntu-latest",
  timeoutMinutes: 15,
  steps: [
    Checkout({}).step,
    SetupNode({ nodeVersion: "22", cache: "npm" }).step,
    new Step({ name: "Install", run: "npm ci" }),
    new Step({ name: "Typecheck", run: "npx tsc --noEmit" }),
    new Step({ name: "Lint — the webhook's checks at build time", run: "npx chant lint ." }),
    new Step({ name: "Tests — the tier matrix against the pinned CRD schemas", run: "npx vitest run" }),
  ],
});
