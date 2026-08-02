# kubemicrovm-ops — the KubeMicroVM adoption kit on chant.
# `just` with no target lists everything.

default:
    @just --list

# Install dependencies.
install:
    npm install

# Typecheck the helpers, the two planes, and the config.
build:
    npx tsc --noEmit

# chant lint — core rules plus the post-synth checks.
lint:
    npx chant lint .

# Unit tests plus the tier matrix, which builds every tier and checks each
# emitted field against the pinned CRD schemas.
test:
    npx vitest run

# Everything CI-relevant.
check: build lint test

# Synthesize both planes for the current tier and target.
synth:
    npm run synth

# ── The local target: k3d + floci + m80. Free, and what CI runs. ──────────

# Bring the whole local target up at one tier and apply the estate.
minimal-local-e2e:
    bash scripts/local/local-up.sh minimal

prod-local-e2e:
    bash scripts/local/local-up.sh prod

prod-ha-local-e2e:
    bash scripts/local/local-up.sh prod-ha

# Tear the local target down.
local-down:
    bash scripts/local/local-down.sh

# ── The real target: a live account and a live EKS cluster. Costs money. ──
#
# Each of these needs real credentials, KMV_CLUSTER_NAME pointing at an
# existing EKS cluster, and KMV_SUBNET_IDS/KMV_SECURITY_GROUP_IDS from its
# VPC. AWS_ENDPOINT_URL must be unset — that is what selects this target.

minimal-live-e2e:
    bash scripts/live/live-up.sh minimal

prod-live-e2e:
    bash scripts/live/live-up.sh prod

# Materially more cost than prod: two MicroVMs at the replica floor rather
# than one, and a connector across two availability zones.
prod-ha-live-e2e:
    bash scripts/live/live-up.sh prod-ha

# ── Viewing ──────────────────────────────────────────────────────────────

# Open the estate in behold at http://localhost:4600 — both substrates in one
# graph, the tier picker switching between the three profiles.
view:
    cd ../behold && npm run dev -- preview ../kubemicrovm-ops
