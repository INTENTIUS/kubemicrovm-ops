/**
 * m80, declared — the one Kubernetes workload the kit fully owns and, until
 * now, the one it did not declare (it was a heredoc in local-up.sh).
 *
 * Declaring it puts the emulator on every surface the rest of the estate is
 * on: `chant build` emits it, the live overlay classifies it, behold renders
 * it, and the image pin becomes the declared `m80Image` parameter instead of
 * a script variable no check guards (the operator CHART pin has a CI diff
 * check; the m80 pin had nothing — m80#75's consumer half).
 *
 * Real target: nothing. The MicroVMs API there is AWS's own, and declaring an
 * emulator against it would be worse than clutter — it would claim the
 * operator should talk to it.
 */

import { Deployment, Service } from "@intentius/chant-lexicon-k8s";
import {
  m80EnableInjection,
  m80Image,
  m80MaxAccountMemoryMib,
  m80Port,
  operatorNamespace,
  target,
} from "./params";

const local = target.target === "local";

// Bound to consts so the declaration stays statically evaluable, same rule as
// the AWS plane.
// Off only by explicit choice: the failure-path harness needs it, and an m80
// older than v0.4.0 crashloops on the flag rather than ignoring it — which is
// the pin floor, not a reason to leave it off. Bound to a const before the
// spread (EVL004).
const injectionArgs = m80EnableInjection ? ["-enable-injection"] : [];
const args = [
  "-addr",
  `:${m80Port}`,
  "-build-delay",
  "500ms",
  "-max-account-memory-mib",
  m80MaxAccountMemoryMib,
  "-serve-sts",
  ...injectionArgs,
];

export const m80Deploy = local
  ? new Deployment({
      metadata: { name: "m80", namespace: operatorNamespace, labels: { app: "m80" } },
      spec: {
        replicas: 1,
        selector: { matchLabels: { app: "m80" } },
        template: {
          metadata: { labels: { app: "m80" } },
          spec: {
            containers: [
              {
                name: "m80",
                image: m80Image,
                imagePullPolicy: "IfNotPresent",
                args,
                ports: [{ containerPort: m80Port, name: "api" }],
                readinessProbe: {
                  httpGet: { path: "/_m80/health", port: m80Port },
                  initialDelaySeconds: 2,
                },
                livenessProbe: {
                  httpGet: { path: "/_m80/health", port: m80Port },
                  initialDelaySeconds: 5,
                },
                resources: {
                  requests: { cpu: "50m", memory: "64Mi" },
                  limits: { cpu: "500m", memory: "256Mi" },
                },
                // Distroless static, in-memory state: nothing writes disk and
                // the image runs as its own nonroot user.
                securityContext: {
                  runAsNonRoot: true,
                  // Distroless names its user ("nonroot") rather than
                  // numbering it, and the kubelet can only verify
                  // runAsNonRoot against a numeric uid — 65532 is
                  // distroless's own nonroot uid.
                  runAsUser: 65532,
                  readOnlyRootFilesystem: true,
                  allowPrivilegeEscalation: false,
                  capabilities: { drop: ["ALL"] },
                },
              },
            ],
          },
        },
      },
    })
  : undefined;

export const m80Svc = local
  ? new Service({
      metadata: { name: "m80", namespace: operatorNamespace, labels: { app: "m80" } },
      spec: { selector: { app: "m80" }, ports: [{ name: "api", port: m80Port, targetPort: m80Port }] },
    })
  : undefined;
