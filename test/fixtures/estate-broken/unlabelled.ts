// KMV001 + KMV002: a MicroVM in a namespace with no manage label, referencing
// an image that is not declared. Both apply cleanly against a real cluster —
// the webhook rejects the first, and the second simply never becomes ready.
import { MicroVM, Namespace } from "@intentius/chant-lexicon-k8s";

export const ns = new Namespace({
  metadata: { name: "unlabelled", labels: { "app.kubernetes.io/name": "kmv" } },
});

export const vm = new MicroVM({
  metadata: { name: "orphan", namespace: "unlabelled" },
  spec: { imageRef: "no-such-image", desiredState: "Running" },
});
