---
title: kubemicrovm-ops
type: docs
---

# kubemicrovm-ops

**Run AWS Lambda MicroVMs through Kubernetes with the whole estate declared — and prove the deployment on a laptop before an account bills you.**

[KubeMicroVM](https://github.com/codriverlabs/KubeMicroVM) brings Lambda MicroVMs into the Kubernetes resource model: an operator, five CRDs, a CLI, admission webhooks. What it does not ship is an infrastructure-as-code path — installation is a shell script wrapping a Helm chart, IAM is a hand-run CloudFormation template, and the resources are hand-written YAML. This kit is that path, built on [chant](https://intentius.io/chant/): typed declarations for both planes, lint that catches the operator's admission-time refusals at build time, one component deploy that runs identically on a laptop and on real AWS, and teardown that leaves nothing behind.

```sh
git clone https://github.com/INTENTIUS/kubemicrovm-ops && cd kubemicrovm-ops && ./go
```

Nothing to a running MicroVM estate, one command, no AWS account. The AWS plane is emulated by [floci](https://github.com/lex00/floci), the MicroVMs API by [m80](https://intentius.github.io/m80/) — and the Kubernetes half is not emulated at all: a real k3d cluster running the real operator, reconciling real custom resources.

## Give this to your agent

```
You need Docker running; everything else (k3d, kubectl, helm, the AWS CLI,
node, npm, just) ./go checks and installs itself. Clone
https://github.com/INTENTIUS/kubemicrovm-ops and run:

  ./go --yes           # nothing → a full KubeMicroVM estate on k3d + emulators (~5 min)
  just validate        # converged — the operator accepted it — not merely applied

No AWS account and nothing billed: floci emulates the AWS plane, m80 the
MicroVMs API; the cluster, operator, CRDs and webhooks are all real. If
anything looks wrong, `just doctor` names the broken piece and the command
that fixes it.

The production shape is the same source tree. Apply does not prune, so retire
the minimal tier's VM first — this is exactly the sequence CI runs:

  kubectl -n microvm-demo delete microvm --all
  just apply-tier prod-ha && just validate prod-ha

which exercises the replica floor, the VPC connector, and a live tier change —
still free. Before assuming behaviour, read:

  https://intentius.github.io/kubemicrovm-ops/docs/tiers/         the three axes: tier, target, seam
  https://intentius.github.io/kubemicrovm-ops/docs/local-target/  what the free target proves, and the line it cannot cross

Real AWS is the same tree with different parameters (KMV_CLUSTER_MODE=provision
stands up the kit's own VPC and EKS cluster; ~$2 a run, teardown included).
Follow "The path" on the landing page in order — each step proves what the
previous one cannot.
```

## The path

Five steps, one source tree — only parameters change. Each names its cost, and what it proves that the step before could not.

| | Step | Cost | What it proves |
|---|------|------|----------------|
| 1 | **Read [Tiers and targets]({{< relref "/docs/tiers" >}})** | ten minutes | The three axes everything varies on: *tier* (how much estate), *target* (where it runs), *seams* (provision or reference, per resource). Nothing after this page is a special case. |
| 2 | **Local** — `./go --yes`, then `just validate` | Free. Runs on every commit in CI | The estate declares, applies and converges, and the operator accepts every manifest. Four schema gaps the API server accepted and the service refused were caught here first. [The local target]({{< relref "/docs/local-target" >}}) states the boundary honestly. |
| 3 | **`minimal` on real AWS** — `AWS_REGION=us-east-1 KMV_TIER=minimal KMV_CLUSTER_MODE=provision KMV_SEED_ARTIFACT=1 just install` | ~$2, ~40 minutes, then `just teardown` | What no emulator can reach: real IAM decisions at runtime, the real service building your artifact, real quotas. The kit provisions its own VPC and EKS cluster and removes them after. Validated end to end 2026-08-06 — the first real run found a required field the emulator had accepted as null for a month. |
| 4 | **`prod`** — same command, `KMV_TIER=prod` | ~$2 | The adoptable single-AZ shape: the `MicroVMClass` carrying the idle policy, a replica set, and the VPC egress connector reaching `ACTIVE` on the real service. Validated end to end 2026-08-06. |
| 5 | **`prod-ha`** — same command, `KMV_TIER=prod-ha` | ~$2, plus the quota | Multi-AZ: a floor of two VMs across two subnets. This is where a fresh account's 8 GB MicroVM memory quota bites, by design — deployed to exactly that edge 2026-08-06, second replica refused with the 402 the kit's own `account-fit` check predicts. The quota and the raise are on [Tiers]({{< relref "/docs/tiers" >}}). |

Steps 3–5 also exist as a reviewer-gated workflow — `real-e2e.yml`, dispatch-only, teardown guaranteed, a final sweep that fails the run if anything in the account survived it. Its one-time account setup is `just setup-real-ci`: the OIDC role is declared estate, the GitHub half is scripted, and a console appears nowhere.

## The shape of the kit

| Layer | What the kit provides |
|-------|----------------------|
| Types | Generated constructors for the five KubeMicroVM CRDs, plus the AWS substrate via the chant aws lexicon |
| Lint | Cross-resource rules that mirror the operator's webhook and the MicroVM service limits |
| Deploy | chant components in dependency waves — cluster plane, AWS plane, operator, workload — each step carrying its own tool's lifecycle |
| Converge | Applied is not deployed: the last step waits for the operator's verdict, fails fast on the service's, and prints the operator's own log when it does |
| Lifecycle | Observe (`lifecycle diff --live`) through authoritative (the component run, prunes scoped to owned-and-undeclared), per environment |
| CI | The estate's pipelines shipped for GitHub, GitLab and Forgejo — declared, rendered, drift-checked; check free on every push, deploy gated |

## Where it stands

`minimal` and `prod-ha` run free on every push. On real AWS: `minimal` and `prod` are validated end to end, `prod-ha` to the account's quota edge — the whole record, with dates, is the [validated matrix]({{< relref "/docs/tiers#what-has-been-validated" >}}). What is planned or open lives in [the issues](https://github.com/INTENTIUS/kubemicrovm-ops/issues), nowhere else.

Start with the [Quick start]({{< relref "/docs/quickstart" >}}), or the [full docs]({{< relref "/docs" >}}).
