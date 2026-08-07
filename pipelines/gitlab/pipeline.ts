/**
 * The estate's pipeline, GitLab flavour — rendered to
 * `pipelines/gitlab-ci.yml` for an adopter's `.gitlab-ci.yml`.
 *
 * Same two claims as the GitHub flavour, in GitLab's idiom: a `check` stage
 * that runs on every push (no cluster, no account — the webhook's refusals
 * at build time, the tier matrix against the pinned schemas), and a `deploy`
 * stage that is `when: manual` behind a protected environment, because
 * deploying an estate bills an account and a pipeline should not do that to
 * anyone by surprise.
 *
 * Credentials and the three reference-existing variables are the adopter's
 * to wire as CI/CD variables; the deploy job's comments name them.
 */
import { Job, Image } from "@intentius/chant-lexicon-gitlab";

// Pinned by digest so the image cannot change after review — resolved from
// node:22 on 2026-08-07.
const node = new Image({ name: "node:22@sha256:0557ac14e0d45d02ed563067b82856ca5e7aa3437fa28d98d4350ea9c3d9494a" });

export const check = new Job({
  stage: "check",
  image: node,
  timeout: "15 minutes",
  script: [
    "npm ci",
    "npx tsc --noEmit",
    "npx chant lint .",
    "npx vitest run",
  ],
});

export const deploy = new Job({
  stage: "deploy",
  image: node,
  timeout: "150 minutes",
  when: "manual",
  // Manual gate, GitLab idiom: without allow_failure the un-clicked job
  // holds every pipeline in a blocked state forever.
  allow_failure: true,
  // Deliberately no automatic retry: re-running a deploy is a decision.
  retry: 0,
  environment: { name: "deploy" },
  variables: {
    KMV_TIER: "minimal",
    KMV_CLUSTER_MODE: "reference-existing",
    // reference-existing needs KMV_CLUSTER_NAME, KMV_SUBNET_IDS and
    // KMV_SECURITY_GROUP_IDS from your cluster's VPC, plus AWS credentials —
    // set them as protected CI/CD variables. Or KMV_CLUSTER_MODE=provision
    // and the kit stands up its own VPC and EKS cluster.
  },
  script: [
    "npm ci",
    // The runner needs kubectl, helm and the AWS CLI for the operator and
    // converge steps — bring an image that carries them, or install here.
    'test -n "${AWS_ACCESS_KEY_ID:-}${AWS_ROLE_ARN:-}" || { echo "no credentials wired — read the comments" >&2; exit 1; }',
    "npx chant run all --components --env dev",
  ],
});
