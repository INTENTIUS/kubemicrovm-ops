---
title: The space
weight: 15
---

# The space

Findings as of 2026-07-29. AWS Lambda MicroVMs went GA on 2026-06-22, so everything below describes a five-week-old field and should be re-checked before major bets.

## Who else is here

| Actor | What it is | State |
|-------|-----------|-------|
| [`aws-controllers-k8s/lambdamicrovms-controller`](https://github.com/aws-controllers-k8s/lambdamicrovms-controller) | AWS's official ACK controller, created the day after GA | v0.1.x, machine-generated, two CRDs (`MicroVM`, `MicroVMImage` under `lambdamicrovms.services.k8s.aws`), raw API CRUD only |
| [KubeMicroVM](https://github.com/codriverlabs/KubeMicroVM) | The only community controller, and the product layer, replica pools, classes, token sidecar, webhooks, quota, drift | v1.0.11, 63/63 UAT, production-supported matrix |
| CloudFormation and CDK | Native at launch for image builds (`AWS::Lambda::MicrovmImage`), running VMs stay API-managed | Shipped |
| Terraform | Nothing, [open request hashicorp/terraform-provider-aws#48526](https://github.com/hashicorp/terraform-provider-aws/issues/48526) | Absent |
| chant `MicrovmApp` | Typed composite over the CFN path, one of the first typed IaC surfaces outside CDK | Shipped in the aws lexicon |
| Ecosystem repos | Ephemeral GitHub Actions runners (three separate projects), multi-tenant agent samples from aws-samples, a Claude Managed Agents sandbox integration | Small, use-case shaped |

The adjacent-but-different column. liquidmetal's microvm-operator is self-hosted Firecracker, not this service. The commercial sandbox market (E2B, Modal, Daytona, Northflank) is what AWS is attacking with the product. Bedrock AgentCore Runtime is the managed abstraction over the same substrate, the Fargate-to-EC2 relationship.

## Audience now

Small, honestly. The kit's consumer is the intersection of three filters. Adopted a weeks-old AWS service, wants it in the Kubernetes resource model rather than SDK or CDK, and needs more than ACK's raw CRUD. That is early-adopter platform engineers at agent-platform and multi-tenant-SaaS shops with existing EKS estates, realistically single digits of teams, mostly evaluating. Two audiences matter in this phase. Those design-partner-shaped teams, and codriverlabs themselves as a channel, since a typed, linted, drift-managed install story is something their docs cannot currently offer anyone. The kit also earns its keep the way loomster does, as a worked proof of the chant adoption-kit pattern on a fresh, visible service.

## Audience in a year

If the service follows the normal AWS arc, Terraform lands, ACK matures, regions and maybe x86 expand, the adopter profile shifts to enterprise platform teams standardizing sandbox infrastructure next to the rest of their estate. Untrusted tenant code in multi-tenant SaaS, CI runner fleets, agent platforms moving off sandbox SaaS for VPC-native networking, IAM integration, and compliance. That cohort is IaC-first by temperament. They will not hand-write CR YAML or run a bash installer in production, and they arrive with exactly the governance requirements the kit is designed around, review, drift, gated deletes, audit. The bet is that KubeMicroVM's audience grows into people who need the kit on day one.

## Risks and hedges

AWS could grow the ACK controller or ship a first-party product layer that outruns KubeMicroVM. The hedge is structural. The kit's CRD-typing path works identically against ACK's CRDs, same k8s lexicon codegen, so typing both controllers keeps the kit relevant if the community operator stalls. Carried as an open question on the [Roadmap]({{< relref "roadmap" >}}).

AgentCore will absorb the slice of the agent market that does not want to manage VMs at all. That slice was never the kit's audience, the kit exists for teams who chose the Kubernetes resource model on purpose.

KubeMicroVM itself is one company's project at v1.0.x. The kit's exposure is bounded by the same hedge as the ACK risk, plus the fact that everything below the CRDs, the AWS substrate, the Ops, the lifecycle model, survives a controller swap.
