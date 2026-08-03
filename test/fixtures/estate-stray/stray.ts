// KMV022: a namespace with no manage label holding nothing this build
// declares. Applies fine, does nothing, and is left behind on teardown.
import { Namespace } from "@intentius/chant-lexicon-k8s";

export const used = new Namespace({
  metadata: { name: "workload", labels: { "lambda.aws.amazon.com/manage-microvms": "true" } },
});

export const stray = new Namespace({
  metadata: { name: "left-behind", labels: { "app.kubernetes.io/name": "kmv" } },
});
