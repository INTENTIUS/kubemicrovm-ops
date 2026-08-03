/**
 * The operator-less path, as a seam rather than an alternative.
 *
 * `MicrovmApp` emits `AWS::Lambda::MicrovmImage` plus the build and execution
 * roles the MicroVMs service assumes, through CloudFormation. That is the whole
 * of what it does, and it is the half of the estate the KubeMicroVM operator
 * does not own either — the operator calls `CreateMicrovmImage` for the same
 * result, from inside the cluster.
 *
 * Declaring both in one chant project is the point. The image ARN crossing from
 * this stack to a `MicroVM`'s `imageRef` becomes an edge the graph can see and
 * the lint pack can check, rather than a string pasted between two tools.
 *
 * Off unless asked for: `--param goldenImageMode=provision`.
 */

import { MicrovmApp } from "@intentius/chant-lexicon-aws";
import { kmvNaming } from "../lib/naming";
import { tierProfile } from "../lib/tiers";
import {
  bucketName,
  goldenBaseImage,
  goldenBaseImageVersion,
  goldenImageMode,
  namingParams,
  sourceKey,
} from "./params";

const naming = kmvNaming(namingParams);

// `MicrovmApp` constrains the name to `^[a-zA-Z0-9-_]+$`, which the naming
// helper's DNS-1123 output already satisfies.
const goldenImageName = naming.name("golden", { service: "k8sObject" });

// Memory comes from the same tier profile the CRD path reads, so a golden image
// and a kit-declared image at the same tier are the same size. `MicrovmApp`
// validates it against the service's five sizes itself — the constant is
// declared in both places today, which the lint pack should collapse.
const memoryMiB = tierProfile(namingParams.tier).image.memorySizeMiB;

const codeArtifactUri = `s3://${bucketName}/${sourceKey}`;
// Scoped to the exact object rather than `bucket/*`, which is what MicrovmApp's
// build-role grant expects and what the upstream CDK construct does.
const codeArtifactObjectArn = `arn:aws:s3:::${bucketName}/${sourceKey}`;

export const goldenImage =
  goldenImageMode === "provision"
    ? MicrovmApp({
        name: goldenImageName,
        description: `Golden image for ${namingParams.project}-${namingParams.env}-${namingParams.instance}`,
        codeArtifactUri,
        codeArtifactObjectArn,
        baseImage: goldenBaseImage,
        baseImageVersion: goldenBaseImageVersion,
        memoryMiB,
      })
    : undefined;
