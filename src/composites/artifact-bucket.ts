/**
 * The bucket the image build reads its artifact from, and the policy that stops
 * anything reaching it without TLS.
 *
 * A composite because the two are one decision. `setup-test-env.sh` creates the
 * bucket and blocks public access on it in the same breath; a bucket without
 * the policy is a thing this kit would never deliberately declare, and the
 * policy without the bucket does not resolve. Grouping them means the
 * composites zoom shows "the artifact bucket" rather than two rows a reader has
 * to recognise as one idea.
 *
 * Named for what it groups rather than for the component that deploys it. See
 * the note in `./operator-role.ts`.
 */

import { Composite } from "@intentius/chant";
import { Bucket, Ref, S3BucketPolicy } from "@intentius/chant-lexicon-aws";

export interface ArtifactBucketProps {
  /** Physical bucket name, already sanitised and uniquified by the caller. */
  bucketName: string;
  /** AWS resource tags, as CloudFormation's Key/Value pairs. */
  tags: Array<{ Key: string; Value: string }>;
}

/**
 * Public access is blocked outright, matching what `setup-test-env.sh` does
 * immediately after creating the bucket — the artifact is application code and
 * there is no reason for it to be reachable.
 */
const PUBLIC_ACCESS_BLOCK = {
  BlockPublicAcls: true,
  IgnorePublicAcls: true,
  BlockPublicPolicy: true,
  RestrictPublicBuckets: true,
};

export const ArtifactBucket = Composite((props: ArtifactBucketProps) => {
  const bucket = new Bucket({
    BucketName: props.bucketName,
    PublicAccessBlockConfiguration: PUBLIC_ACCESS_BLOCK,
    Tags: props.tags,
  });

  // Bound before the constructor that reads them: EVL001 wants every property
  // value to be a plain identifier or literal, never a call.
  const bucketRef = Ref(bucket) as unknown as string;
  const bucketArn = bucket.Arn;
  const objectsArn = `${bucket.Arn}/*`;

  /**
   * Deny anything reaching the bucket without TLS. `setup-test-env.sh` blocks
   * public access but stops there; the artifact is application code and the
   * build service reads it over HTTPS, so there is no caller this excludes.
   */
  const bucketPolicy = new S3BucketPolicy({
    Bucket: bucketRef,
    PolicyDocument: {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "DenyInsecureTransport",
          Effect: "Deny",
          Principal: "*",
          Action: "s3:*",
          Resource: [bucketArn, objectsArn],
          Condition: { Bool: { "aws:SecureTransport": "false" } },
        },
      ],
    },
  });

  // A composite member's CloudFormation logical id is
  // `<instanceName><MemberName>`, with no way to override it. Instantiated as
  // `artifact`, these two members come out as `artifactBucket` and
  // `artifactBucketPolicy` — byte-identical to the ids this kit emitted before
  // the resources moved into a composite.
  //
  // That is not tidiness. A changed logical id is a *replacement* to
  // CloudFormation, and the bucket carries a fixed `BucketName`, so an existing
  // stack would try to create a second bucket by a name already taken and fail
  // the update. Preserving the ids is what makes this refactor safe to deploy
  // over a stack that already exists.
  return { bucket, bucketPolicy };
}, "ArtifactBucket");
