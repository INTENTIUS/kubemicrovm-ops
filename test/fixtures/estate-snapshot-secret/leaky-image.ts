// KMV023: an image that bakes a secret-shaped environment variable into its
// snapshot. Applies cleanly — CloudFormation has no opinion about the name —
// and the value then persists in every VM cloned from the image, for every
// retained version. The check reads the CFN plane because the k8s CRD has no
// environment field; this is the golden-image path's mistake to make.
import { MicrovmImage } from "@intentius/chant-lexicon-aws";

export const leaky = new MicrovmImage({
  MicrovmImageName: "leaky",
  BaseImageArn: "arn:aws:lambda:us-east-1:aws:microvm-image:al2023-1",
  BuildRoleArn: "arn:aws:iam::000000000000:role/build",
  CodeArtifact: { Uri: "s3://demo/code.zip" },
  EnvironmentVariables: [
    { Name: "LOG_LEVEL", Value: "info" },
    { Name: "DATABASE_PASSWORD", Value: "hunter2" },
  ],
});
