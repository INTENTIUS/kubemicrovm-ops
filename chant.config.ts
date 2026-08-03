import type { ChantConfig } from "@intentius/chant";
import type { K8sChantConfig } from "@intentius/chant-lexicon-k8s";

// `ChantConfig`'s Zod schema is `.passthrough()`, so a lexicon's own config key
// is accepted at runtime — that is how the k8s lexicon documents `k8s.profiles`
// (chant#1100). The TypeScript interface has no such key, so `satisfies
// ChantConfig` alone rejects it. Intersect rather than cast, so every other
// field stays checked.
type Config = ChantConfig & { k8s?: K8sChantConfig };

// A KubeMicroVM deployment spans two planes, so the kit carries two lexicons:
// `aws` for the prerequisites the operator needs to exist (S3 bucket, build
// role, operator role, pod identity association) and `k8s` for the operator's
// own namespace and the five custom resources.
const env = process.env.KMV_ENV ?? "dev";

export default {
  lexicons: ["aws", "k8s"],
  // Whole-project discovery (bare `chant lifecycle diff|snapshot`) stays inside
  // src/, so it never walks the Hugo docs site or the test fixtures.
  sourceDir: "src",
  environments: [env],
  ownership: { stack: "kubemicrovm-ops", env },
  k8s: {
    profiles: {
      // The local target's cluster, created by scripts/local/local-up.sh. A
      // declared binding is checked against the ambient kubectl context on
      // every live read and apply, so a stale context refuses loudly instead
      // of reading someone else's cluster.
      local: { context: "k3d-kubemicrovm-local" },
    },
  } satisfies K8sChantConfig,
  buildParams: {
    // ── Naming and tagging ──────────────────────────────────────────────
    project: { type: "string", default: "kmv", env: "KMV_PROJECT" },
    env: { type: "string", default: "dev", env: "KMV_ENV" },
    instance: { type: "string", default: "a", env: "KMV_INSTANCE" },
    tier: {
      type: "string",
      enum: ["minimal", "prod", "prod-ha"],
      default: "minimal",
      env: "KMV_TIER",
    },
    region: { type: "string", default: "us-east-1", env: "AWS_REGION" },
    accountId: { type: "string", required: false, env: "AWS_ACCOUNT_ID" },
    owner: { type: "string", default: "platform" },

    // ── Target selection ────────────────────────────────────────────────
    // Set means the local target: floci for the AWS plane. Unset means real
    // AWS. Nothing else in the source branches on it.
    awsEndpointUrl: { type: "string", required: false, env: "AWS_ENDPOINT_URL" },
    // m80, for the MicroVMs API the operator calls. Only read when
    // awsEndpointUrl is set; separate because m80 and floci are separate
    // processes on separate ports.
    microvmEndpointUrl: { type: "string", required: false, env: "AWS_MICROVM_ENDPOINT" },

    // ── Adoption seams, per resource and independent of tier ────────────
    // `provision` declares it, `reference-existing` takes an ARN or an id,
    // `omit` leaves it out entirely.
    bucketMode: {
      type: "string",
      enum: ["provision", "reference-existing", "omit"],
      default: "provision",
    },
    bucketName: { type: "string", required: false, env: "KMV_BUCKET_NAME" },
    buildRoleMode: {
      type: "string",
      enum: ["provision", "reference-existing"],
      default: "provision",
    },
    buildRoleArn: { type: "string", required: false, env: "KMV_BUILD_ROLE_ARN" },
    operatorRoleMode: {
      type: "string",
      enum: ["provision", "reference-existing"],
      default: "provision",
    },
    operatorRoleArn: { type: "string", required: false, env: "KMV_OPERATOR_ROLE_ARN" },
    // The EKS cluster and the VPC are reference-existing with no provision
    // path, deliberately — see docs/tiers.md. They are inputs, not seams.
    clusterName: { type: "string", required: false, env: "KMV_CLUSTER_NAME" },
    subnetIds: { type: "string", required: false, env: "KMV_SUBNET_IDS" },
    securityGroupIds: { type: "string", required: false, env: "KMV_SECURITY_GROUP_IDS" },
    // No declared default: the sensible one depends on the target, and
    // src/aws-plane/params.ts resolves it (omit against k3d, which has no EKS
    // API). A declared default here would mask that.
    podIdentityMode: {
      type: "string",
      enum: ["provision", "omit"],
      required: false,
    },

    // ── The operator-less path (src/golden-image) ───────────────────────
    // `MicrovmApp` builds an image through CloudFormation with no cluster
    // involved. Off by default: a deployment that declares its own
    // MicroVMImage needs none of it, and turning it on for symmetry would
    // build a second image nobody references.
    goldenImageMode: {
      type: "string",
      enum: ["provision", "omit"],
      default: "omit",
    },
    goldenBaseImage: { type: "string", default: "al2023-1", env: "KMV_GOLDEN_BASE_IMAGE" },
    goldenBaseImageVersion: { type: "string", default: "0", env: "KMV_GOLDEN_BASE_IMAGE_VERSION" },

    // ── Workload inputs ─────────────────────────────────────────────────
    workloadNamespace: { type: "string", default: "microvm-demo", env: "KMV_NAMESPACE" },
    // Pinned by the chart, not chosen by us: every template in
    // kube-microvm-operator 1.0.11 hardcodes `namespace: kube-microvm`
    // and ignores helm's `-n`, so installing anywhere else fails with
    // `namespaces "kube-microvm" not found`.
    operatorNamespace: { type: "string", default: "kube-microvm", env: "KMV_OPERATOR_NAMESPACE" },
    /** S3 key of the artifact the image is built from. */
    sourceKey: { type: "string", default: "app/app.zip", env: "KMV_SOURCE_KEY" },
    /** Optional base image ARN; the service picks a default when unset. */
    baseImageArn: { type: "string", required: false, env: "KMV_BASE_IMAGE_ARN" },
  },
  lint: {
    overrides: [
      {
        // The fixtures under test/fixtures/broken/ are deliberately wrong —
        // that is their whole job — and the tier matrix asserts they fail the
        // KMV rules. They are not project source and chant's own rules have
        // nothing useful to say about them.
        // The KMV rules are off here for the same reason: `just lint` should
        // be clean on a correct checkout, and these files are wrong on
        // purpose. `test/lint-pack.test.ts` runs the rule objects against them
        // directly and asserts each fails its own rule and no other, which is
        // the assertion that matters — turning them off here does not weaken it.
        files: ["test/fixtures/**"],
        rules: {
          EVL001: "off", EVL002: "off", EVL003: "off", EVL004: "off",
          COR001: "off", COR004: "off",
          KMV003: "off", KMV009: "off", KMV010: "off",
        },
      },
      {
        // .chant/rules/** is plain TypeScript AST code, not composite
        // authoring, so the static-evaluability rules do not apply.
        files: [".chant/rules/**"],
        rules: { EVL002: "off", EVL003: "off", EVL004: "off" },
      },
      {
        // src/lib/** is plain runtime helper code — the naming helper, the tier
        // profile, the target resolver. None of it is a composite property
        // expression, so the static-evaluability rules do not apply.
        files: ["src/lib/**"],
        rules: { EVL002: "off", EVL003: "off", EVL004: "off" },
      },
    ],
  },
} satisfies Config;
