# kubemicrovm-ops — the KubeMicroVM adoption kit on chant.
# `just` with no target lists everything.
#
# `just --list` prints the last comment line above a recipe, so each recipe's
# description is one line and sits directly above it. Longer notes go above a
# real blank line, which is what ends the block.

default:
    @just --list

# Note: named `deps` and not `install`, because that name belongs to the
# install Op below — the one the docs alias and the one `teardown` pairs with.

# Install node dependencies.
deps:
    npm install

# Typecheck the helpers, the two planes, and the config.
build:
    npx tsc --noEmit

# chant lint — core rules plus the post-synth checks.
lint:
    npx chant lint .

# Note: the tier matrix is the one worth knowing about. It builds all three
# tiers and checks every emitted field against the pinned CRD schemas, because
# a misspelled field is accepted by the API server and ignored by the
# controller.

# Unit tests, plus the tier matrix against the pinned CRD schemas.
test:
    npx vitest run

# Compile the Ops to worker code under ops/dist/.
ops-build:
    npm run ops:build

# Everything CI-relevant: typecheck, lint, tests.
check: build lint test

# Synthesize both planes for the current tier and target.
synth:
    npm run synth

# ── The local target: k3d + floci + m80. Free, and what CI runs. ──────────

# Stand the local target up at the minimal tier and apply the estate.
minimal-local-e2e:
    bash scripts/local/local-up.sh minimal

# The same at the prod tier: adds a class and a VPC egress connector.
prod-local-e2e:
    bash scripts/local/local-up.sh prod

# The same at prod-ha: a replica floor of two, across two subnets.
prod-ha-local-e2e:
    bash scripts/local/local-up.sh prod-ha

# Note: `./go` runs this and then stands the estate up, which is the one
# command a fresh clone needs. This recipe is the check on its own.

# Are the tools the local target needs installed.
prereqs:
    bash scripts/local/prereqs.sh

# Note: a tier change against the cluster and floci already up, which is what
# apply-estate.sh was split out of local-up.sh to make possible. The e2e
# recipes above rebuild the cluster from nothing; this one does not. Applying
# prod-ha over a live minimal estate is also what exercises the webhook's
# immutable-field rejection.

# Rebuild and apply the estate at one tier, against a stack already up.
apply-tier tier:
    bash scripts/local/apply-estate.sh {{tier}}

# Note: answers "why is nothing happening" without standing anything up. It
# walks the pieces in the order they depend on each other and names the command
# to run about whichever one is wrong.

# Is each piece of the local target up and talking to the next one.
doctor:
    bash scripts/local/doctor.sh

# Note: waits, up to ten minutes. On failure it prints every resource and the
# operator's own reasoning, which is what tells a schema gap the service
# refused apart from a reconcile that is merely slow.

# Did the estate converge, as opposed to merely applying.
validate tier="":
    bash scripts/local/assert-converged.sh {{tier}}

# Note: destructive to the estate on purpose — it deletes and recreates the
# image, and the network at the production tiers, so the armed lever bites. Run
# it against a stack you are willing to disturb, then `just apply-tier` back.

# Break the estate deliberately and check it reports what broke.
break-it tier="":
    bash scripts/local/assert-failure-paths.sh {{tier}}

# Note: warns and never fails. It reads the deployed image's memory size and
# the live replica floor, not what tiers.ts declares, because those are the
# numbers the service is actually asked for. ACCOUNT_CEILING_MIB says what your
# account was raised to.

# Would this estate fit an AWS account's memory quota.
account-fit:
    bash scripts/local/account-fit.sh

# Note: rebuilds the estate against m80's recorded 4096 MiB ceiling instead of
# the 262144 the harness normally raises it to. prod-ha needs 8192, so it
# cannot fit — the assertion is that the refusal names a quota rather than
# looking like a hang.

# Stand a tier up against a real account's ceiling and watch it be refused.
quota-refusal tier="prod-ha":
    bash scripts/local/assert-quota-refusal.sh {{tier}}

# Tear the local target down: the teardown Op, then the cluster and floci.
local-down:
    bash scripts/local/local-down.sh

# Note: this is what an adopter on EKS runs. local-up.sh calls it after
# standing up the emulators, so both targets reach the same four phases.

# The component run on its own, against a cluster and endpoints that exist.
install:
    npx chant run all --components --env "${KMV_ENV:-dev}"

# The estate and the operator removed, cluster left where it was found.
teardown:
    npx chant run kubemicrovm-teardown

# ── The real target: a live account and a live EKS cluster. Costs money. ──
#
# Each of these needs real credentials, KMV_CLUSTER_NAME pointing at an
# existing EKS cluster, and KMV_SUBNET_IDS/KMV_SECURITY_GROUP_IDS from its
# VPC. AWS_ENDPOINT_URL must be unset — that is what selects this target.

# Minimal tier against real AWS. Costs money.
minimal-live-e2e:
    bash scripts/live/live-up.sh minimal

# Prod tier against real AWS. Costs money.
prod-live-e2e:
    bash scripts/live/live-up.sh prod

# Note: materially more than prod — two MicroVMs at the replica floor rather
# than one, and a connector across two availability zones.

# Prod-ha against real AWS. Costs the most of the three.
prod-ha-live-e2e:
    bash scripts/live/live-up.sh prod-ha

# ── Viewing ──────────────────────────────────────────────────────────────

# Note: serves at http://localhost:4600. Needs a behold checkout, `../behold`
# by default and BEHOLD_DIR otherwise — the quick start does not create one, so
# a reader who followed it reaches this recipe without the thing it needs.
#
# `serve --env`, not `preview`. behold's preview returns before it detects k3d
# — "the Loom demo only needs Docker + Floci, so the CI/forge and k3d
# substrates are out of scope" (behold src/substrates.ts) — so previewing this
# kit shows the AWS plane and none of the Kubernetes one, which is the half a
# KubeMicroVM estate is most interesting for. --env is what turns on the live
# drift overlay, and it reads through `chant lifecycle diff --live`, bound to
# the cluster chant.config.ts names.
#
# Not --local: that boots the served project's own local substrates, and this
# kit's local-up.sh deletes the cluster before creating it. Stand the estate up
# first, then look at it.

# Open the estate in behold — both substrates in one graph, coloured by drift.
view:
    #!/usr/bin/env bash
    set -euo pipefail
    kit="$(pwd)"
    behold="${BEHOLD_DIR:-../behold}"
    if [ ! -d "${behold}" ]; then
        echo "no behold checkout at ${behold}" >&2
        echo "" >&2
        echo "behold is the live control plane this opens the estate in. It is a" >&2
        echo "separate repository and the quick start does not clone it:" >&2
        echo "" >&2
        echo "  git clone https://github.com/INTENTIUS/behold ${behold}" >&2
        echo "  just view" >&2
        echo "" >&2
        echo "Or point BEHOLD_DIR at a checkout you already have." >&2
        echo "The estate is fine without it — this is a way to look, not a step." >&2
        exit 1
    fi
    cd "${behold}" && npm run dev -- serve "${kit}" --env "${KMV_ENV:-dev}"

# Note: reads the estate that is standing right now — stand one up first, at
# the tier you want the snapshot to show. `just prod-ha-local-e2e` is the one
# worth exporting: it is the only tier declaring a class, a connector and a
# replica floor, so it is the only one whose picture shows the whole estate.
#
# The bundle is every lens behold can render — each env and tier, each zoom,
# radial on and off — captured through the same handlers the live server runs
# and replayed client-side. Pan, zoom, the dial and the inspect pane all work
# with nothing running. What does not survive is the live half: no polling, no
# Op triggers, no adopt.
#
# The tier picker still switches all three, and the two tiers you did not
# deploy render as declared-not-deployed against the live overlay. That is the
# drift colouring telling the truth, not a gap in the capture.
#
# Output is under dist/, which is gitignored — the bundle is a build artifact,
# not a checked-in copy of the estate.

# Freeze the standing estate into a static, interactive bundle.
export tier="prod-ha":
    #!/usr/bin/env bash
    set -euo pipefail
    kit="$(pwd)"
    out="${kit}/dist/behold-export"
    behold="${BEHOLD_DIR:-../behold}"
    if [ ! -d "${behold}" ]; then
        echo "no behold checkout at ${behold}" >&2
        echo "" >&2
        echo "  git clone https://github.com/INTENTIUS/behold ${behold}" >&2
        echo "  just export" >&2
        echo "" >&2
        echo "Or point BEHOLD_DIR at a checkout you already have." >&2
        exit 1
    fi
    # An export of an estate that is not up is a bundle of empty graphs, and it
    # looks like a broken exporter rather than an empty cluster. Say so here.
    if ! kubectl --context "k3d-${CLUSTER:-kubemicrovm-local}" get nodes >/dev/null 2>&1; then
        echo "no local estate to export — the cluster is not reachable" >&2
        echo "" >&2
        echo "  just {{tier}}-local-e2e     # stand it up, about four minutes" >&2
        echo "  just export {{tier}}" >&2
        echo "" >&2
        echo "The live overlay is what makes the snapshot worth looking at; without" >&2
        echo "a cluster this would capture declared topology and nothing else." >&2
        exit 1
    fi
    # And that the ambient context is that cluster, which is a separate question
    # from whether it is reachable.
    #
    # chant's k8s binding is a guard, not a selector: with the environment bound
    # in chant.config.ts it refuses to observe through a context that is not the
    # bound one, rather than switching for you. Refusing is right — reading the
    # wrong cluster would report every declared resource as missing — but the
    # export does not fail on it. Every Kubernetes node comes back `neutral`
    # (unobserved) and the bundle looks like an estate that was never deployed.
    #
    # Worth checking because the ambient context moves on its own. Anything that
    # runs `kubectl config use-context` — another project's script, another
    # terminal — changes it under you, and this went out grey twice before the
    # check existed.
    want="k3d-${CLUSTER:-kubemicrovm-local}"
    have="$(kubectl config current-context 2>/dev/null || true)"
    if [ "${have}" != "${want}" ]; then
        echo "the active kubectl context is \"${have}\", not \"${want}\"" >&2
        echo "" >&2
        echo "chant refuses to read a cluster it is not bound to, so exporting now" >&2
        echo "would capture the AWS plane and leave every Kubernetes resource grey." >&2
        echo "" >&2
        echo "  kubectl config use-context ${want}" >&2
        echo "  just export {{tier}}" >&2
        exit 1
    fi
    rm -rf "${out}"
    cd "${behold}" && KMV_TIER="{{tier}}" npm run dev -- export "${kit}" \
        --env "${KMV_ENV:-dev}" --out "${out}" --name "${WORKER_NAME:-kubemicrovm-ops}"

# Note: the bundle writes its own assets-only wrangler.jsonc, so there is
# nothing to configure here. Auth is `npx wrangler login`, or
# CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID in the environment.
#
# This publishes to the internet. Everything in the bundle is already in this
# public repo except the emulator's account id and the k3d-side resource names,
# which is why exporting the local target is the safe thing to publish and
# exporting a real account is not.

# Deploy the exported bundle to Cloudflare Workers.
publish:
    #!/usr/bin/env bash
    set -euo pipefail
    out="$(pwd)/dist/behold-export"
    if [ ! -f "${out}/wrangler.jsonc" ]; then
        echo "nothing exported yet at ${out}" >&2
        echo "" >&2
        echo "  just export" >&2
        exit 1
    fi
    cd "${out}" && npx wrangler deploy

# Look at the exported bundle before publishing it, on a plain static server.
preview-export:
    npx serve dist/behold-export
