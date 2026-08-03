---
title: Running the local target
weight: 27
---

# Running the local target

What `just <tier>-local-e2e` actually stands up, what each piece is for, and the things that went wrong the first time it was run so nobody has to find them twice.

## The pieces

| Piece | Serves | Why it is there |
|-------|--------|-----------------|
| floci | S3, IAM, CloudFormation | The prerequisites the operator needs to exist before it does anything: the artifact bucket, the build role, the operator role |
| m80 | The MicroVMs API, and `sts:GetCallerIdentity` | The four AWS SDK clients the operator itself calls |
| k3d | Kubernetes | Not emulated. Real cluster, real operator, real webhook |
| cert-manager | The operator's webhook certificates | The chart declares a `Certificate` and an `Issuer` and will not start without the CRDs behind them |

floci and m80 are separate processes on separate ports, so the kit takes two endpoints rather than one:

```sh
AWS_ENDPOINT_URL=http://localhost:4566        # floci
AWS_MICROVM_ENDPOINT=http://localhost:4290    # m80
```

Both emulators answer as account `000000000000`, so a bucket and a role ARN minted by floci feed a `CreateMicrovmImage` on m80 with nothing rewritten.

Every piece is overridable: `FLOCI_PORT`, `FLOCI_IMAGE`, `M80_IMAGE`, `M80_PORT`, `CLUSTER`, `CHART_VERSION`. Two are worth knowing about by default.

**Stock floci is enough, for now.** Everything the AWS plane declares — an S3 bucket, a bucket policy, two IAM roles and three managed policies — creates cleanly on `floci/floci:latest` from Docker Hub. That was worth checking rather than assuming: an earlier version of this page said the fork was required, and it was not, because the one upstream gap that would bite is CloudFormation dropping a security group's rules and tags, and this kit declares no security groups. Point `FLOCI_IMAGE` at a build of [lex00/floci](https://github.com/lex00/floci) if the estate grows one.

**m80 needs v0.3.0 or newer, and the published image is one.** The harness runs m80 with `-serve-sts`, the flag that answers the operator's startup gate. `v0.2.0` and the `:latest` of that era predate it, and an unknown flag is not ignored — the binary exits, so an older tag crashloops rather than degrading. v0.3.0 carries it ([m80#65](https://github.com/INTENTIUS/m80/issues/65)), and that is the pinned default; earlier versions of this page told you to build from source, which is no longer necessary.

Point `M80_IMAGE` at your own build to test a change to m80 itself. A locally built image is in no registry, so the script imports it into the cluster for you:

```sh
docker build -t m80:candidate ~/checkouts/m80
M80_IMAGE=m80:candidate just minimal-local-e2e
```

## Four things the schemas do not tell you

Every one of these was found by running the stack, and every one is accepted at apply time and fails later.

**The operator chart pins its own namespace.** Every template in `kube-microvm-operator` 1.0.11 hardcodes `namespace: kube-microvm` and ignores helm's `-n`. Installing anywhere else fails with `namespaces "kube-microvm" not found`, naming a namespace you did not ask for. The kit defaults `operatorNamespace` to `kube-microvm` for that reason and not because it is a nice name.

**`baseImageArn` is required, though the CRD does not say so.** `MicroVMImage`'s schema marks nothing required, so an image without it applies cleanly and then fails every reconcile with `Value null at 'baseImageArn' failed to satisfy constraint: Member must not be null`. The kit defaults it to the AWS-managed base image their own `setup-test-env.sh` prints, region-substituted.

**`networkProtocol` is an enum the schema types as an open string.** The service accepts `IPv4` or `DualStack` and nothing else. Anything else — `TCP` reads plausibly and is wrong — reconciles forever with `Member must satisfy enum value set: [IPv4, DualStack]`, and the connector never leaves `PENDING`, so every VM referencing it stays `Pending` too.

**`memorySizeMiB` is immutable after image creation.** The admission webhook rejects a change outright. Since memory is one of the things a tier sets, an image named without the tier makes `minimal` to `prod` an apply that cannot succeed. The kit puts the tier in the image name, so the two tiers own two images and a tier change is a create rather than a rejected patch.

The first three are exactly the class of error the [lint pack]({{< relref "lint-rules" >}}) exists to catch, and `test/tier-matrix.test.ts` already checks the shape of what the kit emits against the pinned schemas. A schema check cannot catch any of these four, because in each case the schema is the thing that is wrong.

## Two upstream patches the script applies

The operator will not start against an emulated endpoint without them, and both are filed upstream.

```sh
kubectl -n kube-microvm set env deploy/kube-microvm-operator \
    AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
    AWS_EC2_METADATA_DISABLED=true \
    AWS_ENDPOINT_URL_STS=http://m80.kube-microvm.svc.cluster.local:4290
```

The chart templates only the `app.envs` keys it knows, so anything else is dropped silently — [KubeMicroVM#52](https://github.com/codriverlabs/KubeMicroVM/issues/52). And the operator's startup gate calls `sts:GetCallerIdentity` with no endpoint override of its own, so without `AWS_ENDPOINT_URL_STS` pointed back at m80 the health check reports `awsConnectivity: false` forever, readiness never passes, and every custom resource create fails with `no endpoints available` — [KubeMicroVM#50](https://github.com/codriverlabs/KubeMicroVM/issues/50). Both maintainer replies say a fix is intended; when they land, these two lines go.

## Breaking it on purpose

Everything above tests that things work. The other half — what the estate does when a build fails or a connector cannot be created — is the half nobody can rehearse on a real account, because you cannot ask EC2 to run a subnet out of addresses and you cannot ask CodeBuild to fail on request.

Against m80 you can. It ships failure-injection levers, and since [m80#56](https://github.com/INTENTIUS/m80/issues/56) they have an HTTP surface rather than being reachable only from Go:

```sh
just break-it prod-ha
```

That deletes the image, arms `{"target":"build","name":"<image>"}`, re-applies, and asserts the `MicroVMImage` reaches `FAILED` rather than sitting in `CREATING` until something times out. At the production tiers it then does the same to the `MicroVMNetwork` with a reason code, and asserts the code comes back on `status.stateReasonCode`.

The levers are keyed by resource name and arm *before* the resource exists — "the next build of this image fails" — which is why the check deletes and recreates rather than poking a live resource.

It is destructive to the estate on purpose. `just apply-tier <tier>` puts it back.

`local-up.sh` starts m80 with `-enable-injection` for this. m80 leaves it off by default and is right to: nothing under `/_m80/` is signed, so anything that can reach the port can arm a failure. On a throwaway k3d cluster that is a reasonable trade, and `M80_ENABLE_INJECTION=0` declines it.

The seven reason codes are the service model's own: `SubnetOutOfIPAddresses` is the default here, and `REASON_CODE` picks another.

## Quotas

m80 defaults to the account memory ceiling a fresh AWS account has, 4096 MiB. At `prod-ha`'s 4096 MiB per VM that is one VM and nothing left over, so the script raises it the way a real account used for this would have been. Override with `MAX_ACCOUNT_MEMORY_MIB`.

Leaving it at the default is a reasonable thing to do deliberately: it is how you find out what your estate does when the account quota is the binding constraint, which is a failure mode worth seeing before a customer does.
