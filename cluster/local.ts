/**
 * The local target's cluster, declared.
 *
 * `local-up.sh` used to spell this as flags on `k3d cluster create`; now the
 * flags are data, `chant build cluster --format yaml` emits the SimpleConfig,
 * and `k3d cluster create --config` consumes it verbatim — a file the native
 * tool accepts with chant nowhere in sight, so the walk-away cost is zero.
 * chant's ownership marker rides onto every node's Docker labels on the way
 * through, which is what lets a live read tell this cluster from one it does
 * not own.
 *
 * Not to be confused with `src/cluster-plane`: that is the real target's
 * cluster (VPC + EKS, behind `clusterMode=provision`). This is the laptop
 * stand-in k3d provides, and it is the last piece of the local target that
 * was not declared.
 *
 * The kubeconfig block follows fountain-ops's reasoning: the *write* is on so
 * `kubectl config use-context k3d-kubemicrovm-local` has something to switch
 * to, and `switchCurrentContext` stays off — a cluster create repointing the
 * ambient context mid-session is how false failures start, and the script
 * switches explicitly, once, on purpose.
 *
 * One agent alongside the server and the loadbalancer left in, matching the
 * shape the script always created — a faithful port first; trimming the
 * loadbalancer would be a change to argue separately, not to smuggle into a
 * refactor.
 */
import { Cluster, KubeconfigOptions, Options } from "@intentius/chant-lexicon-k3d";

export const localCluster = new Cluster({
  metadata: { name: "kubemicrovm-local" },
  servers: 1,
  agents: 1,
  options: new Options({
    kubeconfig: new KubeconfigOptions({
      updateDefaultKubeconfig: true,
      switchCurrentContext: false,
    }),
  }),
});
