#!/usr/bin/env bash
# Checks the tools the local target needs, and offers to install what is
# missing.
#
#   ./scripts/local/prereqs.sh            # check, and offer to install
#   ./scripts/local/prereqs.sh --check    # check only, never install, exit 1
#   ./scripts/local/prereqs.sh --yes      # install without asking
#
# The lead-in to this repo was eight installs before anyone saw anything, which
# is the real barrier to showing it to someone rather than the command being
# complicated. This cuts it to "have Docker, run this".
#
# It asks first, every time, unless --yes. Installing software on someone
# else's machine without asking is not a thing a quick start gets to do, and a
# demo that starts by surprising you is worse than one that takes a minute
# longer.
#
# Docker is never installed here. It needs a daemon, a desktop app on macOS,
# and on Linux a group membership that requires a re-login — a script that
# claims to have installed it and leaves you unable to use it is worse than one
# that tells you to go install it.
#
# Written for bash 3.2, which is what macOS ships.
set -uo pipefail

MODE="ask"
case "${1:-}" in
    --check) MODE="check" ;;
    --yes|-y) MODE="yes" ;;
    "") ;;
    *) echo "usage: $0 [--check|--yes]" >&2; exit 2 ;;
esac

# What each tool is for, so a reader can decide whether they want it rather
# than being handed a list of names.
purpose() {
    case "$1" in
        docker)  echo "runs floci, m80 and the k3d cluster itself" ;;
        k3d)     echo "the local Kubernetes cluster" ;;
        kubectl) echo "talks to it" ;;
        helm)    echo "installs the KubeMicroVM operator chart" ;;
        aws)     echo "drives floci, which answers the AWS APIs" ;;
        node)    echo "builds the estate — the kit is TypeScript" ;;
        npm)     echo "installs the chant lexicons" ;;
        just)    echo "the task runner every documented command goes through" ;;
    esac
}

missing=""
for cmd in docker k3d kubectl helm aws node npm just; do
    command -v "${cmd}" >/dev/null 2>&1 || missing="${missing} ${cmd}"
done

if [ -z "${missing}" ]; then
    echo "prereqs: all present"
    exit 0
fi

echo "missing:${missing}"
echo ""
for cmd in ${missing}; do
    printf '  %-8s %s\n' "${cmd}" "$(purpose "${cmd}")"
done
echo ""

if [ "${MODE}" = "check" ]; then
    exit 1
fi

# Docker first and on its own: nothing else can be installed usefully without
# it, and it is the one this refuses to install.
case " ${missing} " in
    *" docker "*)
        cat >&2 <<'EOF'
Docker has to be installed by hand. It needs a running daemon, and on Linux a
group membership that does not take effect until you log out and back in, so a
script that "installed" it would leave you with something that does not work.

  macOS    https://docs.docker.com/desktop/install/mac-install/
  Linux    https://docs.docker.com/engine/install/

Then run this again.
EOF
        exit 1
        ;;
esac

installer=""
if command -v brew >/dev/null 2>&1; then
    installer="brew"
elif [ "$(uname -s)" = "Linux" ]; then
    installer="curl"
fi

if [ -z "${installer}" ]; then
    echo "No way to install these automatically here — no brew, and not Linux." >&2
    echo "Install them by hand and run this again." >&2
    exit 1
fi

echo "These would be installed with ${installer}."
if [ "${MODE}" = "ask" ]; then
    printf 'Go ahead? [y/N] '
    read -r reply
    case "${reply}" in
        y|Y|yes|YES) ;;
        *) echo "Nothing installed. Install them by hand and run this again."; exit 1 ;;
    esac
fi

install_one() {
    cmd="$1"
    echo "==> ${cmd}"
    if [ "${installer}" = "brew" ]; then
        case "${cmd}" in
            aws)  brew install awscli ;;
            node|npm) brew install node ;;
            *)    brew install "${cmd}" ;;
        esac
        return $?
    fi

    # Linux without brew: each of these publishes its own install script, and
    # they are the ones their own docs tell you to use.
    case "${cmd}" in
        k3d)     curl -sfL https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash ;;
        just)    bash "$(dirname "$0")/../install-just.sh" ;;
        helm)    curl -sfL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash ;;
        kubectl)
            ver="$(curl -sfL https://dl.k8s.io/release/stable.txt)"
            curl -sfLo /tmp/kubectl "https://dl.k8s.io/release/${ver}/bin/linux/amd64/kubectl" &&
                install -m 0755 /tmp/kubectl /usr/local/bin/kubectl ;;
        aws)
            curl -sfL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscli.zip &&
                unzip -q -o /tmp/awscli.zip -d /tmp && /tmp/aws/install --update ;;
        node|npm)
            echo "install node from https://nodejs.org or your distribution's packages" >&2
            return 1 ;;
        *) echo "no installer for ${cmd}" >&2; return 1 ;;
    esac
}

failed=""
for cmd in ${missing}; do
    # node and npm arrive together; do not install twice.
    case "${cmd}" in
        npm) command -v npm >/dev/null 2>&1 && continue ;;
    esac
    install_one "${cmd}" || failed="${failed} ${cmd}"
done

still=""
for cmd in docker k3d kubectl helm aws node npm just; do
    command -v "${cmd}" >/dev/null 2>&1 || still="${still} ${cmd}"
done

echo ""
if [ -n "${still}" ]; then
    echo "still missing:${still}" >&2
    echo "Install those by hand; everything else is ready." >&2
    exit 1
fi

echo "prereqs: all present"
